package market

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ValuationPoint is one daily PE/PB observation (time ascending).
type ValuationPoint struct {
	Date string  `json:"date"`
	PE   float64 `json:"pe"`
	PB   float64 `json:"pb"`
}

// ValuationResult holds current PE/PB plus historical percentiles.
// PERank/PBRank are 0-100: the percentile of the current value within its history
// (fraction of historical observations <= current value). Lower rank = cheaper.
type ValuationResult struct {
	Market string          `json:"market"` // "A" / "US" / "HK"
	PE     float64         `json:"pe"`
	PB     float64         `json:"pb"`
	Points []ValuationPoint `json:"points"`
	PERank float64         `json:"pe_rank"`
	PBRank float64         `json:"pb_rank"`
	PEHist bool            `json:"pe_hist"` // true = has (real or estimated) PE history
	PBHist bool            `json:"pb_hist"` // true = has real PB history (A-share only)
	Note   string          `json:"note"`
	Source string          `json:"source"` // 数据来源说明（前端在估值页签底部标注）
}

// GetValuationHistory returns PE/PB history for a stock symbol.
// A-shares use Eastmoney RPT_VALUEANALYSIS_DET (real daily PE_TTM/PB_MRQ, last ~3y).
// US/HK use current Tencent PE plus K-line-estimated history (EPS held constant at
// the latest value), since no stable historical PB source exists for those markets.
func GetValuationHistory(symbol, market string, bars []KlineBar) (*ValuationResult, error) {
	if strings.HasPrefix(symbol, "sh") || strings.HasPrefix(symbol, "sz") {
		return getAShareValuation(symbol)
	}
	return getEstValuation(symbol, bars)
}

func getAShareValuation(symbol string) (*ValuationResult, error) {
	code := strings.TrimPrefix(symbol, "sh")
	code = strings.TrimPrefix(code, "sz")
	end := time.Now().Format("20060102")
	beg := time.Now().AddDate(-3, 0, 0).Format("20060102")
	// Eastmoney filter syntax: (SECURITY_CODE="600519") with = and " URL-encoded.
	filter := fmt.Sprintf("(SECURITY_CODE%%3D%%22%s%%22)", code)
	url := "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_VALUEANALYSIS_DET" +
		"&columns=TRADE_DATE,PE_TTM,PB_MRQ&filter=" + filter +
		"&beginDate=" + beg + "&endDate=" + end + "&pageSize=800"
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetch valuation: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read valuation: %w", err)
	}
	var out struct {
		Result struct {
			Data []struct {
				TradeDate string  `json:"TRADE_DATE"`
				PE       float64 `json:"PE_TTM"`
				PB       float64 `json:"PB_MRQ"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("parse valuation: %w", err)
	}
	rows := out.Result.Data
	if len(rows) == 0 {
		return nil, fmt.Errorf("no valuation data for %s", symbol)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].TradeDate < rows[j].TradeDate })
	pts := make([]ValuationPoint, 0, len(rows))
	pes := make([]float64, 0, len(rows))
	pbs := make([]float64, 0, len(rows))
	for _, r := range rows {
		d := r.TradeDate
		if len(d) > 10 {
			d = d[:10]
		}
		pts = append(pts, ValuationPoint{Date: d, PE: r.PE, PB: r.PB})
		pes = append(pes, r.PE)
		pbs = append(pbs, r.PB)
	}
	last := rows[len(rows)-1]
	return &ValuationResult{
		Market: "A",
		PE:     last.PE,
		PB:     last.PB,
		Points: pts,
		PERank: percentile(pes, last.PE),
		PBRank: percentile(pbs, last.PB),
		PEHist: true,
		PBHist: true,
		Source: "东方财富 RPT_VALUEANALYSIS_DET（近3年真实 PE_TTM / PB_MRQ）",
	}, nil
}

// getEstValuation estimates US/HK PE history from the latest PE and daily closes.
// EPS is held constant at (latest_close / latest_PE), so the estimated PE series is
// simply close / EPS. PB history is not available for these markets. The window is
// capped to ~3 years so the percentile reflects the stock's recent own history
// (matching the A-share window) rather than being skewed by decades of split-adjusted prices.
func getEstValuation(symbol string, bars []KlineBar) (*ValuationResult, error) {
	pe, err := GetStockValuation(symbol)
	if err != nil || pe <= 0 {
		return nil, fmt.Errorf("no PE for %s", symbol)
	}
	if len(bars) < 30 {
		return nil, fmt.Errorf("kline insufficient for %s", symbol)
	}
	const estWindow = 750 // ~3 trading years
	if len(bars) > estWindow {
		bars = bars[len(bars)-estWindow:]
	}
	last := bars[len(bars)-1].Close
	eps := last / pe
	if eps <= 0 {
		return nil, fmt.Errorf("bad eps for %s", symbol)
	}
	pts := make([]ValuationPoint, 0, len(bars))
	pes := make([]float64, 0, len(bars))
	for _, b := range bars {
		hpe := b.Close / eps
		pts = append(pts, ValuationPoint{Date: b.Date, PE: hpe, PB: 0})
		pes = append(pes, hpe)
	}
	mkt := "US"
	if strings.HasPrefix(symbol, "hk") {
		mkt = "HK"
	}
	return &ValuationResult{
		Market: mkt,
		PE:     pe,
		PB:     0,
		Points: pts,
		PERank: percentile(pes, pe),
		PBRank: 0,
		PEHist: true,
		PBHist: false,
		Note:   "美股/港股历史 PE 为估算值（EPS 取最新值恒定），PB 历史数据源暂缺",
		Source: "腾讯财经 qt.gtimg.cn（当前 PE）＋ K线估算历史 PE；PB 历史数据源暂缺",
	}, nil
}

// percentile returns the 0-100 rank of v within vals (fraction of values <= v) * 100.
func percentile(vals []float64, v float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	n := 0
	for _, x := range vals {
		if x <= v {
			n++
		}
	}
	return float64(n) / float64(len(vals)) * 100
}

// GetStockValuation fetches the current PE (Tencent field 40, 0-indexed 39) from
// qt.gtimg.cn. PB is not reliably exposed for US/HK via Tencent, so only PE is returned.
func GetStockValuation(symbol string) (float64, error) {
	code := tencentCode(symbol)
	url := "https://qt.gtimg.cn/q=" + code
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://gu.qq.com/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	body = decodeGBK(body)
	m := tencentRe.FindSubmatch(body)
	if m == nil {
		return 0, fmt.Errorf("cannot parse %s", symbol)
	}
	fields := strings.Split(string(m[1]), "~")
	if len(fields) < 40 {
		return 0, fmt.Errorf("no PE for %s", symbol)
	}
	pe, _ := strconv.ParseFloat(fields[39], 64) // f40 (0-indexed 39) = PE_TTM
	return pe, nil
}
