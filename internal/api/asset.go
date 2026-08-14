package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// ---- 资产全景：汇总总览 ----

// fxToCNY converts an amount in the given currency to CNY.
func fxToCNY(amount float64, currency string, cnyRate, hkdRate float64) float64 {
	switch strings.ToLower(strings.TrimSpace(currency)) {
	case "usd", "$", "美元":
		return amount * cnyRate
	case "hkd", "hk$", "港币", "港元":
		if hkdRate > 0 {
			return amount * (cnyRate / hkdRate)
		}
		return amount
	default: // rmb, cny, 人民币
		return amount
	}
}

func curSymbol(currency string) string {
	switch strings.ToLower(strings.TrimSpace(currency)) {
	case "usd", "$", "美元":
		return "$"
	case "hkd", "hk$", "港币", "港元":
		return "HK$"
	default:
		return "¥"
	}
}

func assetOverview(c *gin.Context) {
	uid := currentUserID(c)
	cnyRate, hkdRate, _ := market.FetchFXRates()
	today := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")

	// 1) 权益类（基金/股票）
	hs, _ := db.List(uid)
	var eqMV, eqCV, eqPnl, eqDay float64
	eqItems := make([]gin.H, 0, len(hs))
	for _, h := range hs {
		v := enrich(h, uid)
		cmv := v.MarketValue * rateChoice(h.Currency, cnyRate, hkdRate)
		eqMV += cmv
		eqCV += v.CostValue * rateChoice(h.Currency, cnyRate, hkdRate)
		eqPnl += v.Pnl * rateChoice(h.Currency, cnyRate, hkdRate)
		eqDay += v.DayPnl * rateChoice(h.Currency, cnyRate, hkdRate)
		eqItems = append(eqItems, gin.H{
			"id":           h.ID,
			"name":         h.Name,
			"symbol":       h.Symbol,
			"category":     h.Category,
			"market":       h.Market,
			"market_value": cmv,
			"day_pnl":      v.DayPnl * rateChoice(h.Currency, cnyRate, hkdRate),
			"pnl":          v.Pnl * rateChoice(h.Currency, cnyRate, hkdRate),
		})
	}

	// 2) 资产来源名映射
	sources, _ := db.ListSources(uid)
	srcName := map[int64]string{}
	for _, s := range sources {
		srcName[s.ID] = s.Name
	}

	// 3) 理财（最新持仓金额 + 今日盈亏），按币种分类
	wps, _ := db.ListWealth(uid)
	var wTotal, wToday float64
	wByCur := map[string]float64{}
	wItems := make([]gin.H, 0, len(wps))
	for _, w := range wps {
		latestDate, amt, found, _ := db.GetWealthLatest(w.ID)
		var todayPnl float64
		if found {
			todayPnl = computeWealthPnl(w.ID, today)
		}
		wTotal += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		wToday += fxToCNY(todayPnl, w.Currency, cnyRate, hkdRate)
		wByCur[w.Currency] += amt
		cnt, _ := db.CountWealthSnapshots(w.ID)
		// 累计收益：手动编辑值优先（CumPnl 非 0），否则按每日快照自动累计。
		cum := w.CumPnl
		if cum == 0 {
			cum = wealthCumPnl(w.ID)
		}
		wItems = append(wItems, gin.H{
			"id":          w.ID,
			"name":        w.Name,
			"code":        w.Code,
			"currency":    w.Currency,
			"source_id":   w.SourceID,
			"source_name": srcName[w.SourceID],
			"amount":      amt,
			"today_pnl":   todayPnl,
			"cum_pnl":     cum,
			"snap_date":   latestDate,
			"snap_count":  cnt,
		})
	}

	// 3.5) 现金
	cashs, _ := db.ListCash(uid)
	var cTotalCNY float64
	cByCur := map[string]float64{}
	cItems := make([]gin.H, 0, len(cashs))
	for _, cc := range cashs {
		cTotalCNY += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		cByCur[cc.Currency] += cc.Amount
		cItems = append(cItems, gin.H{
			"id":          cc.ID,
			"name":        cc.Name,
			"currency":    cc.Currency,
			"source_id":   cc.SourceID,
			"source_name": srcName[cc.SourceID],
			"amount":      cc.Amount,
			"note":        cc.Note,
		})
	}

	// 4) 负债
	libs, _ := db.ListLiabilities(uid)
	var lTotal, lMonthly float64
	lItems := make([]gin.H, 0, len(libs))
	for _, l := range libs {
		lTotal += l.Amount
		lMonthly += l.MonthlyPayment
		lItems = append(lItems, gin.H{
			"id":              l.ID,
			"name":            l.Name,
			"type":            l.Type,
			"source_id":       l.SourceID,
			"source_name":     srcName[l.SourceID],
			"amount":          l.Amount,
			"rate":            l.Rate,
			"monthly_payment": l.MonthlyPayment,
			"note":            l.Note,
		})
	}

	// 5) 消费（今日 / 本月 / 近期列表）
	cons, _ := db.ListConsumptions(50, uid)
	todayC, _ := db.ConsumptionSum(today, uid)
	monthC, _ := db.ConsumptionSumMonth(today[:7], uid)
	consItems := make([]gin.H, 0, len(cons))
	for _, cc := range cons {
		consItems = append(consItems, gin.H{
			"id":          cc.ID,
			"date":        cc.Date,
			"category":    cc.Category,
			"source_id":   cc.SourceID,
			"source_name": srcName[cc.SourceID],
			"amount":      cc.Amount,
			"note":        cc.Note,
		})
	}

	netAsset := eqMV + wTotal + cTotalCNY - lTotal

	c.JSON(http.StatusOK, gin.H{
		"equity": gin.H{
			"count":        len(hs),
			"market_value": eqMV,
			"cost_value":   eqCV,
			"pnl":          eqPnl,
			"day_pnl":      eqDay,
			"items":        eqItems,
		},
		"wealth": gin.H{
			"total":       wTotal,
			"today_pnl":   wToday,
			"by_currency": wByCur,
			"products":    wItems,
		},
		"cash": gin.H{
			"total":       cTotalCNY,
			"by_currency": cByCur,
			"items":       cItems,
		},
		"liability": gin.H{
			"total":           lTotal,
			"monthly_payment": lMonthly,
			"items":           lItems,
		},
		"consumption": gin.H{
			"today": todayC,
			"month": monthC,
			"items": consItems,
		},
		"net_asset": netAsset,
		"rate":      cnyRate,
		"day":       today,
	})
}

// computeWealthPnl returns the daily P&L for a wealth product on a given date:
// pnl = today's amount − previous day's amount − today's net cashflow.
// Returns 0 when there is no snapshot for the date or no previous-day baseline.
func computeWealthPnl(wealthID int64, date string) float64 {
	amt, cash, ok, _ := db.GetWealthSnapshot(wealthID, date)
	if !ok {
		return 0
	}
	_, prevAmt, pok, _ := db.GetWealthPrevSnapshot(wealthID, date)
	if !pok {
		return 0
	}
	return amt - prevAmt - cash
}

// wealthCumPnl returns the cumulative P&L of a wealth product = sum of all daily
// P&Ls across recorded snapshots. Mirrors the cumulative logic in assetWealthHistory
// so the card-list figure stays consistent with the per-day history chart.
func wealthCumPnl(wealthID int64) float64 {
	snaps, err := db.ListWealthSnapshots(wealthID)
	if err != nil || len(snaps) == 0 {
		return 0
	}
	var prevAmt float64
	hasPrev := false
	var cum float64
	for _, s := range snaps {
		if hasPrev {
			cum += s.Amount - prevAmt - s.Cashflow
		}
		prevAmt = s.Amount
		hasPrev = true
	}
	return cum
}

// ---- 资产来源 CRUD ----

func listSources(c *gin.Context) {
	out, err := db.ListSources(currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sources": out})
}

func createSource(c *gin.Context) {
	var s db.AssetSource
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if s.Type != "platform" {
		s.Type = "bank"
	}
	s.UserID = currentUserID(c)
	id, err := db.CreateSource(&s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.ID = id
	c.JSON(http.StatusOK, gin.H{"source": s})
}

func updateSource(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var s db.AssetSource
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	s.ID = id
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if s.Type != "platform" {
		s.Type = "bank"
	}
	s.UserID = currentUserID(c)
	if err := db.UpdateSource(&s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"source": s})
}

func deleteSource(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteSource(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 理财 CRUD ----

func listWealth(c *gin.Context) {
	out, err := db.ListWealth(currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 累计收益回退：未手动编辑（CumPnl=0）时按每日快照自动累计，保证编辑弹框预填值与实际展示一致。
	for i := range out {
		if out[i].CumPnl == 0 {
			out[i].CumPnl = wealthCumPnl(out[i].ID)
		}
	}
	c.JSON(http.StatusOK, gin.H{"wealth": out})
}

func createWealth(c *gin.Context) {
	var w db.WealthProduct
	if err := c.ShouldBindJSON(&w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	w.UserID = currentUserID(c)
	id, err := db.CreateWealth(&w)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	w.ID = id
	c.JSON(http.StatusOK, gin.H{"wealth": w})
}

func updateWealth(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var w db.WealthProduct
	if err := c.ShouldBindJSON(&w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	w.ID = id
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	w.UserID = currentUserID(c)
	if err := db.UpdateWealth(&w); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"wealth": w})
}

func deleteWealth(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteWealth(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 现金 CRUD ----

func listCash(c *gin.Context) {
	out, err := db.ListCash(currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cash": out})
}

func createCash(c *gin.Context) {
	var cc db.Cash
	if err := c.ShouldBindJSON(&cc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	cc.Name = strings.TrimSpace(cc.Name)
	if cc.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if cc.Currency == "" {
		cc.Currency = "rmb"
	}
	cc.UserID = currentUserID(c)
	id, err := db.CreateCash(&cc)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cc.ID = id
	c.JSON(http.StatusOK, gin.H{"cash": cc})
}

func updateCash(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var cc db.Cash
	if err := c.ShouldBindJSON(&cc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	cc.ID = id
	cc.Name = strings.TrimSpace(cc.Name)
	if cc.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if cc.Currency == "" {
		cc.Currency = "rmb"
	}
	cc.UserID = currentUserID(c)
	if err := db.UpdateCash(&cc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cash": cc})
}

func deleteCash(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteCash(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// assetWealthSnapshotsPost upserts today's holding amounts for many products at once.
// Body: { "date": "YYYY-MM-DD", "items": [ {"wealth_id":N,"amount":F,"cashflow":F}, ... ] }
func assetWealthSnapshotsPost(c *gin.Context) {
	var b struct {
		Date  string `json:"date"`
		Items []struct {
			WealthID int64   `json:"wealth_id"`
			Amount   float64 `json:"amount"`
			Cashflow float64 `json:"cashflow"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.Date == "" {
		b.Date = time.Now().Format("2006-01-02")
	}
	if len(b.Items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "items 为空"})
		return
	}
	for _, it := range b.Items {
		if it.WealthID <= 0 {
			continue
		}
		if err := db.UpsertWealthSnapshot(it.WealthID, b.Date, it.Amount, it.Cashflow); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "date": b.Date})
}

// assetWealthHistory returns the daily P&L series for one product, with cumulative P&L.
func assetWealthHistory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	snaps, err := db.ListWealthSnapshots(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var prevAmt float64
	hasPrev := false
	rows := make([]gin.H, 0, len(snaps))
	var cum float64
	for _, s := range snaps {
		var pnl float64
		if hasPrev {
			pnl = s.Amount - prevAmt - s.Cashflow
		}
		cum += pnl
		rows = append(rows, gin.H{
			"date":     s.Date,
			"amount":   s.Amount,
			"cashflow": s.Cashflow,
			"pnl":      pnl,
			"cum_pnl":  cum,
		})
		prevAmt = s.Amount
		hasPrev = true
	}
	c.JSON(http.StatusOK, gin.H{"rows": rows})
}

// ---- 负债 CRUD ----

func listLiabilities(c *gin.Context) {
	out, err := db.ListLiabilities(currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"liabilities": out})
}

func createLiability(c *gin.Context) {
	var l db.Liability
	if err := c.ShouldBindJSON(&l); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	l.UserID = currentUserID(c)
	id, err := db.CreateLiability(&l)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	l.ID = id
	c.JSON(http.StatusOK, gin.H{"liability": l})
}

func updateLiability(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var l db.Liability
	if err := c.ShouldBindJSON(&l); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	l.ID = id
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	l.UserID = currentUserID(c)
	if err := db.UpdateLiability(&l); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"liability": l})
}

func deleteLiability(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteLiability(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 消费 CRUD ----

func listConsumptionsH(c *gin.Context) {
	out, err := db.ListConsumptions(200, currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"consumptions": out})
}

func createConsumption(c *gin.Context) {
	var cc db.Consumption
	if err := c.ShouldBindJSON(&cc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if cc.Amount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "金额不能为 0"})
		return
	}
	cc.UserID = currentUserID(c)
	id, err := db.CreateConsumption(&cc)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cc.ID = id
	c.JSON(http.StatusOK, gin.H{"consumption": cc})
}

func updateConsumption(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var cc db.Consumption
	if err := c.ShouldBindJSON(&cc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	cc.ID = id
	cc.UserID = currentUserID(c)
	if err := db.UpdateConsumption(&cc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"consumption": cc})
}

func deleteConsumption(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteConsumption(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 一键 AI 总结（汇总全部资产） ----

func assetSummary(c *gin.Context) {
	uid := currentUserID(c)
	var b aiSummaryReq
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	cfg, cfgErr := loadAIConfig(uid)
	if b.APIKey == "" {
		b.APIKey = cfg.APIKey
	}
	if b.Model == "" {
		b.Model = cfg.Model
	}
	if b.BaseURL == "" {
		b.BaseURL = cfg.BaseURL
	}
	if b.Template == "" {
		if len(cfg.Templates) > 0 {
			b.Template = cfg.Templates[0].Content
		} else {
			b.Template = defaultTemplates[0].Content
		}
	}
	if b.APIKey == "" || b.BaseURL == "" || b.Model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先在「AI 设置」中填写 API Key、模型名称与模型地址"})
		return
	}
	stats, err := buildAssetStats(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "统计失败: " + err.Error()})
		return
	}
	prompt := injectData(b.Template, stats)
	content, err := callChatCompletions(b.BaseURL, b.APIKey, b.Model, prompt)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err := db.SaveAISummary(content, b.Model, uid); err != nil {
		log.Printf("warn: save asset ai summary history failed: %v", err)
	}
	if cfgErr == nil && b.APIKey != "" && b.APIKey != cfg.APIKey {
		cfg.APIKey = b.APIKey
		if raw, e := json.Marshal(cfg); e == nil {
			if e2 := db.SaveAIConfig(uid, string(raw)); e2 != nil {
				log.Printf("warn: persist api key from asset summary failed: %v", e2)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"content": content})
}

// buildAssetStats assembles a full text snapshot of ALL assets: equity (基金/股票),
// wealth products (理财), liabilities (负债) and consumptions (消费).
func buildAssetStats(uid int64) (string, error) {
	cnyRate, hkdRate, _ := market.FetchFXRates()
	today := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")

	var b strings.Builder
	b.WriteString("统计日期：" + today + "\n")
	if cnyRate > 0 {
		b.WriteString("汇率：1 USD ≈ " + nf(cnyRate) + " CNY\n")
	}

	// ---- 权益类 ----
	hs, _ := db.List(uid)
	var eqMV, eqCV, eqPnl, eqDay float64
	eqViews := make([]HoldingView, 0, len(hs))
	for _, h := range hs {
		v := enrich(h, uid)
		eqViews = append(eqViews, v)
		eqMV += v.MarketValue * rateChoice(h.Currency, cnyRate, hkdRate)
		eqCV += v.CostValue * rateChoice(h.Currency, cnyRate, hkdRate)
		eqPnl += v.Pnl * rateChoice(h.Currency, cnyRate, hkdRate)
		eqDay += v.DayPnl * rateChoice(h.Currency, cnyRate, hkdRate)
	}
	eqTotalPct := 0.0
	if eqCV > 0 {
		eqTotalPct = eqPnl / eqCV * 100
	}
	b.WriteString("\n【权益类（基金 / 股票）】\n")
	b.WriteString("持仓数：" + fmt.Sprintf("%d", len(hs)) + " 条\n")
	b.WriteString("市值(CNY)：" + nf(eqMV) + "  成本(CNY)：" + nf(eqCV) + "\n")
	b.WriteString("总盈亏(CNY)：" + sf(eqPnl) + "（" + pf(eqTotalPct) + "）  当日盈亏(CNY)：" + sf(eqDay) + "\n")
	for i, v := range eqViews {
		h := v.Holding
		line := fmt.Sprintf("%d. %s(%s) %s/%s 市值(CNY)%s 当日盈亏%s(%s) 总盈亏%s(%s)",
			i+1, h.Name, h.Symbol, catLabel(h.Category), h.Market,
			nf(v.MarketValue*rateChoice(h.Currency, cnyRate, hkdRate)),
			sf(v.DayPnl*rateChoice(h.Currency, cnyRate, hkdRate)), pf(v.DayPnlPct),
			sf(v.Pnl*rateChoice(h.Currency, cnyRate, hkdRate)), pf(v.PnlPct))
		b.WriteString(line + "\n")
	}

	// ---- 理财 ----
	sources, _ := db.ListSources(uid)
	srcName := map[int64]string{}
	for _, s := range sources {
		srcName[s.ID] = s.Name
	}
	wps, _ := db.ListWealth(uid)
	var wTotal, wToday float64
	b.WriteString("\n【理财（每日持仓金额口径）】\n")
	if len(wps) == 0 {
		b.WriteString("（暂无理财持仓）\n")
	}
	for i, w := range wps {
		_, amt, found, _ := db.GetWealthLatest(w.ID)
		var pnl float64
		if found {
			pnl = computeWealthPnl(w.ID, today)
		}
		wTotal += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		wToday += fxToCNY(pnl, w.Currency, cnyRate, hkdRate)
		line := fmt.Sprintf("%d. %s（%s，%s）最新持仓金额%s%s 今日收益%s",
			i+1, w.Name, srcName[w.SourceID], w.Currency, curSymbol(w.Currency), nf(amt), sf(pnl))
		b.WriteString(line + "\n")
	}
	b.WriteString("理财合计持仓(CNY)：" + nf(wTotal) + "  今日收益(CNY)：" + sf(wToday) + "\n")

	// ---- 负债 ----
	libs, _ := db.ListLiabilities(uid)
	var lTotal, lMonthly float64
	b.WriteString("\n【负债】\n")
	if len(libs) == 0 {
		b.WriteString("（暂无负债）\n")
	}
	for i, l := range libs {
		lTotal += l.Amount
		lMonthly += l.MonthlyPayment
		rateStr := ""
		if l.Rate > 0 {
			rateStr = " 年利率" + fmt.Sprintf("%.2f", l.Rate) + "%"
		}
		mpStr := ""
		if l.MonthlyPayment > 0 {
			mpStr = " 月供" + nf(l.MonthlyPayment)
		}
		line := fmt.Sprintf("%d. %s（%s/%s）欠款(CNY)%s%s%s",
			i+1, l.Name, srcName[l.SourceID], l.Type, nf(l.Amount), rateStr, mpStr)
		b.WriteString(line + "\n")
	}
	b.WriteString("负债合计(CNY)：" + nf(lTotal) + "  月供合计(CNY)：" + nf(lMonthly) + "\n")

	// ---- 消费 ----
	todayC, _ := db.ConsumptionSum(today, uid)
	monthC, _ := db.ConsumptionSumMonth(today[:7], uid)
	cons, _ := db.ListConsumptions(30, uid)
	b.WriteString("\n【消费】\n")
	b.WriteString("今日消费(CNY)：" + nf(todayC) + "  本月消费(CNY)：" + nf(monthC) + "\n")
	if len(cons) > 0 {
		b.WriteString("近期消费：\n")
		for i, cc := range cons {
			if i >= 15 {
				break
			}
			line := fmt.Sprintf("  - %s %s %s(CNY)%s", cc.Date, cc.Category, nf(cc.Amount), cc.Note)
			b.WriteString(line + "\n")
		}
	}

	// ---- 现金 ----
	cashs, _ := db.ListCash(uid)
	var cTotal float64
	b.WriteString("\n【现金】\n")
	if len(cashs) == 0 {
		b.WriteString("（暂无现金记录）\n")
	}
	for i, cc := range cashs {
		cTotal += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		line := fmt.Sprintf("%d. %s（%s，%s）余额%s%s",
			i+1, cc.Name, srcName[cc.SourceID], cc.Currency, curSymbol(cc.Currency), nf(cc.Amount))
		b.WriteString(line + "\n")
	}
	b.WriteString("现金合计(CNY)：" + nf(cTotal) + "\n")

	// ---- 净资产总览 ----
	netAsset := eqMV + wTotal + cTotal - lTotal
	b.WriteString("\n【净资产总览】\n")
	b.WriteString("总资产(CNY)：" + nf(eqMV+wTotal+cTotal) + "（权益" + nf(eqMV) + " + 理财" + nf(wTotal) + " + 现金" + nf(cTotal) + "）\n")
	b.WriteString("总负债(CNY)：" + nf(lTotal) + "\n")
	b.WriteString("净资产(CNY)：" + sf(netAsset) + "\n")

	return b.String(), nil
}
