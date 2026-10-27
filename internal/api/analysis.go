package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// AnalysisResponse 是技术分析弹框所需的精简数据：仅保留迷你K线(series)。
// 自动买卖信号(角标)已随「判断买卖信号」功能下线；AI 对话的买卖判断仍保留，
// 由 aichat 复用 market 概率引擎。指标/概率/逐日信号/估值等子面板此前已移除。
type AnalysisResponse struct {
	ID          int               `json:"id"`
	Name        string            `json:"name"`
	Symbol      string            `json:"symbol"`
	Category    string            `json:"category"`
	Market      string            `json:"market"`
	Error       string            `json:"error,omitempty"`
	GeneratedAt string            `json:"generated_at"`
	Series      []market.KlineBar `json:"series,omitempty"`
}

// analysisSeriesCap 迷你K线响应截断：只回传最近约 1 年交易日（260 根）。上市二三十年的
// A 股全量上万根，既拖慢弹框加载，前端缩放档数（total/12）也永远到不了最大档（切不出折线）。
const analysisSeriesCap = 260

func capSeries(bars []market.KlineBar) []market.KlineBar {
	if len(bars) > analysisSeriesCap {
		return bars[len(bars)-analysisSeriesCap:]
	}
	return bars
}

// ---- 分析缓存新鲜度（命中缓存也做新鲜度校验）----
const (
	analysisCacheHardTTL    = 6 * time.Hour
	analysisCacheMinRefresh = 30 * time.Minute
)

var beijing = time.FixedZone("CST", 8*3600)

// expectedLatestBarDate 估算「此刻应已可获得的最新交易日」（YYYY-MM-DD）。
func expectedLatestBarDate(marketName string, now time.Time) string {
	cutoff := now.Add(-16 * time.Hour)
	if marketName == "美股" {
		cutoff = now.Add(-29 * time.Hour)
	}
	d := cutoff
	for d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
		d = d.AddDate(0, 0, -1)
	}
	return d.Format("2006-01-02")
}

// analysisCacheFresh 判断当日分析缓存是否新鲜（true=可直接复用）。
func analysisCacheFresh(row *db.AnalysisCacheRow, marketName string) bool {
	if row == nil {
		return false
	}
	genAt, err := time.ParseInLocation("2006-01-02 15:04:05", row.GeneratedAt, beijing)
	if err != nil {
		return true // 时间无法解析时不强制重取，保持旧行为
	}
	age := time.Since(genAt)
	if age >= analysisCacheHardTTL {
		return false
	}
	var bars []market.KlineBar
	if err := json.Unmarshal([]byte(row.BarsJSON), &bars); err != nil || len(bars) == 0 {
		return true
	}
	if bars[len(bars)-1].Date < expectedLatestBarDate(marketName, time.Now()) {
		if age >= analysisCacheMinRefresh {
			return false
		}
	}
	return true
}

// getAnalysis 返回迷你K线所需的日K线数据。
// 自动买卖信号已下线；指标/概率/逐日信号/估值等子面板此前已移除。
// GET /holdings/:id/analysis
func getAnalysis(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	h, err := db.Get(int64(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "holding not found"})
		return
	}

	resp := AnalysisResponse{
		ID:       int(h.ID),
		Name:     h.Name,
		Symbol:   h.Symbol,
		Category: h.Category,
		Market:   h.Market,
	}

	// 基金：若未关联股票代码，直接返回不支持
	if h.Category == "fund" && h.LinkedSymbol == "" {
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp, "message": "该基金未设置关联股票代码，不支持技术分析"})
		return
	}

	symForFetch := h.Symbol
	if h.Category == "fund" {
		symForFetch = h.LinkedSymbol
	}
	symbol := resolveSymbol(symForFetch, h.Market)
	today := time.Now().Format("2006-01-02")
	genAt := time.Now().Format("2006-01-02 15:04:05")

	// ① 查缓存：当日命中且「新鲜」则直接复用 K线 + 概率（用于角标）。
	if row, e := db.GetAnalysisCache(symbol, today); e == nil && row != nil && analysisCacheFresh(row, h.Market) {
		var bars []market.KlineBar
		if e2 := json.Unmarshal([]byte(row.BarsJSON), &bars); e2 == nil && len(bars) >= 30 {
			resp.Series = capSeries(bars)
			resp.Symbol = symForFetch
			resp.GeneratedAt = row.GeneratedAt
			c.JSON(http.StatusOK, gin.H{"analysis": resp, "cache": true})
			return
		}
	}

	// ② 未命中缓存：实时抓取 K线，计算概率用于角标，落库缓存（K线+指标+概率）。
	bars, err := market.FetchKline(symbol)
	resp.Series = capSeries(bars)
	if err != nil {
		log.Printf("[analysis] fetch kline for %s (%s) failed: %v", h.Name, symbol, err)
		resp.Error = "获取K线数据失败：" + err.Error()
		resp.Symbol = symForFetch
		resp.GeneratedAt = genAt
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}
	if len(bars) < 30 {
		resp.Error = "K线数据不足（需要至少30个交易日）"
		resp.Symbol = symForFetch
		resp.GeneratedAt = genAt
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}

	ind := market.CalculateIndicators(bars)
	prob := market.CalculateProbability(ind)
	resp.Symbol = symForFetch
	resp.GeneratedAt = genAt

	// 异步落库缓存（失败不影响响应）：K线 + 指标 + 概率，供 AI 分析复用。
	go func() {
		barsJSON, _ := json.Marshal(bars)
		indJSON, _ := json.Marshal(ind)
		probJSON, _ := json.Marshal(prob)
		if e := db.SaveAnalysisCache(symbol, today, string(barsJSON), string(indJSON), string(probJSON), "[]", "{}", genAt); e != nil {
			log.Printf("[analysis] save cache %s %s failed: %v", symbol, today, e)
		}
	}()

	c.JSON(http.StatusOK, gin.H{"analysis": resp, "cache": false})
}

// resolveSymbol converts the user-friendly symbol to the API format.
func resolveSymbol(symbol, market string) string {
	sym := strings.ToLower(strings.TrimSpace(symbol))

	// 用户友好前缀：a: / sh: / sz: / us: / hk: → 展开为 API 所需前缀
	if strings.Contains(sym, ":") {
		parts := strings.SplitN(sym, ":", 2)
		prefix := parts[0]
		code := strings.TrimSpace(parts[1])
		switch prefix {
		case "a", "sh":
			if len(code) == 6 && isAllDigits(code) {
				switch code[0] {
				case '6', '5', '9':
					return "sh" + code
				case '0', '2', '3':
					return "sz" + code
				}
			}
			return "sh" + code
		case "sz":
			return "sz" + code
		case "hk":
			return "hk" + code
		case "us":
			return code // 美股代码直接返回
		default:
			return code
		}
	}

	// If symbol already has prefix (sh/sz/hk), use as-is
	if strings.HasPrefix(sym, "sh") || strings.HasPrefix(sym, "sz") || strings.HasPrefix(sym, "hk") {
		return sym
	}

	// 6 位纯数字 → 视为 A 股，按首位判定上交所(sh)/深交所(sz)。
	if len(sym) == 6 && isAllDigits(sym) {
		switch sym[0] {
		case '6', '5', '9':
			return "sh" + sym
		case '0', '2', '3':
			return "sz" + sym
		}
		return sym
	}

	// 港股：纯数字补 hk 前缀（兼容 market 字段缺失/不一致）
	if (market == "港股" || market == "HK") && isAllDigits(sym) {
		return "hk" + sym
	}

	return sym
}

// isAllDigits reports whether s consists solely of ASCII digits.
func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
