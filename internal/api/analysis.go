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

// AnalysisResponse contains full technical analysis results.
type AnalysisResponse struct {
	ID           int                      `json:"id"`
	Name         string                   `json:"name"`
	Symbol       string                   `json:"symbol"`
	Category     string                   `json:"category"`
	Market       string                   `json:"market"`
	Price        float64                  `json:"price"`
	Indicators   *market.IndicatorsResult  `json:"indicators,omitempty"`
	Probability  *market.ProbabilityResult `json:"probability,omitempty"`
	Signal       string                   `json:"signal,omitempty"`                        // 归一化信号：buy/sell/hold（与角标一致，回写 holdings.analysis_signal）
	UpPct        float64                  `json:"up_pct,omitempty"`                       // 看涨概率（与概览买入评级一致）
	DailySignals []market.DailySignal     `json:"daily_signals,omitempty"`                // 逐日历史信号 + 次日收盘，用于悬停评级与回测胜率
	Error        string                   `json:"error,omitempty"`
	GeneratedAt  string                   `json:"generated_at"` // 分析生成时间（本地时区）
	Series       []market.KlineBar        `json:"series,omitempty"` // 已拉取的日K线(OHLC)，用于前端迷你K线展示
}

// signalFromUpPct maps the bullish probability to a normalized signal used by
// both the auto-analysis (角标) and the on-demand analysis endpoint, so the
// badge always agrees with the modal's verdict. Delegates to market.SignalFromUpPct,
// the single source of truth also used by the daily backtest.
func signalFromUpPct(upPct float64) string {
	return market.SignalFromUpPct(upPct)
}

// getAnalysis returns technical analysis for a holding.
// GET /api/analysis/:id
//
// 缓存策略：按 (规范化 symbol, 当日 YYYY-MM-DD) 缓存 K线+指标+概率+逐日信号 JSON。
// 同一交易日内多次打开分析弹框直接命中缓存，毫秒级返回；跨日自然失效。
// 注意：缓存命中时仍会回写持仓的 analysis_signal/up_pct（用户点开弹框视为最新结论）。
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

	// 确定用于取数的 symbol：基金用关联股票代码，股票用自身代码
	symForFetch := h.Symbol
	if h.Category == "fund" {
		symForFetch = h.LinkedSymbol
	}
	symbol := resolveSymbol(symForFetch, h.Market)
	today := time.Now().Format("2006-01-02")

	// ① 查缓存：当日命中则直接反序列化返回，跳过 K线抓取（毫秒级）
	if row, e := db.GetAnalysisCache(symbol, today); e == nil && row != nil {
		var bars []market.KlineBar
		if e2 := json.Unmarshal([]byte(row.BarsJSON), &bars); e2 == nil && len(bars) >= 30 {
			var ind market.IndicatorsResult
			if e2 := json.Unmarshal([]byte(row.IndicatorsJSON), &ind); e2 == nil {
				var prob market.ProbabilityResult
				_ = json.Unmarshal([]byte(row.ProbabilityJSON), &prob)
				var dailySigs []market.DailySignal
				_ = json.Unmarshal([]byte(row.DailySignalsJSON), &dailySigs)

				resp.Series = bars
				resp.Indicators = &ind
				resp.Price = ind.Price
				resp.Probability = &prob
				resp.DailySignals = dailySigs
				resp.Symbol = symForFetch
				resp.GeneratedAt = row.GeneratedAt
				// 缓存命中也回写持仓信号，使首页角标与弹框结论保持一致
				if prob.UpPct > 0 {
					resp.Signal = signalFromUpPct(prob.UpPct)
					resp.UpPct = prob.UpPct
					if e := db.UpdateAnalysis(h.ID, resp.Signal, prob.UpPct, time.Now().Format("2006-01-02 15:04:05")); e != nil {
						log.Printf("[analysis] 回写信号失败 id=%d: %v", h.ID, e)
					}
				}
				c.JSON(http.StatusOK, gin.H{"analysis": resp, "cache": true})
				return
			}
		}
		// 缓存反序列化失败：忽略缓存，继续走实时抓取
	}

	// ② 未命中缓存：实时抓取 K线 + 计算指标 + 落库缓存
	bars, err := market.FetchKline(symbol)
	resp.Series = bars
	if err != nil {
		log.Printf("[analysis] fetch kline for %s (%s) failed: %v", h.Name, symbol, err)
		resp.Error = "获取K线数据失败：" + err.Error()
		resp.Symbol = symForFetch
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}
	if len(bars) < 30 {
		resp.Error = "K线数据不足（需要至少30个交易日）"
		resp.Symbol = symForFetch
		resp.GeneratedAt = time.Now().Format("2006-01-02 15:04:05")
		c.JSON(http.StatusOK, gin.H{"analysis": resp})
		return
	}

	ind := market.CalculateIndicators(bars)
	resp.Indicators = ind
	resp.Price = ind.Price
	resp.Symbol = symForFetch
	prob := market.CalculateProbability(ind)
	resp.Probability = prob
	resp.DailySignals = market.ComputeDailySignals(bars)
	genAt := time.Now().Format("2006-01-02 15:04:05")
	resp.GeneratedAt = genAt

	if prob != nil {
		// 回写最新信号到持仓，使首页角标与弹框结论保持一致（中性→hold，不展示角标）
		resp.Signal = signalFromUpPct(prob.UpPct)
		resp.UpPct = prob.UpPct
		if err := db.UpdateAnalysis(h.ID, resp.Signal, prob.UpPct, genAt); err != nil {
			log.Printf("[analysis] 回写信号失败 id=%d: %v", h.ID, err)
		}
	}

	// 异步落库缓存（失败不影响响应）
	go func() {
		barsJSON, _ := json.Marshal(bars)
		indJSON, _ := json.Marshal(ind)
		probJSON, _ := json.Marshal(prob)
		dailySigsJSON, _ := json.Marshal(resp.DailySignals)
		if e := db.SaveAnalysisCache(symbol, today, string(barsJSON), string(indJSON), string(probJSON), string(dailySigsJSON), genAt); e != nil {
			log.Printf("[analysis] save cache %s %s failed: %v", symbol, today, e)
		}
	}()

	c.JSON(http.StatusOK, gin.H{"analysis": resp, "cache": false})
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
