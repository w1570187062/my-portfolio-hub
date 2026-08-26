package api

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// AnalysisResponse contains full technical analysis results.
type AnalysisResponse struct {
	ID          int                       `json:"id"`
	Name        string                    `json:"name"`
	Symbol      string                    `json:"symbol"`
	Category    string                    `json:"category"`
	Market      string                    `json:"market"`
	Price       float64                   `json:"price"`
	Indicators  *market.IndicatorsResult  `json:"indicators,omitempty"`
	Probability *market.ProbabilityResult `json:"probability,omitempty"`
	Error       string                    `json:"error,omitempty"`
	GeneratedAt string                    `json:"generated_at"` // 分析生成时间（本地时区）
	Series      []market.KlineBar         `json:"series,omitempty"` // 已拉取的日K线(OHLC)，用于前端迷你K线展示
}

// getAnalysis returns technical analysis for a holding.
// GET /api/analysis/:id
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

	// Fund: if linked_symbol is set, use it for analysis; otherwise not supported
	if h.Category == "fund" {
		if h.LinkedSymbol == "" {
			resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
			c.JSON(http.StatusOK, gin.H{"analysis": resp, "message": "该基金未设置关联股票代码，不支持技术分析"})
			return
		}
		// Use linked symbol for K-line analysis
		symbol := resolveSymbol(h.LinkedSymbol, h.Market)
	bars, err := market.FetchKline(symbol)
	resp.Series = bars
	if err != nil {
		log.Printf("[analysis] fund linked kline for %s -> %s failed: %v", h.Name, symbol, err)
		resp.Error = "获取关联股票K线数据失败：" + err.Error()
		resp.Symbol = h.LinkedSymbol // show which symbol was used
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}
	if len(bars) < 30 {
		resp.Error = "K线数据不足（需要至少30个交易日）"
		resp.Symbol = h.LinkedSymbol
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}
		ind := market.CalculateIndicators(bars)
	resp.Indicators = ind
	resp.Price = ind.Price
	resp.Symbol = h.LinkedSymbol
	prob := market.CalculateProbability(ind)
	resp.Probability = prob
	resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
	c.JSON(http.StatusOK, gin.H{"analysis": resp})
	return
	}

	// Resolve symbol for data fetching
	symbol := resolveSymbol(h.Symbol, h.Market)

	// Fetch K-line data
	bars, err := market.FetchKline(symbol)
	resp.Series = bars
	if err != nil {
		log.Printf("[analysis] fetch kline for %s (%s) failed: %v", h.Name, symbol, err)
		resp.Error = "获取K线数据失败：" + err.Error()
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}

	if len(bars) < 30 {
		resp.Error = "K线数据不足（需要至少30个交易日）"
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}

	// Calculate indicators
	ind := market.CalculateIndicators(bars)
	resp.Indicators = ind
	resp.Price = ind.Price

	// Calculate probability
	prob := market.CalculateProbability(ind)
	resp.Probability = prob

	resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
	c.JSON(http.StatusOK, gin.H{"analysis": resp})
}

// resolveSymbol converts the user-friendly symbol to the API format.
func resolveSymbol(symbol, market string) string {
	sym := strings.ToLower(strings.TrimSpace(symbol))

	// If symbol already has prefix (sh/sz/hk), use as-is
	if strings.HasPrefix(sym, "sh") || strings.HasPrefix(sym, "sz") || strings.HasPrefix(sym, "hk") {
		return sym
	}

	// 6 位纯数字 → 视为 A 股，按首位判定上交所(sh)/深交所(sz)。
	// 不依赖 market 字段（market 缺失或写法不一致时仍能正确取数）。
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
