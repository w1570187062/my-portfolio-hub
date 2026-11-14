package market

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// KlineBar is a single daily OHLCV bar.
type KlineBar struct {
	Date   string // YYYY-MM-DD
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume float64
}

// FetchKline returns daily K-line bars for a given symbol.
// symbol: "sh600519", "sz000001", "AAPL", "QQQ", etc.
func FetchKline(symbol string) ([]KlineBar, error) {
	market := detectMarket(symbol)
	switch market {
	case "A":
		return fetchAShareKline(symbol)
	case "US":
		return fetchUSKline(symbol)
	default:
		return nil, fmt.Errorf("unsupported market for symbol: %s", symbol)
	}
}

func detectMarket(symbol string) string {
	if strings.HasPrefix(symbol, "sh") || strings.HasPrefix(symbol, "sz") || strings.HasPrefix(symbol, "hk") {
		return "A"
	}
	// US stocks: pure letters, optionally with dots (BRK.B)
	return "US"
}

const klineUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

// aShareKlineURLs 按优先级给出 A 股日 K 线的候选地址。
// 2026-11-13：线上服务器出口访问 web.ifzq.gtimg.cn 会被腾讯 WAF 以 HTTP 501 拦截，
// 返回一段 HTML 跳转页而非 JSON，旧实现直接 Unmarshal 就报
// "parse kline: invalid character '<' looking for beginning of value"，技术分析弹框随之报错。
// 实测同站的 ifzq.gtimg.cn（不带 web. 前缀）在该出口正常返回，故提为首选；原域名留作
// 第二选择（本机 / 其他网络仍可用）；东方财富是异厂商兜底，避免腾讯整站被拦时全军覆没。
// 做成包级变量是为了能用 httptest 注入本地源验证回退链路。
var aShareKlineURLs = func(code string) []string {
	param := code + ",day,,,320,qfq"
	urls := []string{
		"https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + param,
		"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + param,
	}
	if u := eastmoneyKlineURL(code); u != "" {
		urls = append(urls, u)
	}
	return urls
}

func eastmoneyKlineURL(code string) string {
	var secid string
	switch {
	case strings.HasPrefix(code, "sh"):
		secid = "1." + strings.TrimPrefix(code, "sh")
	case strings.HasPrefix(code, "sz"):
		secid = "0." + strings.TrimPrefix(code, "sz")
	default:
		return "" // 港股在东方财富是另一套 secid，交给腾讯两源
	}
	// 不要带 beg=0：那会让 lmt 失效、拉回上市以来全量（实测 2383 根），
	// 缓存体积与指标计算都白白膨胀；只带 lmt=320 即与腾讯口径一致。
	return "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" + secid +
		"&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&lmt=320&end=20500101"
}

// fetchAShareKline 依次尝试各数据源，任一返回有效 K 线即止；全部失败才返回聚合错误。
func fetchAShareKline(symbol string) ([]KlineBar, error) {
	// symbol: sh600519 -> need to extract code for the API
	var code string
	if strings.HasPrefix(symbol, "sh") {
		code = "sh" + strings.TrimPrefix(symbol, "sh")
	} else if strings.HasPrefix(symbol, "sz") {
		code = "sz" + strings.TrimPrefix(symbol, "sz")
	} else if strings.HasPrefix(symbol, "hk") {
		// Tencent K-line API uses 5-digit HK codes (e.g. hk00700), while the
		// real-time quote API uses 4-digit (hk0700). Pad to 5 here.
		raw := strings.TrimPrefix(symbol, "hk")
		code = "hk" + fmt.Sprintf("%05s", raw)
	} else {
		return nil, fmt.Errorf("invalid A-share symbol: %s", symbol)
	}

	var reasons []string
	for _, u := range aShareKlineURLs(code) {
		bars, err := fetchOneKlineSource(u, code)
		if err == nil && len(bars) > 0 {
			return bars, nil
		}
		if err != nil {
			reasons = append(reasons, err.Error())
		} else {
			reasons = append(reasons, "empty kline")
		}
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "no source")
	}
	return nil, fmt.Errorf("all A-share kline sources failed: %s", strings.Join(reasons, "; "))
}

func fetchOneKlineSource(url, code string) ([]KlineBar, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", klineUserAgent)
	req.Header.Set("Referer", "https://gu.qq.com/")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	body := bytes.TrimSpace(raw)
	// WAF / 网关拦截页是 HTML。先在这里挡掉，才能继续尝试下一个源，
	// 而不是把 "invalid character '<'" 这种底层解析错误一路抛到界面上。
	if len(body) == 0 || body[0] != '{' {
		return nil, fmt.Errorf("non-JSON response (blocked by gateway?)")
	}
	if strings.Contains(url, "eastmoney.com") {
		return parseEastmoneyKline(body)
	}
	return parseTencentKline(body, code)
}

func parseTencentKline(body []byte, code string) ([]KlineBar, error) {
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse kline: %w", err)
	}

	data, ok := result["data"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("no data in response")
	}

	stockData, ok := data[code].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("no stock data for %s", code)
	}

	day, ok := stockData["day"].([]interface{})
	if !ok {
		// Try qfqday or day in nested format
		if qfqday, ok2 := stockData["qfqday"].([]interface{}); ok2 {
			day = qfqday
		} else {
			return nil, fmt.Errorf("no day data for %s", code)
		}
	}
	return parseTencentRows(day), nil
}

// parseTencentRows: [date, open, close, high, low, volume]
func parseTencentRows(day []interface{}) []KlineBar {
	bars := make([]KlineBar, 0, len(day))
	for _, item := range day {
		arr, ok := item.([]interface{})
		if !ok || len(arr) < 6 {
			continue
		}
		bars = append(bars, KlineBar{
			Date:   fmt.Sprintf("%v", arr[0]),
			Open:   parseFloat(arr[1]),
			Close:  parseFloat(arr[2]),
			High:   parseFloat(arr[3]),
			Low:    parseFloat(arr[4]),
			Volume: parseFloat(arr[5]),
		})
	}
	sort.Slice(bars, func(i, j int) bool { return bars[i].Date < bars[j].Date })
	return bars
}

// parseEastmoneyKline: klines 每行 "date,open,close,high,low,volume"，与腾讯 day 数组同序。
func parseEastmoneyKline(body []byte) ([]KlineBar, error) {
	var res struct {
		Data *struct {
			Klines []string `json:"klines"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("parse eastmoney kline: %w", err)
	}
	if res.Data == nil || len(res.Data.Klines) == 0 {
		return nil, fmt.Errorf("no eastmoney kline data")
	}
	bars := make([]KlineBar, 0, len(res.Data.Klines))
	for _, line := range res.Data.Klines {
		p := strings.Split(line, ",")
		if len(p) < 6 {
			continue
		}
		bars = append(bars, KlineBar{
			Date:   p[0],
			Open:   parseFloat(p[1]),
			Close:  parseFloat(p[2]),
			High:   parseFloat(p[3]),
			Low:    parseFloat(p[4]),
			Volume: parseFloat(p[5]),
		})
	}
	sort.Slice(bars, func(i, j int) bool { return bars[i].Date < bars[j].Date })
	return bars, nil
}

// Sina Finance US stock daily K-line API (no API key needed, works from mainland China).
// Endpoint: https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=wmt&type=1
// Response: [{"d":"1972-08-25","o":"32.50","h":"33.13","l":"32.50","c":"33.00","v":"3942400","a":"0"}, ...]
func fetchUSKline(symbol string) ([]KlineBar, error) {
	url := fmt.Sprintf("https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=%s&type=1", strings.ToLower(symbol))
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", "https://finance.sina.com.cn/")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch US kline: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Sina US API returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read kline: %w", err)
	}

	var rows []struct {
		Date   string `json:"d"`
		Open   string `json:"o"`
		High   string `json:"h"`
		Low    string `json:"l"`
		Close  string `json:"c"`
		Volume string `json:"v"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("parse US kline: %w", err)
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("no data for US symbol %s", symbol)
	}

	bars := make([]KlineBar, 0, len(rows))
	for _, r := range rows {
		closeVal, _ := strconv.ParseFloat(r.Close, 64)
		if closeVal == 0 {
			continue
		}
		openVal, _ := strconv.ParseFloat(r.Open, 64)
		highVal, _ := strconv.ParseFloat(r.High, 64)
		lowVal, _ := strconv.ParseFloat(r.Low, 64)
		volVal, _ := strconv.ParseFloat(r.Volume, 64)
		bars = append(bars, KlineBar{
			Date:   r.Date,
			Open:   openVal,
			High:   highVal,
			Low:    lowVal,
			Close:  closeVal,
			Volume: volVal,
		})
	}

	// Data is already sorted by date ascending from Sina
	return bars, nil
}

// Helper functions
func parseFloat(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case string:
		f, err := strconv.ParseFloat(val, 64)
		if err != nil {
			log.Printf("parseFloat error for %q: %v", val, err)
			return 0
		}
		return f
	default:
		return 0
	}
}
