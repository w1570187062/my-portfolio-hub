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
	Valuation    *market.ValuationResult  `json:"valuation,omitempty"` // 股票 PE/PB 历史百分位（仅股票，基金/ETF 不填）
}

// signalFromUpPct maps the bullish probability to a normalized signal used by
// both the auto-analysis (角标) and the on-demand analysis endpoint, so the
// badge always agrees with the modal's verdict. Delegates to market.SignalFromUpPct,
// the single source of truth also used by the daily backtest.
func signalFromUpPct(upPct float64) string {
	return market.SignalFromUpPct(upPct)
}

// ---- 分析缓存新鲜度（命中缓存也做新鲜度校验）----
//
// 背景：美股行情来自新浪日K，其更新滞后于美股收盘。若在源端尚未更新时（如 07:00 定时快照）
// 首写了当日缓存，则会带着「落后的末根K线」把一整天钉死——因为缓存键是 (symbol, 当日)，
// 命中即直接返回、当日不再重取。这里在缓存命中时追加两道校验，任一不满足即判定为不新鲜，
// 回落到实时抓取并 upsert 覆盖：
//  1) 缓存的最后一根K线日期 < 期望的最近交易日（期望值按市场与北京时间粗算，忽略节假日）；
//  2) 距上次生成超过硬 TTL。
// 为免源端持续滞后时频繁抓取，第 1 条还需超过最小重取间隔才真正重取（否则仍视为新鲜）。
const (
	analysisCacheHardTTL    = 6 * time.Hour
	analysisCacheMinRefresh = 30 * time.Minute
)

// beijing 用于把缓存里的本地时间字符串解析回 time.Time。
var beijing = time.FixedZone("CST", 8*3600)

// expectedLatestBarDate 估算「此刻应已可获得的最新交易日」（YYYY-MM-DD）。
// 只按工作日回退、忽略节假日：宁可偶尔多抓一次，也不长期钉在旧数据上。
// 美股：收盘约在北京时间次日 05:00，故以 now-29h 为界；其余市场按 now-16h 处理。
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
		// 末根K线落后于期望交易日：仅当超过最小重取间隔才判定为不新鲜，避免源端滞后时频繁抓取
		if age >= analysisCacheMinRefresh {
			return false
		}
	}
	return true
}

// getAnalysis returns technical analysis for a holding.
// GET /holdings/:id/analysis
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

	// ① 查缓存：当日命中且「新鲜」则直接反序列化返回，跳过 K线抓取（毫秒级）。
	// 若末根K线落后于期望交易日或超过硬 TTL（analysisCacheFresh），则视为不新鲜，回落到实时抓取。
	if row, e := db.GetAnalysisCache(symbol, today); e == nil && row != nil && analysisCacheFresh(row, h.Market) {
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
				// 估值（仅股票）：命中缓存则反序列化估值 JSON；若由概览预热的缓存未带估值，按需补抓一次避免页签退化
				if h.Category == "stock" {
					if row.ValuationJSON != "" && row.ValuationJSON != "{}" {
						var v market.ValuationResult
						if e2 := json.Unmarshal([]byte(row.ValuationJSON), &v); e2 == nil && (v.PE > 0 || len(v.Points) > 0) {
							resp.Valuation = &v
						}
					} else if v, ve := market.GetValuationHistory(symForFetch, h.Market, bars); ve == nil {
						resp.Valuation = v
					}
				}
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

	// 估值（仅股票）：A股用东财真实历史 PE_TTM/PB_MRQ；美股/港股用腾讯 PE + K线估算
	if h.Category == "stock" {
		if v, ve := market.GetValuationHistory(symbol, h.Market, bars); ve == nil {
			resp.Valuation = v
		} else {
			log.Printf("[analysis] valuation for %s (%s) failed: %v", h.Name, symbol, ve)
		}
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
		valJSON := "{}"
		if resp.Valuation != nil {
			if b, e := json.Marshal(resp.Valuation); e == nil {
				valJSON = string(b)
			}
		}
		if e := db.SaveAnalysisCache(symbol, today, string(barsJSON), string(indJSON), string(probJSON), string(dailySigsJSON), valJSON, genAt); e != nil {
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

