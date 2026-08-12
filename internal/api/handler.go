package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/auth"
	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// HoldingView enriches a Holding with computed values (server-side).
type HoldingView struct {
	db.Holding
	MarketValue float64 `json:"market_value"`
	CostValue   float64 `json:"cost_value"`
	Pnl         float64 `json:"pnl"`
	PnlPct      float64 `json:"pnl_pct"`
	DayPnl      float64 `json:"day_pnl"`
	DayPnlPct   float64 `json:"day_pnl_pct"`
	HoldingDays int     `json:"holding_days"` // 持仓天数，从 buy_date 算起
}

// usMarketClosedCST reports whether the most recent US trading session (US Eastern)
// has already closed in Beijing time. US stocks close at 16:00 ET, which is 04:00
// (EDT, summer) or 05:00 (EST, winter) Beijing time of the next day. Until that
// close, a US holding's daily P&L is not settled, so callers should treat it as 0
// and only show the settled daily P&L after the session closes (T+1 in Beijing).
// usMarketInSession reports whether the US regular trading session (09:30–16:00 ET,
// Mon–Fri) is currently in progress. It drives US-stock daily P&L T+1: while a session
// is live the price is intraday and not final, so we hold the daily P&L at 0. Once the
// session is closed, (current − prevClose) equals the LAST completed US session's change,
// which the daily snapshot (run at Beijing 15:15, between US sessions) records against the
// current China trading day. A Friday US session closes over the weekend, so it is
// naturally merged into the following Monday's snapshot; weekends produce no records.
func usMarketInSession() bool {
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)
	offset := -5 * 3600
	if usDSTActive(now) {
		offset = -4 * 3600
	}
	et := now.In(time.FixedZone("US", offset))
	if wd := et.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	mins := et.Hour()*60 + et.Minute()
	return mins >= 9*60+30 && mins < 16*60
}

// usDSTActive reports whether US Eastern daylight saving time is in effect
// (2nd Sunday of March -> 1st Sunday of November). Day-level precision is enough
// for the daily-close check.
func usDSTActive(t time.Time) bool {
	u := t.UTC()
	y := u.Year()
	start := nthSundayUTC(y, 3, 2)
	end := nthSundayUTC(y, 11, 1)
	return !u.Before(start) && u.Before(end)
}

func nthSundayUTC(year, month, n int) time.Time {
	d := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	for d.Weekday() != time.Sunday {
		d = d.AddDate(0, 0, 1)
	}
	return d.AddDate(0, 0, (n-1)*7)
}

func enrich(h db.Holding) HoldingView {
	mv := h.Quantity * h.CurrentPrice
	cv := h.Quantity * h.CostPrice
	pnl := mv - cv
	var pct float64
	if cv > 0 {
		pct = pnl / cv * 100
	}
	dayPnl := 0.0
	dayPnlPct := 0.0
	today := time.Now().Format("2006-01-02")
	if h.PrevClose > 0 {
		dayPnl = (h.CurrentPrice - h.PrevClose) * h.Quantity
		if prevMv := h.PrevClose * h.Quantity; prevMv > 0 {
			dayPnlPct = dayPnl / prevMv * 100
		}
	} else if prev, ok, _ := db.GetPrevClose(h.Symbol, today); ok {
		dayPnl = (h.CurrentPrice - prev) * h.Quantity
		if prevMv := prev * h.Quantity; prevMv > 0 {
			dayPnlPct = dayPnl / prevMv * 100
		}
	}
	// 基金净值一般北京时间 21:00 后公布，此前使用昨日数据算出的「当日盈亏」实为前一交易日数据，视为 0。
	// 与 doSnapshot() 的 bjHour < 21 闸门保持一致。
	if h.Category == "fund" {
		bjHour := time.Now().In(time.FixedZone("CST", 8*3600)).Hour()
		if bjHour < 21 {
			dayPnl = 0
			dayPnlPct = 0
		}
	}
	// 美股 T+1：仅在美股盘中（美东 9:30–16:00）把当日盈亏视为 0（盘中浮动不算数）；
	// 收盘后 (现价-昨收) 即最近一个已收盘美股交易日的涨跌，于下一个中国交易日体现，
	// 因此周五美股（周末收盘）会自然合并进下周一的盈亏。
	if h.Market == "美股" && usMarketInSession() {
		dayPnl = 0
		dayPnlPct = 0
	}
	return HoldingView{Holding: h, MarketValue: mv, CostValue: cv, Pnl: pnl, PnlPct: pct, DayPnl: dayPnl, DayPnlPct: dayPnlPct, HoldingDays: db.CalcHoldingDays(h.BuyDate)}
}

func RegisterRoutes(r *gin.Engine) {
	r.POST("/api/login", login)
	g := r.Group("/api")
	// 登录逻辑已注释（保留模块代码）：如需恢复鉴权，取消下一行注释即可
	// g.Use(authRequired())
	{
		g.GET("/holdings", listHoldings)
		g.POST("/holdings", createHolding)
		g.PUT("/holdings/:id", updateHolding)
		g.DELETE("/holdings/:id", deleteHolding)
		g.GET("/holdings/:id/analysis", getAnalysis)
		g.POST("/refresh", refresh)
		g.POST("/holdings/:id/refresh", refreshOne)
		g.POST("/holdings/:id/adjust", adjustHolding)
		g.GET("/holdings/:id/transactions", listTransactions)
		g.GET("/guides", listGuides)
		g.POST("/guides", createGuide)
		g.GET("/guides/:id", getGuide)
		g.PUT("/guides/:id", updateGuide)
		g.DELETE("/guides/:id", deleteGuide)
		g.GET("/summary", summary)
		g.GET("/rate", rate)
		g.GET("/fx", fxInfo)
		g.POST("/pnl/snapshot", snapshotHandler)
		g.GET("/pnl/history", pnlHistory)
		g.GET("/holdings/:id/pnl-history", holdingPnlHistory)
		g.GET("/ai/settings", aiSettingsGet)
		g.POST("/ai/settings", aiSettingsPost)
		g.POST("/ai/summary", aiSummary)
		g.GET("/ai/history", aiHistoryGet)

		// 通知渠道：配置读写 + 测试发送
		g.GET("/notify/settings", notifySettingsGet)
		g.POST("/notify/settings", notifySettingsPost)
		g.POST("/notify/test", notifyTest)

		// 资产全景：来源 / 理财 / 负债 / 消费 / 汇总 / AI 总结
		g.GET("/asset/overview", assetOverview)
		g.GET("/asset/sources", listSources)
		g.POST("/asset/sources", createSource)
		g.PUT("/asset/sources/:id", updateSource)
		g.DELETE("/asset/sources/:id", deleteSource)
		g.GET("/asset/wealth", listWealth)
		g.POST("/asset/wealth", createWealth)
		g.PUT("/asset/wealth/:id", updateWealth)
		g.DELETE("/asset/wealth/:id", deleteWealth)
		g.POST("/asset/wealth/snapshots", assetWealthSnapshotsPost)
		g.GET("/asset/wealth/:id/history", assetWealthHistory)
		g.GET("/asset/cash", listCash)
		g.POST("/asset/cash", createCash)
		g.PUT("/asset/cash/:id", updateCash)
		g.DELETE("/asset/cash/:id", deleteCash)
		g.GET("/asset/liabilities", listLiabilities)
		g.POST("/asset/liabilities", createLiability)
		g.PUT("/asset/liabilities/:id", updateLiability)
		g.DELETE("/asset/liabilities/:id", deleteLiability)
		g.GET("/asset/consumptions", listConsumptionsH)
		g.POST("/asset/consumptions", createConsumption)
		g.PUT("/asset/consumptions/:id", updateConsumption)
		g.DELETE("/asset/consumptions/:id", deleteConsumption)
		g.POST("/asset/summary", assetSummary)

		// 小工具计算器录入持久化（equity / usd）
		g.GET("/calc/inputs", calcInputsGet)
		g.PUT("/calc/inputs", calcInputsPut)
		g.DELETE("/calc/inputs", calcInputsDelete)
	}
}

func login(c *gin.Context) {
	var b struct {
		User string `json:"user"`
		Pass string `json:"pass"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if !auth.Check(b.User, b.Pass) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": auth.Issue(b.User)})
}

func authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		tok := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if tok != "" && auth.Valid(tok) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	}
}

func listHoldings(c *gin.Context) {
	hs, err := db.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]HoldingView, 0, len(hs))
	for _, h := range hs {
		out = append(out, enrich(h))
	}
	c.JSON(http.StatusOK, gin.H{"holdings": out, "day_date": time.Now().Format("2006-01-02")})
}

func createHolding(c *gin.Context) {
	var h db.Holding
	if err := c.ShouldBindJSON(&h); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	normalize(&h)
	if exists, e := db.ExistsBySymbol(h.Symbol, 0); e == nil && exists {
		c.JSON(http.StatusConflict, gin.H{"error": "该代码已存在，请勿重复添加"})
		return
	}
	id, err := db.Create(&h)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.ID = id
	c.JSON(http.StatusOK, gin.H{"holding": enrich(h)})
}

func updateHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var h db.Holding
	if err := c.ShouldBindJSON(&h); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	h.ID = id
	normalize(&h)
	if exists, e := db.ExistsBySymbol(h.Symbol, id); e == nil && exists {
		c.JSON(http.StatusConflict, gin.H{"error": "该代码已存在，请勿与其他持仓重复"})
		return
	}
	if err := db.Update(&h); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"holding": enrich(h)})
}

func deleteHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.Delete(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// adjustHolding applies a 加仓/减仓 transaction to a holding and returns the
// updated (enriched) holding plus this transaction's realized P&L and the
// cumulative realized P&L across all of the holding's transactions.
func adjustHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var req struct {
		Type     string  `json:"type"`
		Quantity float64 `json:"quantity"`
		Price    float64 `json:"price"`
		Fee      float64 `json:"fee"`
		Note     string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	h, realized, err := db.AdjustHolding(id, req.Type, req.Quantity, req.Price, req.Fee, strings.TrimSpace(req.Note))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	realizedTotal, _ := db.SumRealizedPnl(id)
	c.JSON(http.StatusOK, gin.H{
		"holding":        enrich(*h),
		"realized_pnl":   realized,
		"realized_total": realizedTotal,
	})
}

// listTransactions returns a holding's 加仓/减仓 history plus cumulative realized P&L.
func listTransactions(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	txs, err := db.ListPositionTx(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	total, _ := db.SumRealizedPnl(id)
	c.JSON(http.StatusOK, gin.H{"transactions": txs, "realized_total": total})
}

func normalize(h *db.Holding) {
	h.Name = strings.TrimSpace(h.Name)
	h.Symbol = strings.ToUpper(strings.TrimSpace(h.Symbol))
	if h.Category == "" {
		h.Category = "stock"
	}
	if h.Currency == "" {
		h.Currency = "CNY"
	}
	// Enforce the two-level category/market integrity.
	if h.Category == "fund" {
		switch h.Market {
		case "QDII", "债券", "股票", "商品", "货币":
		default:
			h.Market = "股票"
		}
	} else {
		switch h.Market {
		case "A股", "美股", "港股":
		default:
			h.Market = "A股"
		}
	}
}

func refresh(c *gin.Context) {
	hs, failed, err := refreshAllQuotes()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rate, degraded := market.GetUSDRate()
	rateErr := ""
	if degraded {
		rateErr = "汇率源暂不可用，已回退至最近一次成功获取的汇率"
	}
	out := make([]HoldingView, 0, len(hs))
	for _, h := range hs {
		out = append(out, enrich(h))
	}
	_ = doSnapshot()
	NotifyNetValueUpdated("手动刷新行情")
	c.JSON(http.StatusOK, gin.H{"holdings": out, "rate": rate, "rate_degraded": degraded, "rate_error": rateErr, "failed": failed})
}

// refreshOne refreshes the latest quote for a single holding, persists it, and
// re-snapshots the daily P&L so trend/calendar stay consistent.
func refreshOne(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	h, err := db.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	var qErr error
	var q *market.Quote
	switch h.Category {
	case "fund":
		var e error
		if h.Market == "港股" {
			q, e = market.GetStockQuote(h.Symbol)
			if e == nil {
				h.CurrentPrice = q.CurrentPrice
				h.PrevClose = q.PrevClose
				_ = db.UpdatePrice(h.ID, q.CurrentPrice, q.PrevClose)
				log.Printf("[refreshOne] %s(%s) 类型=港股基金 现价=%.4f 昨收=%.4f 已落库", h.Name, h.Symbol, q.CurrentPrice, q.PrevClose)
				recomputeBuyPlan(h)
			}
		} else {
			q, e = market.GetFundQuote(h.Symbol)
			if e == nil {
				h.CurrentPrice = q.CurrentPrice
				h.PrevClose = q.PrevClose
				_ = db.UpdatePrice(h.ID, q.CurrentPrice, q.PrevClose)
				log.Printf("[refreshOne] %s(%s) 类型=fund 现价=%.4f 昨收=%.4f 已落库", h.Name, h.Symbol, q.CurrentPrice, q.PrevClose)
				recomputeBuyPlan(h)
			}
		}
		if e != nil {
			qErr = e
			log.Printf("[refreshOne] %s(%s) fund 失败: %s", h.Name, h.Symbol, e.Error())
		}
	default: // stock (A股 / 港股 / 美股 all via Tencent qt.gtimg.cn)
		q2, e := market.GetStockQuote(h.Symbol)
		if e == nil {
			q = q2
			h.CurrentPrice = q.CurrentPrice
			h.PrevClose = q.PrevClose
			_ = db.UpdatePrice(h.ID, q.CurrentPrice, q.PrevClose)
			log.Printf("[refreshOne] %s(%s) 类型=stock 现价=%.4f 昨收=%.4f 已落库", h.Name, h.Symbol, q.CurrentPrice, q.PrevClose)
		} else {
			qErr = e
			log.Printf("[refreshOne] %s(%s) stock 失败: %s", h.Name, h.Symbol, e.Error())
		}
	}
	if qErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": qErr.Error()})
		return
	}
	// Sync the holding name from the upstream API (fixes garbled / outdated names).
	if q != nil && q.Name != "" && q.Name != h.Name {
		if err := db.UpdateName(h.ID, q.Name); err == nil {
			h.Name = q.Name
			log.Printf("[refreshOne] %s(%s) 名称已同步为 %s", h.Symbol, h.Symbol, q.Name)
		}
	}
	_ = doSnapshot()
	NotifyNetValueUpdated("手动刷新单只持仓")
	c.JSON(http.StatusOK, gin.H{"holding": enrich(*h)})
}

// recomputeBuyPlan recomputes the 补仓计划 for a fund holding that has a
// linked_symbol set, and persists it into holdings.buy_plan. It is triggered by
// both the manual net-value refresh and the scheduled 21:00 snapshot (via
// refreshAllQuotes / refreshOne). Results are NOT written into the note column;
// the 操作指南弹框 reads holdings.buy_plan to display them.
func recomputeBuyPlan(h *db.Holding) {
	if h.Category != "fund" || h.LinkedSymbol == "" {
		return
	}
	plan := market.ComputeLinkedETFBuyPlan(h.LinkedSymbol, h.Symbol, h.Market, h.CostPrice, h.CurrentPrice, h.Quantity)
	b, err := json.Marshal(plan)
	if err != nil {
		log.Printf("[buyplan] %s 序列化失败: %s", h.Symbol, err.Error())
		return
	}
	if err := db.SaveBuyPlan(h.ID, string(b)); err != nil {
		log.Printf("[buyplan] %s 落库失败: %s", h.Symbol, err.Error())
		return
	}
	log.Printf("[buyplan] %s 已重算补仓计划并落库（held=%.0f 亏损=%.0f 弹药上限=%.0f）",
		h.Symbol, plan.HeldValue, plan.LossAmt, plan.AmmoCap)
}

func rate(c *gin.Context) {
	r, degraded := market.GetUSDRate()
	c.JSON(http.StatusOK, gin.H{"rate": r, "rate_degraded": degraded})
}

// fxInfo returns the cached USD/HKD/RMB exchange rates and last update time for display.
func fxInfo(c *gin.Context) {
	c.JSON(http.StatusOK, market.GetFXInfo())
}

func summary(c *gin.Context) {
	hs, err := db.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cnyRate, hkdRate, degraded := market.GetFXRates()
	hkdToCny := 1.0
	if hkdRate > 0 {
		hkdToCny = cnyRate / hkdRate
	}
	var (
		cnyMV, cnyCV, cnyPnl     float64
		usdMV, usdCV, usdPnl     float64
		hkdMV, hkdCV, hkdPnl     float64
		totalCNY, totalCostCNY   float64
		unsupported              = []string{}
	)
	for _, h := range hs {
		mv := h.Quantity * h.CurrentPrice
		cv := h.Quantity * h.CostPrice
		pnl := mv - cv
		switch h.Currency {
		case "CNY":
			cnyMV += mv
			cnyCV += cv
			cnyPnl += pnl
			totalCNY += mv
			totalCostCNY += cv
		case "USD":
			usdMV += mv
			usdCV += cv
			usdPnl += pnl
			totalCNY += mv * cnyRate
			totalCostCNY += cv * cnyRate
		case "HKD":
			hkdMV += mv
			hkdCV += cv
			hkdPnl += pnl
			totalCNY += mv * hkdToCny
			totalCostCNY += cv * hkdToCny
		default:
			// 未知币种仍按 CNY 计入总额，避免被丢弃；但收集起来返回给
			// 调用方，便于排查，而不是静默错算成 CNY。
			cnyMV += mv
			cnyCV += cv
			cnyPnl += pnl
			totalCNY += mv
			totalCostCNY += cv
			unsupported = append(unsupported, fmt.Sprintf("%s(%s)", h.Symbol, h.Currency))
		}
	}
	totalPnl := totalCNY - totalCostCNY
	var totalPct float64
	if totalCostCNY > 0 {
		totalPct = totalPnl / totalCostCNY * 100
	}
	var cnyPct, usdPct, hkdPct float64
	if cnyCV > 0 {
		cnyPct = cnyPnl / cnyCV * 100
	}
	if usdCV > 0 {
		usdPct = usdPnl / usdCV * 100
	}
	if hkdCV > 0 {
		hkdPct = hkdPnl / hkdCV * 100
	}
	c.JSON(http.StatusOK, gin.H{
		"rate":                cnyRate,
		"rate_degraded":       degraded,
		"unsupported_currencies": unsupported,
		"hkd_rate":            hkdToCny,
		"cny_market_value":    cnyMV,
		"cny_cost_value":      cnyCV,
		"cny_pnl":             cnyPnl,
		"cny_pnl_pct":         cnyPct,
		"usd_market_value":    usdMV,
		"usd_cost_value":      usdCV,
		"usd_pnl":             usdPnl,
		"usd_pnl_pct":         usdPct,
		"usd_market_value_cny": usdMV * cnyRate,
		"hkd_market_value":    hkdMV,
		"hkd_cost_value":      hkdCV,
		"hkd_pnl":             hkdPnl,
		"hkd_pnl_pct":         hkdPct,
		"hkd_market_value_cny": hkdMV * hkdToCny,
		"total_cny":           totalCNY,
		"total_cost_cny":      totalCostCNY,
		"total_pnl":           totalPnl,
		"total_pnl_pct":       totalPct,
	})
}

func errMsg(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// ---- Daily P&L snapshot ----

type symPnl struct {
	Symbol       string  `json:"symbol"`
	Name         string  `json:"name"`
	Pnl          float64 `json:"pnl"`
	PnlCNY       float64 `json:"pnl_cny"`
	Currency     string  `json:"currency"`
	CurrentPrice float64 `json:"current_price"`
	ChangePct    float64 `json:"change_pct"`
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// ---- 中国交易日判断 ----
// 中国法定节假日（非交易日），按 "2006-01-02" 标注。
// 来源：国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）。
// 注意：每年需把 cnHolidays / cnWorkdays 更新为最新一年的放假调休安排。
var cnHolidays = map[string]bool{
	"2026-01-01": true, "2026-01-02": true, "2026-01-03": true, // 元旦
	"2026-02-15": true, "2026-02-16": true, "2026-02-17": true,
	"2026-02-18": true, "2026-02-19": true, "2026-02-20": true,
	"2026-02-21": true, "2026-02-22": true, "2026-02-23": true, // 春节
	"2026-04-04": true, "2026-04-05": true, "2026-04-06": true, // 清明
	"2026-05-01": true, "2026-05-02": true, "2026-05-03": true,
	"2026-05-04": true, "2026-05-05": true, // 劳动节
	"2026-06-19": true, "2026-06-20": true, "2026-06-21": true, // 端午
	"2026-09-25": true, "2026-09-26": true, "2026-09-27": true, // 中秋
	"2026-10-01": true, "2026-10-02": true, "2026-10-03": true,
	"2026-10-04": true, "2026-10-05": true, "2026-10-06": true,
	"2026-10-07": true, // 国庆
}

// 中国调休补班日（周末上班，算交易日），按 "2006-01-02" 标注。
var cnWorkdays = map[string]bool{
	"2026-01-04": true,  // 元旦调休
	"2026-02-14": true,  // 春节调休
	"2026-02-28": true,  // 春节调休
	"2026-05-09": true,  // 劳动节调休
	"2026-09-20": true,  // 国庆调休
	"2026-10-10": true,  // 国庆调休
}

// isTradingDayCN 判断给定日期是否为中国 A 股交易日：
// 周末默认非交易日，但调休补班日算交易日；法定节假日非交易日。
func isTradingDayCN(t time.Time) bool {
	key := t.Format("2006-01-02")
	if cnWorkdays[key] {
		return true
	}
	if cnHolidays[key] {
		return false
	}
	wd := t.Weekday()
	return wd != time.Saturday && wd != time.Sunday
}

// refreshAllQuotes fetches the latest quote for every holding, persists
// CurrentPrice/PrevClose to the DB, and returns the updated slice plus any
// symbols that failed to refresh. Used by both the manual refresh endpoint and
// the scheduled/time-triggered snapshots so each snapshot computes from fresh prices.
func refreshAllQuotes() ([]db.Holding, []string, error) {
	hs, err := db.List()
	if err != nil {
		return nil, nil, err
	}
	var failed []string
	for i := range hs {
		switch hs[i].Category {
		case "fund":
			var q *market.Quote
			var e error
			if hs[i].Market == "港股" {
				q, e = market.GetStockQuote(hs[i].Symbol)
			} else {
				q, e = market.GetFundQuote(hs[i].Symbol)
			}
			if e == nil {
				hs[i].CurrentPrice = q.CurrentPrice
				hs[i].PrevClose = q.PrevClose
				_ = db.UpdatePrice(hs[i].ID, q.CurrentPrice, q.PrevClose)
				if q.Name != "" && q.Name != hs[i].Name {
					if err := db.UpdateName(hs[i].ID, q.Name); err == nil {
						hs[i].Name = q.Name
					}
				}
				recomputeBuyPlan(&hs[i])
			} else {
				failed = append(failed, fmt.Sprintf("%s: %s", hs[i].Symbol, e.Error()))
			}
		default: // stock (A股 / 港股 / 美股 all via Tencent qt.gtimg.cn)
			if q, e := market.GetStockQuote(hs[i].Symbol); e == nil {
				hs[i].CurrentPrice = q.CurrentPrice
				hs[i].PrevClose = q.PrevClose
				_ = db.UpdatePrice(hs[i].ID, q.CurrentPrice, q.PrevClose)
				if q.Name != "" && q.Name != hs[i].Name {
					if err := db.UpdateName(hs[i].ID, q.Name); err == nil {
						hs[i].Name = q.Name
					}
				}
			} else {
				failed = append(failed, fmt.Sprintf("%s: %s", hs[i].Symbol, e.Error()))
			}
		}
	}
	return hs, failed, nil
}

// doSnapshot records today's closing prices and computes the daily P&L vs the previous
// recorded day. Daily P&L = Σ (today's close − previous close) × quantity, per holding.
// 非交易日（周末/法定节假日）不记录，避免污染盈亏日历与走势。
// 每条持仓的当日盈亏按其类别的"数据就绪时间"分时段计入（见下方 switch）：
//   美股→美东收盘后(T+1)、A股→15:00后、港股→16:00后、基金→21:00后；未到时间记为 0。
func doSnapshot() error {
	now := time.Now()
	bj := now.In(time.FixedZone("CST", 8*3600))
	bjHour := bj.Hour()
	if !isTradingDayCN(now) {
		log.Printf("[snapshot] %s 非交易日（周末/节假日），跳过当日盈亏记录", now.Format("2006-01-02"))
		return nil
	}
	hs, err := db.List()
	if err != nil {
		return err
	}
	cnyRate, hkdRate, fxDegraded := market.GetFXRates()
	if fxDegraded {
		log.Printf("[snapshot] 汇率源降级，使用上次成功汇率 CNY=%.4f HKD=%.4f", cnyRate, hkdRate)
	}
	hkdToCny := 1.0
	if hkdRate > 0 {
		hkdToCny = cnyRate / hkdRate
	}
	today := now.Format("2006-01-02")
	var totalCNY, totalUSD float64
	byCat := map[string]float64{"stock": 0, "fund": 0}
	byCur := map[string]float64{"CNY": 0, "USD": 0, "HKD": 0}
	var bySym []symPnl
	for i := range hs {
		h := hs[i]
		if e := db.SavePriceDaily(today, h.Symbol, h.CurrentPrice); e != nil {
			return e
		}
		// Daily P&L basis must match the holdings list (enrich): prefer the
		// official previous close from the quote feed (h.PrevClose), and only
		// fall back to the last recorded daily close when it is missing. This
		// keeps pnl_daily (consumed by the trend chart & calendar) aligned with
		// the list's real-time daily P&L, and avoids a missed snapshot day
		// silently turning "daily P&L" into a multi-day cumulative figure.
		var dp float64
		switch {
		case h.Market == "美股":
			// 美股 T+1：仅在美东盘中（北京对应时段）把当日盈亏视为 0（盘中浮动不算数）；
			// 收盘后 (现价-昨收) 即最近一个已收盘美股交易日的涨跌，于下一中国交易日体现，
			// 故周五美股（周末凌晨收盘）自然合并进下周一的盈亏。
			if usMarketInSession() {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		case h.Category == "fund":
			// 基金净值一般北京时间 21:00 后公布，此前不计入当日盈亏。
			if bjHour < 21 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		case h.Market == "港股":
			// 港股 16:00 收盘，此前不计入当日盈亏。
			if bjHour < 16 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		default:
			// A股及其他股票 15:00 收盘，此前不计入当日盈亏。
			if bjHour < 15 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		}
		byCat[h.Category] += dp
		byCur[h.Currency] += dp
		var dpCNY float64
		switch h.Currency {
		case "USD":
			totalUSD += dp
			dpCNY = dp * cnyRate
			totalCNY += dpCNY
		case "HKD":
			dpCNY = dp * hkdToCny
			totalCNY += dpCNY
		default:
			dpCNY = dp
			totalCNY += dp
		}
		// 涨跌幅：现价相对昨收，昨收优先持仓字段，兜底查历史
		chgPct := 0.0
		prevClose := h.PrevClose
		if prevClose <= 0 {
			if p, ok2, e2 := db.GetPrevClose(h.Symbol, today); e2 == nil && ok2 {
				prevClose = p
			}
		}
		if prevClose > 0 {
			chgPct = (h.CurrentPrice - prevClose) / prevClose * 100
		}
		bySym = append(bySym, symPnl{Symbol: h.Symbol, Name: h.Name, Pnl: dp, PnlCNY: dpCNY, Currency: h.Currency, CurrentPrice: h.CurrentPrice, ChangePct: chgPct})
	}
	detail := fmt.Sprintf(`{"by_category":{"stock":%.2f,"fund":%.2f},"by_currency":{"CNY":%.2f,"USD":%.2f,"HKD":%.2f},"by_symbol":%s}`,
		byCat["stock"], byCat["fund"], byCur["CNY"], byCur["USD"], byCur["HKD"], mustJSON(bySym))
	return db.SavePnlDaily(today, totalCNY, totalUSD, cnyRate, detail)
}

// DoSnapshot is the exported entry for the daily ticker / startup backfill.
func DoSnapshot() error { return doSnapshot() }

// EnsureSnapshot records today's snapshot on startup if missing.
func EnsureSnapshot() {
	today := time.Now().Format("2006-01-02")
	has, _ := db.HasPnlDate(today)
	if has {
		return
	}
	if !isTradingDayCN(time.Now()) {
		return
	}
	if _, _, err := refreshAllQuotes(); err != nil {
		log.Printf("[snapshot] 启动补齐行情刷新失败: %v", err)
	}
	_ = doSnapshot()
}

// ScheduleDailySnapshot runs three time-triggered P&L snapshots per day, each
// aligned to when its asset class data becomes available:
//   - 美股: 每天 07:00（美东收盘后，T+1 体现最近一个美股交易日涨跌）
//   - A股:  每天 15:15（A股 15:00 收盘后）
//   - 基金: 每天 21:00（基金净值一般 21:00 后公布）
// 均跳过中国周末与法定节假日，避免盈亏日历/走势出现非交易日数据。
func ScheduleDailySnapshot() {
	scheduleAt(7, 0, "美股(07:00)", runScheduledSnapshot)
	scheduleAt(15, 15, "A股(15:15)", runScheduledSnapshot)
	scheduleAt(21, 0, "基金(21:00)", runScheduledSnapshot)
}

// scheduleAt fires fn once per day at the given Beijing time, skipping non-trading days.
func scheduleAt(hour, min int, label string, fn func(string)) {
	go func() {
		for {
			now := time.Now()
			loc := time.FixedZone("CST", 8*3600)
			next := time.Date(now.Year(), now.Month(), now.Day(), hour, min, 0, 0, loc)
			if !next.After(now) {
				next = next.AddDate(0, 0, 1)
			}
			time.Sleep(time.Until(next))
			fn(label)
		}
	}()
}

// runScheduledSnapshot refreshes quotes then records the daily P&L. doSnapshot
// self-gates each category by Beijing time, so only data ready "as of now" is recorded.
func runScheduledSnapshot(label string) {
	if !isTradingDayCN(time.Now()) {
		log.Printf("[snapshot] %s 非交易日，跳过定时盈亏记录", label)
		return
	}
	if _, _, err := refreshAllQuotes(); err != nil {
		log.Printf("[snapshot] %s 行情刷新失败: %v", label, err)
	}
	if err := doSnapshot(); err != nil {
		log.Printf("[snapshot] %s 快照失败: %v", label, err)
	} else {
		log.Printf("[snapshot] %s 定时盈亏记录完成", label)
		NotifyNetValueUpdated("定时快照(" + label + ")")
	}
}

// ---- 每日 00:00 归零结算 ----
// A股 / 美股 / 基金的「当日盈亏」在凌晨 0 点必须归零、不得计入下一交易日，但要落库。
// 现有白天快照(15:15 A股 / 21:00 基金 / 07:00 美股)已把当日盈亏写入 pnl_daily；
// 本模块负责两件事：(1) 兜底——若上一交易日的 pnl_daily 因白天漏跑而缺失，则基于
// price_daily 历史收盘价回填；(2) 归零——把每个持仓的 prev_close 重设为最新价，使新一天
// 实时「当日盈亏」从 0 起算(休市/开盘前保持 0，下一交易日开盘刷新行情后重新开始累计)。

// ScheduleMidnightReset fires once per day at 00:00 Beijing, finalizing the just-ended
// trading day's daily P&L (落库) and rebasing prev_close so the live 当日盈亏 resets to 0.
func ScheduleMidnightReset() {
	scheduleAt(0, 0, "midnight-reset", func(label string) {
		runMidnightReset()
		_ = db.SetMeta("last_day_reset", time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02"))
	})
}

// EnsureMidnightReset runs the settlement once on startup if today's reset hasn't
// happened yet (e.g. the process was down across midnight). Idempotent via meta flag.
func EnsureMidnightReset() {
	today := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")
	if v, ok, _ := db.GetMeta("last_day_reset"); ok && v == today {
		return
	}
	runMidnightReset()
	_ = db.SetMeta("last_day_reset", today)
}

// runMidnightReset finalizes the previous trading day's P&L (backfilling from stored
// daily closes when the daytime snapshot was missed) and rebases prev_close so the
// next day's live 当日盈亏 starts at zero.
func runMidnightReset() {
	now := time.Now().In(time.FixedZone("CST", 8*3600))
	settleDate := lastTradingDayBefore(now)
	if settleDate == "" {
		log.Printf("[midnight] 找不到上一交易日，跳过当日盈亏结算")
		return
	}
	// 1) 落库：若上一交易日的 pnl_daily 缺失，则基于 price_daily 回填（不受时段闸门约束）。
	if has, _ := db.HasPnlDate(settleDate); !has {
		if err := finalizePnlFromPrices(settleDate); err != nil {
			log.Printf("[midnight] %s 当日盈亏回填失败: %v", settleDate, err)
		} else {
			log.Printf("[midnight] %s 当日盈亏已落库（回填）", settleDate)
		}
	} else {
		log.Printf("[midnight] %s 当日盈亏已存在，跳过回填", settleDate)
	}
	// 2) 归零：把每个持仓的 prev_close 重设为最新价，使当日盈亏归零、不带入下一交易日。
	if err := db.RebasePrevCloseAll(); err != nil {
		log.Printf("[midnight] prev_close 归零失败: %v", err)
		return
	}
	log.Printf("[midnight] 当日盈亏已归零（prev_close 重设为最新价），结算日 %s", settleDate)
}

// lastTradingDayBefore returns the most recent China trading day strictly before t,
// or "" if none is found within a sane lookback window (should not happen).
func lastTradingDayBefore(t time.Time) string {
	d := t.AddDate(0, 0, -1)
	for i := 0; i < 30; i++ {
		if isTradingDayCN(d) {
			return d.Format("2006-01-02")
		}
		d = d.AddDate(0, 0, -1)
	}
	return ""
}

// finalizePnlFromPrices reconstructs a trading day's P&L from stored daily closes
// (price_daily): per symbol dp = (close_T − close_{T-1}) × quantity. This mirrors the
// dp formula in doSnapshot but is NOT gated by Beijing time, so it is safe to run at
// midnight when the daytime snapshot may have been missed.
func finalizePnlFromPrices(date string) error {
	closes, err := db.GetPriceDailyByDate(date)
	if err != nil {
		return err
	}
	if len(closes) == 0 {
		return nil // 当日无行情记录，无需落库
	}
	hs, err := db.List()
	if err != nil {
		return err
	}
	qtyBySym := map[string]float64{}
	for _, h := range hs {
		qtyBySym[h.Symbol] = h.Quantity
	}
	cnyRate, hkdRate, _ := market.GetFXRates()
	hkdToCny := 1.0
	if hkdRate > 0 {
		hkdToCny = cnyRate / hkdRate
	}
	var totalCNY, totalUSD float64
	byCat := map[string]float64{"stock": 0, "fund": 0}
	byCur := map[string]float64{"CNY": 0, "USD": 0, "HKD": 0}
	var bySym []symPnl
	for sym, close := range closes {
		prev, ok, e := db.GetPrevClose(sym, date)
		if e != nil {
			return e
		}
		if !ok {
			continue // 无基准则无法算当日盈亏
		}
		qty := qtyBySym[sym]
		if qty == 0 {
			continue
		}
		dp := (close - prev) * qty
		h := holdingBySymbol(hs, sym)
		cat := "stock"
		cur := "CNY"
		name := sym
		if h != nil {
			cat = h.Category
			cur = h.Currency
			name = h.Name
		}
		byCat[cat] += dp
		byCur[cur] += dp
		var dpCNY float64
		switch cur {
		case "USD":
			totalUSD += dp
			dpCNY = dp * cnyRate
			totalCNY += dpCNY
		case "HKD":
			dpCNY = dp * hkdToCny
			totalCNY += dpCNY
		default:
			dpCNY = dp
			totalCNY += dp
		}
		bySym = append(bySym, symPnl{Symbol: sym, Name: name, Pnl: dp, PnlCNY: dpCNY, Currency: cur})
	}
	detail := fmt.Sprintf(`{"by_category":{"stock":%.2f,"fund":%.2f},"by_currency":{"CNY":%.2f,"USD":%.2f,"HKD":%.2f},"by_symbol":%s}`,
		byCat["stock"], byCat["fund"], byCur["CNY"], byCur["USD"], byCur["HKD"], mustJSON(bySym))
	return db.SavePnlDaily(date, totalCNY, totalUSD, cnyRate, detail)
}

// holdingBySymbol returns a pointer to the holding with the given symbol, or nil.
func holdingBySymbol(hs []db.Holding, sym string) *db.Holding {
	for i := range hs {
		if hs[i].Symbol == sym {
			return &hs[i]
		}
	}
	return nil
}

func snapshotHandler(c *gin.Context) {
	if _, _, err := refreshAllQuotes(); err != nil {
		log.Printf("[snapshot] 手动快照行情刷新失败: %v", err)
	}
	if err := doSnapshot(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	NotifyNetValueUpdated("手动快照")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func pnlHistory(c *gin.Context) {
	rows, err := db.GetPnlHistory()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"history": rows})
}

// holdingPnlHistory returns the daily P&L history for a single holding, derived from
// its price_daily series and the holding's quantity/cost. Amounts are normalized to CNY.
func holdingPnlHistory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	h, err := db.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "持仓不存在"})
		return
	}
	series, err := db.GetPriceSeries(h.Symbol)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rate, _ := market.GetUSDRate()
	fx := 1.0
	if h.Currency == "USD" {
		fx = rate
	}
	type Row struct {
		Date        string  `json:"date"`
		Close       float64 `json:"close"`
		DayPnl      float64 `json:"day_pnl"`
		DayPnlPct   float64 `json:"day_pnl_pct"`
		TotalPnl    float64 `json:"total_pnl"`
		TotalPnlPct float64 `json:"total_pnl_pct"`
		MarketValue float64 `json:"market_value"`
	}
	var rows []Row
	for i, p := range series {
		mv := p.Close * h.Quantity * fx
		totalPnl := (p.Close - h.CostPrice) * h.Quantity * fx
		var totalPct, dayPnl, dayPct float64
		if h.CostPrice > 0 {
			totalPct = totalPnl / (h.CostPrice * h.Quantity * fx) * 100
		}
		if i > 0 {
			prev := series[i-1].Close
			dayPnl = (p.Close - prev) * h.Quantity * fx
			if prev > 0 {
				dayPct = dayPnl / (prev * h.Quantity * fx) * 100
			}
		}
		rows = append(rows, Row{Date: p.Date, Close: p.Close, DayPnl: dayPnl, DayPnlPct: dayPct, TotalPnl: totalPnl, TotalPnlPct: totalPct, MarketValue: mv})
	}
	c.JSON(http.StatusOK, gin.H{
		"holding": gin.H{"id": h.ID, "name": h.Name, "symbol": h.Symbol, "currency": h.Currency, "quantity": h.Quantity, "cost_price": h.CostPrice},
		"currency": h.Currency,
		"fx":       fx,
		"series":   rows,
	})
}

// ============================================================================
// 操作指南 CRUD
// ============================================================================

func listGuides(c *gin.Context) {
	guides, err := db.ListOperationGuides()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"guides": guides})
}

func createGuide(c *gin.Context) {
	var g db.OperationGuide
	if err := c.ShouldBindJSON(&g); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误: " + err.Error()})
		return
	}
	if g.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "标题不能为空"})
		return
	}
	id, err := db.InsertOperationGuide(&g)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	g.ID = id
	c.JSON(http.StatusCreated, gin.H{"guide": g})
}

func getGuide(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id 格式错误"})
		return
	}
	g, err := db.GetOperationGuide(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到该操作记录"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"guide": g})
}

func updateGuide(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id 格式错误"})
		return
	}
	var g db.OperationGuide
	if err := c.ShouldBindJSON(&g); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误: " + err.Error()})
		return
	}
	g.ID = id
	if err := db.UpdateOperationGuide(&g); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"guide": g})
}

func deleteGuide(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id 格式错误"})
		return
	}
	if err := db.DeleteOperationGuide(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
