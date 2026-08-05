package market

import (
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
	Date   string  // YYYY-MM-DD
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

// Tencent API: daily K-line (复权)
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

	url := fmt.Sprintf("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s,day,,,320,qfq", code)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetch kline: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read kline: %w", err)
	}

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

	bars := make([]KlineBar, 0, len(day))
	for _, item := range day {
		arr, ok := item.([]interface{})
		if !ok || len(arr) < 6 {
			continue
		}
		date := fmt.Sprintf("%v", arr[0])
		open := parseFloat(arr[1])
		close_ := parseFloat(arr[2])
		high := parseFloat(arr[3])
		low := parseFloat(arr[4])
		volume := parseFloat(arr[5])
		bars = append(bars, KlineBar{
			Date:   date,
			Open:   open,
			High:   high,
			Low:    low,
			Close:  close_,
			Volume: volume,
		})
	}

	// Sort by date ascending
	sort.Slice(bars, func(i, j int) bool {
		return bars[i].Date < bars[j].Date
	})

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

	body, err := io.ReadAll(resp.Body)
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
