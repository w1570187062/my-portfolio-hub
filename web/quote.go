package market

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/encoding/simplifiedchinese"

	"portfolio/internal/db"
)

// decodeGBK converts Tencent's GBK-encoded HTTP body to UTF-8. Tencent's
// qt.gtimg.cn quote interface returns Chinese names in GBK, so they must be
// decoded before being stored as UTF-8 in the database. ASCII (prices, codes)
// passes through unchanged.
func decodeGBK(b []byte) []byte {
	out, err := simplifiedchinese.GBK.NewDecoder().Bytes(b)
	if err != nil {
		return b
	}
	return out
}

// httpClient forces IPv4 to avoid containers without IPv6 routes hanging on
// dual-stack hosts (e.g. push2.eastmoney.com returns an AAAA record).
var httpClient = &http.Client{
	Timeout: 6 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			d := net.Dialer{Timeout: 6 * time.Second, KeepAlive: 30 * time.Second}
			return d.DialContext(ctx, "tcp4", addr)
		},
	},
}

// Quote holds latest price and change percent.
type Quote struct {
	CurrentPrice float64
	PrevClose    float64 // real previous close, used for daily P&L (方案A)
	ChangePct    float64 // percent, e.g. -1.23 means -1.23%
	Name         string  // stock/fund name from the API
}

// isAlpha reports whether s consists solely of ASCII letters (US tickers, e.g. QQQ, WMT).
func isAlpha(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
			return false
		}
	}
	return true
}

// tencentPrefix derives the Tencent market prefix from the symbol itself:
// pure-letter tickers -> US (us); 5-digit codes -> Hong Kong (hk); Shanghai (sh) for 6/9/5xxxxx;
// Shenzhen (sz) for 0/3xxxxx; Beijing (bj) for 8/4xxxxx. This decouples quote routing from
// stored market codes.
func tencentPrefix(symbol string) string {
	switch {
	case isAlpha(symbol):
		return "us"
	case len(symbol) == 5:
		return "hk"
	case strings.HasPrefix(symbol, "8"), strings.HasPrefix(symbol, "4"):
		return "bj"
	case strings.HasPrefix(symbol, "6"), strings.HasPrefix(symbol, "9"), strings.HasPrefix(symbol, "5"):
		return "sh"
	default:
		return "sz"
	}
}

// GetStockQuote fetches A-share / ETF / HK quotes from Tencent (qt.gtimg.cn).
// The market prefix is derived from the symbol, so no external market code is needed.
// Returns prices in normal units (no scaling needed).
func GetStockQuote(symbol string) (*Quote, error) {
	prefix := tencentPrefix(symbol)
	code := prefix + symbol
	if prefix == "us" {
		code = "us" + strings.ToUpper(symbol) // Tencent US tickers are upper-case, e.g. usQQQ
	}
	url := "https://qt.gtimg.cn/q=" + code
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://gu.qq.com/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	body = decodeGBK(body)
	m := tencentRe.FindSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("cannot parse %s", symbol)
	}
	fields := strings.Split(string(m[1]), "~")
	if len(fields) < 33 || fields[3] == "" {
		return nil, fmt.Errorf("no price for %s", symbol)
	}
	price, err := strconv.ParseFloat(fields[3], 64)
	if err != nil {
		return nil, err
	}
	pct, _ := strconv.ParseFloat(fields[32], 64)
	prev, _ := strconv.ParseFloat(fields[4], 64)
	name := strings.TrimSpace(fields[1])
	return &Quote{CurrentPrice: price, PrevClose: prev, ChangePct: pct, Name: name}, nil
}

var fundRe = regexp.MustCompile(`jsonpgz\((\{.*\})\)`)
var tencentRe = regexp.MustCompile("=\"([^\"]*)\"")

// GetFundQuote fetches open-end fund price.
// Primary: Eastmoney latest published NAV (dwjz) + daily change (jzzzl) — matches the
// "日增长" column on Tian Tian Fund / Eastmoney (net-value based, T+1 settlement).
// Fallback: Tian Tian Fund intraday estimated NAV (gsz) — live during trading hours for
// funds whose official NAV has not yet been published (otherwise estimate 作为补充).
func GetFundQuote(symbol string) (*Quote, error) {
	if q, err := fundNAV(symbol); err == nil {
		log.Printf("[fund] %s 取数源=历史净值(dwjz/jzzzl)", symbol)
		return q, nil
	}
	if q, err := fundEstimate(symbol); err == nil {
		log.Printf("[fund] %s 取数源=盘中估值(gsz)", symbol)
		return q, nil
	}
	log.Printf("[fund] %s 取数失败(净值与估值均无)", symbol)
	return nil, fmt.Errorf("cannot fetch fund %s", symbol)
}

func fundEstimate(symbol string) (*Quote, error) {
	url := fmt.Sprintf("https://fundgz.1234567.com.cn/js/%s.js", symbol)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "http://fund.eastmoney.com/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	m := fundRe.FindSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("no estimate for %s", symbol)
	}
	var data struct {
		Name  string `json:"name"`
		Gsz   string `json:"gsz"`
		Gszzl string `json:"gszzl"`
	}
	if err := json.Unmarshal(m[1], &data); err != nil {
		return nil, err
	}
	if data.Gsz == "" {
		return nil, fmt.Errorf("empty estimate for %s", symbol)
	}
	price, err := strconv.ParseFloat(data.Gsz, 64)
	if err != nil {
		return nil, err
	}
	pct, _ := strconv.ParseFloat(data.Gszzl, 64)
	prev := 0.0
	if pct != 0 {
		prev = price / (1 + pct/100)
	}
	log.Printf("[fund] estimate %s 原始 gsz=%s gszzl=%s -> 现价=%.4f 反推昨收=%.4f 名称=%s", symbol, data.Gsz, data.Gszzl, price, prev, data.Name)
	return &Quote{CurrentPrice: price, PrevClose: prev, ChangePct: pct, Name: strings.TrimSpace(data.Name)}, nil
}

func fundNAV(symbol string) (*Quote, error) {
	url := fmt.Sprintf("https://api.fund.eastmoney.com/f10/lsjz?fundCode=%s&pageIndex=1&pageSize=1", symbol)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://fundf10.eastmoney.com/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out struct {
		Data struct {
			LSJZList []struct {
				DWJZ  string `json:"DWJZ"`
				JZZZL string `json:"JZZZL"`
			} `json:"LSJZList"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if len(out.Data.LSJZList) == 0 {
		return nil, fmt.Errorf("no NAV for %s", symbol)
	}
	nav := out.Data.LSJZList[0].DWJZ
	if nav == "" {
		return nil, fmt.Errorf("empty NAV for %s", symbol)
	}
	price, err := strconv.ParseFloat(nav, 64)
	if err != nil {
		return nil, err
	}
	pct, _ := strconv.ParseFloat(out.Data.LSJZList[0].JZZZL, 64)
	prev := 0.0
	if pct != 0 {
		prev = price / (1 + pct/100)
	}
	log.Printf("[fund] NAV %s 原始 dwjz=%s jzzzl=%s -> 现价=%.4f 反推昨收=%.4f", symbol, nav, out.Data.LSJZList[0].JZZZL, price, prev)
	q := &Quote{CurrentPrice: price, PrevClose: prev, ChangePct: pct}
	if q.Name == "" {
		if nq, e := fundName(symbol); e == nil {
			q.Name = nq
		}
	}
	return q, nil
}

// fundName best-effort fetches the canonical fund name.
// Primary: Eastmoney's search API — covers ALL open-end funds (equity, bond,
// QDII, commodity); Tian Tian Fund's estimate JSON only returns a name for funds
// that publish an intraday estimate, which excludes most bond/QDII funds, so it
// is used only as a fallback here.
func fundName(symbol string) (string, error) {
	// Primary: Eastmoney fund search API.
	url := fmt.Sprintf("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=j&m=1&key=%s", symbol)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://fund.eastmoney.com/")
	if resp, err := httpClient.Do(req); err == nil {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		inner := jsonpUnwrap(body)
		var data struct {
			Datas []struct {
				Name string `json:"NAME"`
			} `json:"Datas"`
		}
		if json.Unmarshal(inner, &data) == nil && len(data.Datas) > 0 {
			if n := strings.TrimSpace(data.Datas[0].Name); n != "" {
				return n, nil
			}
		}
	}
	// Fallback: Tian Tian Fund estimate JSON (only for funds with intraday estimate).
	url2 := fmt.Sprintf("https://fundgz.1234567.com.cn/js/%s.js", symbol)
	req2, _ := http.NewRequest("GET", url2, nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0")
	req2.Header.Set("Referer", "http://fund.eastmoney.com/")
	resp2, err := httpClient.Do(req2)
	if err != nil {
		return "", err
	}
	defer resp2.Body.Close()
	body2, _ := io.ReadAll(resp2.Body)
	m := fundRe.FindSubmatch(body2)
	if m == nil {
		return "", fmt.Errorf("no name for %s", symbol)
	}
	var data2 struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(m[1], &data2); err != nil {
		return "", err
	}
	return strings.TrimSpace(data2.Name), nil
}

// jsonpUnwrap extracts the JSON object from a JSONP response ("callback({...})").
// It uses the first '{' and last '}' so fund names containing parentheses
// (e.g. "摩根日本精选股票(QDII)A") don't break the slice boundary.
func jsonpUnwrap(body []byte) []byte {
	s := bytes.IndexByte(body, '{')
	e := bytes.LastIndexByte(body, '}')
	if s >= 0 && e > s {
		return body[s : e+1]
	}
	return body
}

// ---- FX rate cache: handlers read cached rates so a slow/unreachable
// upstream never blocks request paths (e.g. /api/summary used to wait ~8s). ----
const fxCacheMaxAge = 10 * time.Minute

// Built-in fallback rates, used only when no cached/persisted rate exists and
// the upstream is unreachable, so request handlers never block. The background
// updater keeps retrying and overwrites these as soon as the network recovers.
const (
	fxFallbackCNY = 7.2 // 1 USD ≈ 7.2 CNY
	fxFallbackHKD = 7.8 // 1 USD ≈ 7.8 HKD
)

var (
	fxMu            sync.RWMutex
	fxCNY           float64
	fxHKD           float64
	fxYesterdayCNY  float64 // last rate from previous day (persisted)
	fxYesterdayHKD  float64
	fxHas           bool
	fxUpdated       time.Time
	fxHealthy       bool = true // optimistic; background refresh flips to false on failure
	fxLastFail      time.Time
)

func fxGet() (cny, hkd float64, ok bool) {
	fxMu.RLock()
	defer fxMu.RUnlock()
	if fxHas && time.Since(fxUpdated) < fxCacheMaxAge {
		return fxCNY, fxHKD, true
	}
	return 0, 0, false
}

func fxGetAny() (cny, hkd float64, ok bool) {
	fxMu.RLock()
	defer fxMu.RUnlock()
	return fxCNY, fxHKD, fxHas
}

// fxShouldProbe reports whether enough time has passed to attempt one live
// fetch even while the upstream is considered unhealthy (so recovery is detected).
func fxShouldProbe() bool {
	fxMu.RLock()
	defer fxMu.RUnlock()
	return !fxHealthy && time.Since(fxLastFail) > fxCacheMaxAge
}

func fxMarkFail() {
	fxMu.Lock()
	fxHealthy = false
	fxLastFail = time.Now()
	fxMu.Unlock()
}

func fxSet(cny, hkd float64) {
	fxMu.Lock()
	// Day change detection: when a new day arrives, save yesterday's close from the
	// previous cache before overwriting. This keeps the comparison stable across the day.
	now := time.Now()
	if fxHas && !isSameDay(now, fxUpdated) {
		fxYesterdayCNY, fxYesterdayHKD = fxCNY, fxHKD
	}
	fxCNY, fxHKD, fxHas, fxUpdated, fxHealthy = cny, hkd, true, now, true
	// snapshot for persisted save
	yCNY, yHKD := fxYesterdayCNY, fxYesterdayHKD
	fxMu.Unlock()
	if err := db.SaveFXRate(cny, hkd, yCNY, yHKD); err != nil {
		log.Printf("[fx] save cache: %v", err)
	}
}

// isSameDay reports whether a and b fall on the same calendar day in local time.
func isSameDay(a, b time.Time) bool {
	ya, ma, da := a.Date()
	yb, mb, db := b.Date()
	return ya == yb && ma == mb && da == db
}

// fetchFXNow fetches USD->CNY/HKD from the upstream (blocking, short timeout).
// Primary source: Sina's real-time FX feed (domestic, updates intraday) — this
// fixes the old exchangerate-api.com free tier which only refreshed ~once/day
// and made RMB->USD look frozen. Secondary source: exchangerate-api.com, kept
// as a fallback if Sina is unreachable. Either success returns; failure returns
// an error so the caller can fall back to the last-known-good cached rate.
func fetchFXNow() (cny, hkd float64, err error) {
	if c, h, e := fetchFXSina(); e == nil && c > 0 && h > 0 {
		return c, h, nil
	}
	// Secondary upstream (exchangerate-api.com).
	resp, e := httpClient.Get("https://api.exchangerate-api.com/v4/latest/USD")
	if e != nil {
		return 0, 0, e
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var out struct {
		Rates map[string]float64 `json:"rates"`
	}
	if e := json.Unmarshal(body, &out); e != nil {
		return 0, 0, e
	}
	c, ok1 := out.Rates["CNY"]
	h, ok2 := out.Rates["HKD"]
	if !ok1 || !ok2 {
		return 0, 0, fmt.Errorf("FX rate missing")
	}
	return c, h, nil
}

// fetchFXSina pulls USD->CNY and USD->HKD from Sina's real-time forex feed.
// Sina returns GBK text and requires a Referer header; the latest price for each
// pair sits at comma-field index 8 (0-based) of the quoted string.
func fetchFXSina() (cny, hkd float64, err error) {
	req, e := http.NewRequest("GET", "https://hq.sinajs.cn/list=fx_susdcny,fx_susdhkd", nil)
	if e != nil {
		return 0, 0, e
	}
	req.Header.Set("Referer", "https://finance.sina.com.cn")
	resp, e := httpClient.Do(req)
	if e != nil {
		return 0, 0, e
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	body := decodeGBK(raw)
	lines := strings.Split(string(body), "\n")
	var cnyS, hkdS string
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(ln, "var hq_str_fx_susdcny="):
			cnyS = sinaFXField(ln)
		case strings.HasPrefix(ln, "var hq_str_fx_susdhkd="):
			hkdS = sinaFXField(ln)
		}
	}
	if cnyS == "" || hkdS == "" {
		return 0, 0, fmt.Errorf("sina fx: incomplete response")
	}
	cny, e1 := strconv.ParseFloat(cnyS, 64)
	hkd, e2 := strconv.ParseFloat(hkdS, 64)
	if e1 != nil || e2 != nil || cny <= 0 || hkd <= 0 {
		return 0, 0, fmt.Errorf("sina fx: parse/bad value")
	}
	return cny, hkd, nil
}

// sinaFXField extracts the latest price (comma-field index 8) from a Sina
// "var hq_str_fx_xxx=\"...\";" line. Falls back to field 1 (open) if 8 is absent.
func sinaFXField(line string) string {
	eq := strings.Index(line, "=")
	if eq < 0 {
		return ""
	}
	val := strings.TrimSpace(line[eq+1:])
	val = strings.Trim(val, `"`)
	val = strings.TrimSuffix(val, ";")
	parts := strings.Split(val, ",")
	if len(parts) > 8 && parts[8] != "" {
		return parts[8]
	}
	if len(parts) > 1 {
		return parts[1]
	}
	return ""
}

// StartFXUpdater warms the cache from the DB, performs one synchronous refresh
// at startup (so the request path is never the first to block on the upstream),
// then refreshes in the background.
func StartFXUpdater() {
	if c, h, yc, yh, u, ok := db.LoadFXRate(); ok {
		fxMu.Lock()
		fxCNY, fxHKD, fxYesterdayCNY, fxYesterdayHKD, fxHas = c, h, yc, yh, true
		// Use the persisted real update time, not the startup moment.
		if t, e := time.Parse("2006-01-02 15:04:05", u); e == nil {
			fxUpdated = t
		} else {
			fxUpdated = time.Now()
		}
		fxMu.Unlock()
	}
	refreshFX() // synchronous at startup; blocks at most the client timeout if unreachable
	go func() {
		ticker := time.NewTicker(fxCacheMaxAge)
		defer ticker.Stop()
		for range ticker.C {
			refreshFX()
		}
	}()
}

func refreshFX() {
	c, h, err := fetchFXNow()
	if err != nil {
		fxMarkFail()
		log.Printf("[fx] background refresh failed: %v", err)
		return
	}
	fxSet(c, h)
}

// fxResolve returns cached rates, or falls back without blocking when the
// upstream is known unhealthy. ok=false means a built-in fallback was used.
func fxResolve() (cny, hkd float64, ok bool) {
	if c, h, ok := fxGet(); ok {
		return c, h, true
	}
	if fxHealthy || fxShouldProbe() {
		c, h, e := fetchFXNow()
		if e == nil {
			fxSet(c, h)
			return c, h, true
		}
		fxMarkFail()
	}
	if c, h, ok := fxGetAny(); ok {
		return c, h, true
	}
	return fxFallbackCNY, fxFallbackHKD, false
}

// FetchUSDRate returns the cached USD->CNY rate, never blocking on the upstream.
func FetchUSDRate() (float64, error) {
	c, _, ok := fxResolve()
	if !ok {
		log.Printf("[fx] no USD rate available, using built-in fallback (CNY≈%.4f)", fxFallbackCNY)
	}
	return c, nil
}

// lastGoodCny/lastGoodHkd cache the most recent successfully resolved rates so
// that a transient upstream failure degrades gracefully to the last known-good
// value instead of a hardcoded constant (or, worse, a zero that zeroes out USD
// market value). Protected by lastRateMu.
var (
	lastRateMu  sync.RWMutex
	lastGoodCny float64
	lastGoodHkd float64
)

// GetFXRates returns USD->CNY and USD->HKD. On a fresh successful resolve it
// caches the values; if the upstream is degraded/unreachable it falls back to
// the last successfully fetched rates and reports degraded=true, so callers can
// surface that the figure may be stale rather than silently wrong.
func GetFXRates() (cny, hkd float64, degraded bool) {
	c, h, ok := fxResolve()
	if ok {
		lastRateMu.Lock()
		lastGoodCny = c
		lastGoodHkd = h
		lastRateMu.Unlock()
		return c, h, false
	}
	lastRateMu.RLock()
	lc, lh := lastGoodCny, lastGoodHkd
	lastRateMu.RUnlock()
	if lc > 0 {
		return lc, lh, true
	}
	return fxFallbackCNY, fxFallbackHKD, true
}

// GetUSDRate returns USD->CNY with graceful degradation (see GetFXRates).
func GetUSDRate() (float64, bool) {
	c, _, degraded := GetFXRates()
	return c, degraded
}

// FetchFXRates returns cached USD->CNY and USD->HKD rates, never blocking.
func FetchFXRates() (cny, hkd float64, err error) {
	c, h, ok := fxResolve()
	if !ok {
		log.Printf("[fx] no rate available, using built-in fallback (CNY≈%.4f HKD≈%.4f)", fxFallbackCNY, fxFallbackHKD)
	}
	return c, h, nil
}

// FXInfo is the publicly exposed snapshot of cached FX rates for the UI.
type FXInfo struct {
	USDCNY  float64 `json:"usd_cny"` // 1 USD = USDCNY CNY
	HKDCNY  float64 `json:"hkd_cny"` // 1 HKD = HKDCNY CNY
	CNYUSD  float64 `json:"cny_usd"` // 1 CNY = CNYUSD USD
	USDHKD  float64 `json:"usd_hkd"` // 1 USD = USDHKD HKD
	Updated string  `json:"updated"` // 上次成功拉取时间（本地时区）
	Healthy bool    `json:"healthy"` // 最近一次上游探测是否成功
	Stale   bool    `json:"stale"`   // 缓存是否已超过刷新周期

	// Yesterday close + day-over-day change (only meaningful when yesterday data exists).
	YesterdayCNY  float64 `json:"yesterday_cny"`
	YesterdayHKD  float64 `json:"yesterday_hkd"`
	ChgCNYPct     float64 `json:"chg_cny_pct"`     // (usd_cny - yesterday_cny) / yesterday_cny * 100
	ChgHKDPct     float64 `json:"chg_hkd_pct"`     // (usd_hkd - yesterday_hkd) / yesterday_hkd * 100
	HasYesterday  bool    `json:"has_yesterday"`   // whether yesterday data is available for comparison
}

// GetFXInfo returns the current cached FX snapshot for the UI. Never blocks.
func GetFXInfo() FXInfo {
	fxMu.RLock()
	cny, hkd, has, updated, healthy := fxCNY, fxHKD, fxHas, fxUpdated, fxHealthy
	yCNY, yHKD := fxYesterdayCNY, fxYesterdayHKD
	fxMu.RUnlock()
	info := FXInfo{Healthy: healthy}
	if !has {
		cny, hkd = fxFallbackCNY, fxFallbackHKD
	}
	info.USDCNY = cny
	info.USDHKD = hkd
	if hkd > 0 {
		info.HKDCNY = cny / hkd
	}
	if cny > 0 {
		info.CNYUSD = 1 / cny
	}
	info.Stale = !updated.IsZero() && time.Since(updated) > fxCacheMaxAge
	if !updated.IsZero() {
		info.Updated = updated.Format("2006-01-02 15:04:05")
	}
	// Yesterday comparison
	if yCNY > 0 && yHKD > 0 {
		info.HasYesterday = true
		info.YesterdayCNY = yCNY
		info.YesterdayHKD = yHKD
		info.ChgCNYPct = (cny - yCNY) / yCNY * 100
		info.ChgHKDPct = (hkd - yHKD) / yHKD * 100
	}
	return info
}
