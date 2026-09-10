package api

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
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

	// 0) 资产来源名/区域映射（供后续按来源 region 归集境内/境外资产）
	sources, _ := db.ListSources(uid)
	srcName := map[int64]string{}
	srcRegion := map[int64]string{}
	for _, s := range sources {
		srcName[s.ID] = s.Name
		srcRegion[s.ID] = s.Region
	}
	// 来源未归集(source_id=0)或区域未知时默认计入境内，确保 境内+境外=总资产(未减负债前)。
	regionOf := func(sid int64) string {
		if r, ok := srcRegion[sid]; ok && (r == "overseas" || r == "domestic") {
			return r
		}
		return "domestic"
	}
	var domAssets, ovsAssets float64

	// 1) 权益类（基金/股票）
	hs, _ := db.List(uid)
	var eqMV, eqCV, eqPnl, eqDay float64
	eqItems := make([]gin.H, 0, len(hs))
	for _, h := range hs {
		v := enrich(h, uid)
		cmv := round2(v.MarketValue * rateChoice(h.Currency, cnyRate, hkdRate))
		eqMV += cmv
		eqCV += v.CostValue * rateChoice(h.Currency, cnyRate, hkdRate)
		eqPnl += v.Pnl * rateChoice(h.Currency, cnyRate, hkdRate)
		eqDay += v.DayPnl * rateChoice(h.Currency, cnyRate, hkdRate)
		if regionOf(h.SourceID) == "overseas" {
			ovsAssets += cmv
		} else {
			domAssets += cmv
		}
		eqItems = append(eqItems, gin.H{
			"id":           h.ID,
			"name":         h.Name,
			"symbol":       h.Symbol,
			"category":     h.Category,
			"market":       h.Market,
			"market_value": cmv,
			"day_pnl":      round2(v.DayPnl * rateChoice(h.Currency, cnyRate, hkdRate)),
			"pnl":          round2(v.Pnl * rateChoice(h.Currency, cnyRate, hkdRate)),
		})
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
		amt = round2(amt)
		todayPnl = round2(todayPnl)
		wTotal += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		if regionOf(w.SourceID) == "overseas" {
			ovsAssets += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		} else {
			domAssets += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		}
		wToday += fxToCNY(todayPnl, w.Currency, cnyRate, hkdRate)
		wByCur[w.Currency] += amt
		cnt, _ := db.CountWealthSnapshots(w.ID)
		// 持有天数：从首次录入快照日期起算（与持仓 buy_date 口径一致），无快照记 0
		firstDate, _, _ := db.GetWealthFirst(w.ID)
		wDays := db.CalcHoldingDays(firstDate)
		// 累计收益：手动编辑值优先（CumPnl 非 0），否则按每日快照自动累计。
		cum := round2(w.CumPnl)
		if cum == 0 {
			cum = round2(wealthCumPnl(w.ID))
		}
		wItems = append(wItems, gin.H{
			"id":           w.ID,
			"name":         w.Name,
			"code":         w.Code,
			"currency":     w.Currency,
			"note":         w.Note,
			"source_id":    w.SourceID,
			"source_name":  srcName[w.SourceID],
			"amount":       amt,
			"today_pnl":    todayPnl,
			"cum_pnl":      cum,
			"snap_date":    latestDate,
			"snap_count":   cnt,
			"holding_days": wDays,
		})
	}

	// 3.5) 现金
	cashs, _ := db.ListCash(uid)
	var cTotalCNY float64
	cByCur := map[string]float64{}
	cItems := make([]gin.H, 0, len(cashs))
	for _, cc := range cashs {
		cTotalCNY += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		if regionOf(cc.SourceID) == "overseas" {
			ovsAssets += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		} else {
			domAssets += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		}
		cByCur[cc.Currency] += cc.Amount
		cItems = append(cItems, gin.H{
			"id":          cc.ID,
			"name":        cc.Name,
			"currency":    cc.Currency,
			"type":        cc.Type,
			"source_id":   cc.SourceID,
			"source_name": srcName[cc.SourceID],
			"amount":      round2(cc.Amount),
			"note":        cc.Note,
			"is_default":  cc.IsDefault,
		})
	}

	// 4) 负债（按来源 region 归集境内/境外负债，供前端拆分境内/境外净资产）
	libs, _ := db.ListLiabilities(uid)
	var lTotal, lMonthly, domLiab, ovsLiab float64
	lItems := make([]gin.H, 0, len(libs))
	for _, l := range libs {
		lCNY := fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
		lTotal += lCNY
		lMonthly += l.MonthlyPayment
		if regionOf(l.SourceID) == "overseas" {
			ovsLiab += lCNY
		} else {
			domLiab += lCNY
		}
		lItems = append(lItems, gin.H{
			"id":              l.ID,
			"name":            l.Name,
			"type":            l.Type,
			"source_id":       l.SourceID,
			"source_name":     srcName[l.SourceID],
			"currency":        l.Currency,
			"amount":          round2(l.Amount),
			"rate":            l.Rate,
			"monthly_payment": round2(l.MonthlyPayment),
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
			"amount":      round2(cc.Amount),
			"note":        cc.Note,
		})
	}

	netAsset := round2(eqMV + wTotal + cTotalCNY - lTotal)

	c.JSON(http.StatusOK, gin.H{
		"equity": gin.H{
			"count":        len(hs),
			"market_value": round2(eqMV),
			"cost_value":   round2(eqCV),
			"pnl":          round2(eqPnl),
			"day_pnl":      round2(eqDay),
			"items":        eqItems,
		},
		"wealth": gin.H{
			"total":       round2(wTotal),
			"today_pnl":   round2(wToday),
			"by_currency": wByCur,
			"products":    wItems,
		},
		"cash": gin.H{
			"total":       round2(cTotalCNY),
			"by_currency": cByCur,
			"items":       cItems,
		},
		"liability": gin.H{
			"total":           round2(lTotal),
			"monthly_payment": round2(lMonthly),
			"items":           lItems,
		},
		"consumption": gin.H{
			"today": round2(todayC),
			"month": round2(monthC),
			"items": consItems,
		},
		"net_asset": netAsset,
		"domestic_assets":  round2(domAssets),
		"overseas_assets": round2(ovsAssets),
		"domestic_liabilities": round2(domLiab),
		"overseas_liabilities": round2(ovsLiab),
		"rate":             cnyRate,
		"day":              today,
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
	return round2(amt - prevAmt - cash)
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
	return round2(cum)
}

// ---- 资产来源 CRUD ----

func listSources(c *gin.Context) {
	uid := currentUserID(c)
	out, err := db.ListSources(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items := make([]gin.H, 0, len(out))
	for _, s := range out {
		// 存量兼容：currencies 列为空的来源按现有子账户币种推断回填（一次性自愈），
		// 再为每个币种补齐默认子账户（幂等，已有则直接返回）
		if strings.TrimSpace(s.Currencies) == "" {
			s.Currencies = db.InferSourceCurrencies(uid, s.ID)
			if err := db.UpdateSourceCurrencies(uid, s.ID, s.Currencies); err != nil {
				log.Printf("[source] 回填币种集合失败(source=%d): %v", s.ID, err)
			}
		}
		if _, err := db.EnsureCurrencyDefaults(uid, s.ID, s.Name, s.Currencies); err != nil {
			log.Printf("[source] 补齐默认子账户失败(source=%d): %v", s.ID, err)
		}
		items = append(items, gin.H{
			"id": s.ID, "user_id": s.UserID, "name": s.Name, "type": s.Type, "region": s.Region, "currencies": s.Currencies, "note": s.Note, "created_at": s.CreatedAt,
			"funds_cny": sourceFundsCNY(uid, s.ID),
		})
	}
	c.JSON(http.StatusOK, gin.H{"sources": items})
}

// sourceFundsCNY 统计该来源下的关联资金净值（CNY）：
// 持仓市值 + 理财最新快照金额 + 现金余额 − 该来源下负债，USD/HKD 按当前汇率折算。
// 负债作为资金扣减（负债挂在来源下即属该账户的资金占用），消费为流水不计入。
func sourceFundsCNY(uid, sourceID int64) float64 {
	cnyRate, hkdRate, _ := market.GetFXRates()
	hkdToCny := 1.0
	if hkdRate > 0 {
		hkdToCny = cnyRate / hkdRate
	}
	conv := func(cur string, v float64) float64 {
		switch strings.ToLower(cur) {
		case "usd":
			return v * cnyRate
		case "hkd":
			return v * hkdToCny
		default:
			return v
		}
	}
	var total float64
	// 持仓（市值 = 数量 × 现价）
	if hs, e := db.List(uid); e == nil {
		for _, h := range hs {
			if h.SourceID == sourceID {
				total += conv(h.Currency, h.Quantity*h.CurrentPrice)
			}
		}
	}
	// 理财（最新快照金额）
	if ws, e := db.ListWealth(uid); e == nil {
		for _, w := range ws {
			if w.SourceID == sourceID {
				if _, amt, ok, _ := db.GetWealthLatest(w.ID); ok {
					total += conv(w.Currency, amt)
				}
			}
		}
	}
	// 现金
	if cs, e := db.ListCash(uid); e == nil {
		for _, c := range cs {
			if c.SourceID == sourceID {
				total += conv(c.Currency, c.Amount)
			}
		}
	}
	// 负债：挂在来源下的欠款即该账户的资金占用，作为关联资金扣减（负债为「负资产」），按币种折算 CNY
	if ls, e := db.ListLiabilities(uid); e == nil {
		for _, l := range ls {
			if l.SourceID == sourceID {
				total -= conv(l.Currency, l.Amount)
			}
		}
	}
	return round2(total)
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
	switch s.Type {
	case "securities", "software", "platform":
		// 合法类型，保持不变
	default:
		s.Type = "bank"
	}
	switch s.Region {
	case "overseas":
		// 合法区域，保持不变
	default:
		s.Region = "domestic"
	}
	s.UserID = currentUserID(c)
	// 币种集合：勾选的币种（rmb/hkd/usd）规范化后入库，随来源创建各币种的默认子账户
	s.Currencies = db.NormalizeCurrencies(s.Currencies)
	id, err := db.CreateSource(&s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.ID = id
	// 每个勾选币种自带一个默认子账户（前端名称前加 ★ 标记）：随来源创建，随来源删除级联删除。
	if cashID, err := db.EnsureCurrencyDefaults(s.UserID, id, s.Name, s.Currencies); err != nil {
		log.Printf("[source] 初始化默认子账户失败(source=%d): %v", id, err)
	} else {
		log.Printf("[source] 来源 %s(%d) 默认子账户 %d（币种 %s）", s.Name, id, cashID, s.Currencies)
	}
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
	switch s.Type {
	case "securities", "software", "platform":
		// 合法类型，保持不变
	default:
		s.Type = "bank"
	}
	switch s.Region {
	case "overseas":
		// 合法区域，保持不变
	default:
		s.Region = "domestic"
	}
	s.UserID = currentUserID(c)
	// 币种集合联动：勾选新币种保存后，自动补齐缺失币种的默认子账户（已有多余子账户不删除）
	s.Currencies = db.NormalizeCurrencies(s.Currencies)
	if err := db.UpdateSource(&s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.EnsureCurrencyDefaults(s.UserID, s.ID, s.Name, s.Currencies); err != nil {
		log.Printf("[source] 补齐币种默认子账户失败(source=%d): %v", s.ID, err)
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

// redeemWealth 理财减仓/清仓：把持仓金额转出到同来源的子账户。
// 转出金额 ≥ 当前持仓 → 清仓：直接删除该理财条目，现金入账记「清仓回款」；
// 部分转出 → 记「减仓回款」，并写当日快照（净存入为负）在每日盈亏历史留痕（盈亏计算自动剔除本金变动）。
func redeemWealth(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var req struct {
		Amount float64 `json:"amount"`
		CashID int64   `json:"cash_id"`
		Note   string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	p, err := db.GetWealthProduct(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "理财产品不存在"})
		return
	}
	amt := math.Round(req.Amount*100) / 100
	if amt <= 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "转出金额必须大于 0"})
		return
	}
	curAmt, err := db.LatestWealthAmount(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if curAmt <= 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该理财暂无持仓金额（先在每日盈亏里录入持仓），无法减仓"})
		return
	}
	if amt > curAmt+0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("转出金额超过当前持仓 %.2f", curAmt)})
		return
	}
	acc, err := resolveCashAccount(uid, req.CashID, p.SourceID, p.Currency)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 货币一致性校验：理财回款币种必须与目标子账户一致，防止折算口径错乱
	wCur, aCur := p.Currency, acc.Currency
	if wCur == "" {
		wCur = "rmb"
	}
	if aCur == "" {
		aCur = "rmb"
	}
	if wCur != aCur {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("货币类型不一致：理财为 %s，所选子账户为 %s，请选择同币种子账户", wCur, aCur)})
		return
	}
	full := amt >= curAmt-0.005
	flowType, label := "wealth_redeem", "减仓回款"
	if full {
		flowType, label = "wealth_clear", "清仓回款"
	}
	detail := fmt.Sprintf("%s %s｜转出 %.2f", label, p.Name, amt)
	if n := strings.TrimSpace(req.Note); n != "" {
		detail += "｜" + n
	}
	if err := db.AddCashAmount(acc.ID, amt, flowType, "wealth", p.ID, p.Name, detail); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if full {
		if err := db.DeleteWealth(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		// 部分减仓：当日快照 净存入=-amt → 每日盈亏历史可见且不计入当日盈亏
		if err := db.UpsertWealthSnapshot(id, time.Now().Format("2006-01-02"), math.Round((curAmt-amt)*100)/100, -amt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "cleared": full, "amount": amt, "cash_name": acc.Name})
}

// ---- 现金 CRUD ----

func listCash(c *gin.Context) {
	uid := currentUserID(c)
	out, err := db.ListCash(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 补上来源名：加减仓「资金账户」下拉要按来源区分同名账户
	srcs, _ := db.ListSources(uid)
	srcName := make(map[int64]string, len(srcs))
	for _, s := range srcs {
		srcName[s.ID] = s.Name
	}
	items := make([]gin.H, 0, len(out))
	for _, cc := range out {
		items = append(items, gin.H{
			"id": cc.ID, "user_id": cc.UserID, "source_id": cc.SourceID,
			"source_name": srcName[cc.SourceID],
			"name":        cc.Name, "currency": cc.Currency, "type": cc.Type, "amount": cc.Amount,
			"note": cc.Note, "is_default": cc.IsDefault, "created_at": cc.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"cash": items})
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
	// 默认账户唯一性（按币种）：显式勾选 → 设为本来源该币种默认；未勾选但该来源该币种尚无默认账户 → 兜底设为默认，
	// 保证「每个来源的每个币种有且仅有一个 ★ 默认子账户」。
	needDefault := cc.IsDefault
	if !needDefault {
		if cur, e := db.GetDefaultCash(cc.UserID, cc.SourceID, cc.Currency); e == nil && cur == nil {
			needDefault = true
		}
	}
	if needDefault {
		if err := db.SetDefaultCash(cc.UserID, cc.SourceID, cc.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		cc.IsDefault = true
	}
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
	// 设为默认现金账户：同一来源下唯一，切换时该来源其他账户自动取消默认标记。
	if cc.IsDefault {
		if err := db.SetDefaultCash(cc.UserID, cc.SourceID, cc.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		// 不允许取消唯一的默认账户：每个来源必须保留一个 ★ 账户。
		// 想换默认账户，请在目标账户上勾选「设为默认」，原账户会自动取消。
		if old, e := db.GetCash(cc.ID); e == nil && old != nil && old.IsDefault {
			cc.IsDefault = true
		}
	}
	if err := db.UpdateCash(&cc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 回读库中真实状态返回（is_default 可能已被 SetDefaultCash 改写）
	if fresh, err := db.GetCash(cc.ID); err == nil && fresh != nil {
		c.JSON(http.StatusOK, gin.H{"cash": fresh})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cash": cc})
}

// listCashFlows 返回某现金账户的余额变动流水（加仓付款 / 减仓回款 / 手工调整）。
func listCashFlows(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	acc, err := db.GetCash(id)
	if err != nil || acc == nil || acc.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "子账户不存在"})
		return
	}
	flows, err := db.ListCashFlows(id, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"flows": flows, "account": acc})
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

// transferCash 在两个同币种现金账户间转账（同一用户下），并写入成对流水。
// 入参：{from_id, to_id, amount, note?}。币种不一致、余额不足或跨用户均拒绝。
func transferCash(c *gin.Context) {
	var b struct {
		FromID int64   `json:"from_id"`
		ToID   int64   `json:"to_id"`
		Amount float64 `json:"amount"`
		Note   string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.FromID <= 0 || b.ToID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择源账户与目标账户"})
		return
	}
	if b.FromID == b.ToID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "源账户与目标账户不能相同"})
		return
	}
	if b.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "转账金额必须大于 0"})
		return
	}
	uid := currentUserID(c)
	src, err := db.GetCash(b.FromID)
	if err != nil || src == nil || src.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "源账户不存在或无权访问"})
		return
	}
	dst, err := db.GetCash(b.ToID)
	if err != nil || dst == nil || dst.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "目标账户不存在或无权访问"})
		return
	}
	if err := db.AddCashTransfer(b.FromID, b.ToID, b.Amount, strings.TrimSpace(b.Note)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// adjustCash 对已有现金账户做 ±资金调整（弹框「已有账户 ± 资金」模式）：
// delta > 0 = 存入现金，delta < 0 = 取出现金；写 manual 流水（资金变动历史可见）。
func adjustCash(c *gin.Context) {
	var b struct {
		CashID int64   `json:"cash_id"`
		Delta  float64 `json:"delta"`
		Note   string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.CashID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择子账户"})
		return
	}
	delta := math.Round(b.Delta*100) / 100
	if math.Abs(delta) < 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "调整金额不能为 0（存入填正数，取出填负数）"})
		return
	}
	uid := currentUserID(c)
	acc, err := db.GetCash(b.CashID)
	if err != nil || acc == nil || acc.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "子账户不存在或无权访问"})
		return
	}
	if acc.Amount+delta < -0.004 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("取出金额超过账户余额（当前余额 %.2f）", acc.Amount)})
		return
	}
	note := strings.TrimSpace(b.Note)
	if note == "" {
		if delta > 0 {
			note = "手工存入"
		} else {
			note = "手工取出"
		}
	}
	if err := db.AddCashAmount(acc.ID, delta, "manual", "manual", acc.ID, acc.Name, note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// assetWealthSnapshotsPost upserts today's holding amounts for many products at once.
// Body: { "date": "YYYY-MM-DD", "items": [ {"wealth_id":N,"amount":F,"cashflow":F,"cash_account_id":N}, ... ] }
// 净存入联动现金账户：cashflow 相对旧值的增量 cfDelta > 0（申购/存入理财）→ 从 cash_account_id
// 账户扣款；cfDelta < 0（赎回/取出）→ 回款入账到 cash_account_id 账户。账户均缺省回落同来源默认账户。
func assetWealthSnapshotsPost(c *gin.Context) {
	var b struct {
		Date  string `json:"date"`
		Items []struct {
			WealthID      int64   `json:"wealth_id"`
			Amount        float64 `json:"amount"`
			Cashflow      float64 `json:"cashflow"`
			CashAccountID int64   `json:"cash_account_id"`
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
	uid := currentUserID(c)
	now := time.Now().Format("2006-01-02 15:04:05")
	for _, it := range b.Items {
		if it.WealthID <= 0 {
			continue
		}
		// 归属校验：该产品必须属于当前用户
		if owner, e := db.WealthProductOwner(it.WealthID); e == nil && owner != 0 && owner != uid {
			c.JSON(http.StatusForbidden, gin.H{"error": "无权修改该理财"})
			return
		}
		if it.Amount < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "持仓金额不能为负（产品 " + strconv.FormatInt(it.WealthID, 10) + "）"})
			return
		}
		// phantom 盈亏拦截：当日净存入≠0 但持仓金额与前一日完全相同，会产生错误盈亏
		if math.Abs(it.Cashflow) > 1e-9 {
			_, prevAmt, prevOk, pe := db.GetWealthPrevSnapshot(it.WealthID, b.Date)
			if pe == nil && prevOk {
				if math.Abs(prevAmt-it.Amount) < 0.005 {
					c.JSON(http.StatusBadRequest, gin.H{"error": "产品 " + strconv.FormatInt(it.WealthID, 10) + " 在 " + b.Date + " 的净存入不为 0，但持仓金额与前一日相同，将产生错误盈亏。全部取出请把今日持仓金额改为 0；部分取出请填写取出后的实际持仓；无资金变动请把净存入填 0。"})
					return
				}
			}
		}
		// 写审计：记录改前/改后
		oldAmt, oldCf, existed, _ := db.GetWealthSnapshot(it.WealthID, b.Date)
		// 与当日快照完全一致 → 无变化：跳过落库与审计（防御性兜底，前端本就只提交有变化的行）
		if existed && math.Abs(oldAmt-it.Amount) < 0.005 && math.Abs(oldCf-it.Cashflow) < 0.005 {
			continue
		}
		if err := db.UpsertWealthSnapshot(it.WealthID, b.Date, it.Amount, it.Cashflow); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if e := db.InsertWealthAudit(db.WealthAudit{
			WealthID: it.WealthID, Date: b.Date, Action: "upsert", Field: "row",
			OldAmount: oldAmt, OldCash: oldCf, NewAmount: it.Amount, NewCash: it.Cashflow,
			OldExists: existed, UserID: uid, CreatedAt: now,
		}); e != nil {
			log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", it.WealthID, b.Date, e)
		}
		// 净存入变动联动现金账户（按新旧 cashflow 差值落账，重复保存只补差额，天然幂等）
		if e := applyWealthCash(uid, it.WealthID, b.Date, it.Cashflow-oldCf, it.CashAccountID); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "date": b.Date})
}

// applyWealthCash 把一次理财快照「当日净存入」的变动落到现金账户（并写一条流水）：
//   - cfDelta > 0（净申购/存入理财）：现金账户扣款（理财存入），账户取前端选定的 cashIDIn；
//   - cfDelta < 0（净赎回/取出理财）：现金账户入账（理财回款），账户同样取前端选定的 cashIDIn；
//
// cashIDIn 为 0（未选）时由 resolveCashAccount 回落该理财同来源、同币种的默认子账户（★）。
// 调用方传入的应是「新 cashflow − 旧 cashflow」的差值，使重复保存/改录只补差额。
func applyWealthCash(uid, wealthID int64, date string, cfDelta float64, cashIDIn int64) error {
	cfDelta = math.Round(cfDelta*100) / 100
	if math.Abs(cfDelta) < 0.005 {
		return nil
	}
	p, err := db.GetWealthProduct(wealthID)
	if err != nil {
		return err
	}
	if p == nil {
		return fmt.Errorf("理财产品不存在（id=%d）", wealthID)
	}
	accountDelta := -cfDelta // 存入理财 → 账户扣款（负）；取出理财 → 账户入账（正）
	flowType, label := "wealth_deposit", "理财存入"
	if accountDelta > 0 {
		flowType, label = "wealth_redeem", "理财回款"
	}
	acc, err := resolveCashAccount(uid, cashIDIn, p.SourceID, p.Currency)
	if err != nil {
		return err
	}
	detail := fmt.Sprintf("%s %s｜%s 净存入 %+.2f", label, p.Name, date, cfDelta)
	return db.AddCashAmount(acc.ID, accountDelta, flowType, "wealth", p.ID, p.Name, detail)
}

// reverseWealthCash 对一条已入账的理财资金流水做反向冲正（快照删除/撤销时调用）：
// postedAmount 为当初入账金额（正=入账/负=出账），优先冲正到原流水所在账户，找不到则回落来源默认账户。
func reverseWealthCash(uid, wealthID int64, postedAmount float64, note string) error {
	postedAmount = math.Round(postedAmount*100) / 100
	if math.Abs(postedAmount) < 0.005 {
		return nil
	}
	p, err := db.GetWealthProduct(wealthID)
	if err != nil {
		return err
	}
	if p == nil {
		return nil
	}
	cashID := int64(0)
	if f, e := db.FindCashFlowByRef("wealth", wealthID, postedAmount); e == nil && f != nil {
		cashID = f.CashID
	}
	acc, err := resolveCashAccount(uid, cashID, p.SourceID, p.Currency)
	if err != nil {
		return err
	}
	detail := fmt.Sprintf("理财冲正 %s｜%s", p.Name, note)
	return db.AddCashAmount(acc.ID, -postedAmount, "wealth_reverse", "wealth", p.ID, p.Name, detail)
}

// assetWealthSnapshotDelete 删除某产品某天的快照（带归属校验 + 审计）。
// Query: ?wealth_id=N&date=YYYY-MM-DD
func assetWealthSnapshotDelete(c *gin.Context) {
	wid, err := strconv.ParseInt(c.Query("wealth_id"), 10, 64)
	if err != nil || wid <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad wealth_id"})
		return
	}
	date := c.Query("date")
	if date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 date"})
		return
	}
	uid := currentUserID(c)
	if owner, e := db.WealthProductOwner(wid); e == nil && owner != 0 && owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作该理财"})
		return
	}
	oldAmt, oldCf, existed, err := db.GetWealthSnapshot(wid, date)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !existed {
		c.JSON(http.StatusNotFound, gin.H{"error": "该日无快照记录"})
		return
	}
	if err := db.DeleteWealthSnapshot(wid, date); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if e := db.InsertWealthAudit(db.WealthAudit{
		WealthID: wid, Date: date, Action: "delete", Field: "row",
		OldAmount: oldAmt, OldCash: oldCf, OldExists: true, UserID: uid,
		CreatedAt: time.Now().Format("2006-01-02 15:04:05"),
	}); e != nil {
		log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", wid, date, e)
	}
	// 冲正该快照净存入对应的现金账户变动（当初入账金额 = -oldCf）
	if e := reverseWealthCash(uid, wid, -oldCf, "删除 "+date+" 快照"); e != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// assetWealthAuditList 返回某产品的快照审计记录（新→旧）。
func assetWealthAuditList(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	if owner, e := db.WealthProductOwner(id); e == nil && owner != 0 && owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权查看该理财"})
		return
	}
	rows, err := db.ListWealthAudit(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rows": rows})
}

// assetWealthSnapshotUndo 撤销一条审计记录（恢复 upsert 前的数值 / 恢复被删行）。
// Body: { "audit_id": N }
func assetWealthSnapshotUndo(c *gin.Context) {
	var b struct {
		AuditID int64 `json:"audit_id"`
	}
	if err := c.ShouldBindJSON(&b); err != nil || b.AuditID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad audit_id"})
		return
	}
	a, err := db.GetWealthAudit(b.AuditID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "审计记录不存在"})
		return
	}
	if a.Action == "undo" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该记录已是撤销操作，不可再撤销"})
		return
	}
	uid := currentUserID(c)
	if owner, e := db.WealthProductOwner(a.WealthID); e == nil && owner != 0 && owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作该理财"})
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	var cashPosted float64 // 该审计动作当初落到现金账户的金额（用于冲正）
	if a.Action == "upsert" {
		if !a.OldExists {
			// 原为新建行（撤销 = 删除该行）
			if err := db.DeleteWealthSnapshot(a.WealthID, a.Date); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else {
			if err := db.UpsertWealthSnapshot(a.WealthID, a.Date, a.OldAmount, a.OldCash); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// upsert 当初入账金额 = 旧净存入 − 新净存入（账户视角）
		cashPosted = a.OldCash - a.NewCash
	} else if a.Action == "delete" {
		// 恢复被删除的行
		if err := db.UpsertWealthSnapshot(a.WealthID, a.Date, a.OldAmount, a.OldCash); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// delete 当初冲正入账金额 = +旧净存入
		cashPosted = a.OldCash
	}
	if e := db.InsertWealthAudit(db.WealthAudit{
		WealthID: a.WealthID, Date: a.Date, Action: "undo", Field: "row",
		OldAmount: a.OldAmount, OldCash: a.OldCash, NewAmount: a.OldAmount, NewCash: a.OldCash,
		OldExists: true, UserID: uid, CreatedAt: now,
	}); e != nil {
		log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", a.WealthID, a.Date, e)
	}
	// 反向冲正当初的现金账户变动
	if e := reverseWealthCash(uid, a.WealthID, cashPosted, "撤销 "+a.Date+" 记录"); e != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
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
			"amount":   round2(s.Amount),
			"cashflow": round2(s.Cashflow),
			"pnl":      round2(pnl),
			"cum_pnl":  round2(cum),
		})
		prevAmt = s.Amount
		hasPrev = true
	}
	// 历史从新到旧展示（最新在前）；累计收益 cum 仍按快照顺序累计，反转仅影响展示顺序。
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
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
	// 初始入账记一条流水（新增负债 = 增加贷款）
	if l.Amount != 0 {
		_, _ = db.InsertLiabilityFlow(&db.LiabilityFlow{
			UserID: l.UserID, LiabilityID: id, Type: "loan",
			Amount: round2(l.Amount), Balance: round2(l.Amount), Note: "初始入账",
		})
	}
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
	// 余额变动流水：取旧值比较，调高=增加贷款(loan)，调低=还款(repay)，不变不记
	old, err := db.GetLiability(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if old == nil || old.UserID != l.UserID {
		c.JSON(http.StatusNotFound, gin.H{"error": "负债不存在"})
		return
	}
	if err := db.UpdateLiability(&l); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if delta := round2(l.Amount - old.Amount); delta != 0 {
		ft, note := "loan", "余额调高"
		amt := delta
		if delta < 0 {
			ft, note, amt = "repay", "还款", -delta
		}
		_, _ = db.InsertLiabilityFlow(&db.LiabilityFlow{
			UserID: l.UserID, LiabilityID: id, Type: ft,
			Amount: amt, Balance: round2(l.Amount), Note: note,
		})
	}
	c.JSON(http.StatusOK, gin.H{"liability": l})
}

// liabilityFlows 返回某条负债的余额变动历史（增加贷款 / 还款）。
func liabilityFlows(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	l, err := db.GetLiability(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if l == nil || l.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "负债不存在"})
		return
	}
	flows, err := db.ListLiabilityFlows(uid, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"liability": l, "flows": flows})
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
	// 空内容不写库，避免污染历史
	if strings.TrimSpace(content) != "" {
		if err := db.SaveAISummary(content, b.Model, uid); err != nil {
			log.Printf("warn: save asset ai summary history failed: %v", err)
		}
	} else {
		log.Printf("[ai] asset model=%s 返回内容为空，跳过历史保存", b.Model)
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
		lTotal += fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
		lMonthly += l.MonthlyPayment
		rateStr := ""
		if l.Rate > 0 {
			rateStr = " 年利率" + fmt.Sprintf("%.2f", l.Rate) + "%"
		}
		mpStr := ""
		if l.MonthlyPayment > 0 {
			mpStr = " 月供" + nf(l.MonthlyPayment)
		}
		cur := strings.ToLower(strings.TrimSpace(l.Currency))
		var owe string
		if cur == "usd" || cur == "hkd" {
			owe = fmt.Sprintf("%s%s（≈¥%s CNY）", curSymbol(l.Currency), nf(l.Amount), nf(fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)))
		} else {
			owe = "欠款(CNY)" + nf(l.Amount)
		}
		line := fmt.Sprintf("%d. %s（%s/%s）%s%s%s",
			i+1, l.Name, srcName[l.SourceID], l.Type, owe, rateStr, mpStr)
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
