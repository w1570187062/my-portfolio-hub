package api

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
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
	default: // cny（兼容存量 rmb）, 人民币
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

	// 0) 资产来源名/地域映射（供后续按来源 region 归集 CN/HK/US 资产）
	sources, _ := db.ListSources(uid)
	srcName := map[int64]string{}
	srcRegion := map[int64]string{}
	for _, s := range sources {
		srcName[s.ID] = s.Name
		srcRegion[s.ID] = s.Region
	}
	// 地域归属挂在来源（账户）上：账户内资产默认即该地域资产。合法值 cn/hk/us；
	// 兼容存量 domestic/overseas 写法；来源未归集(source_id=0)或地域未知时默认 cn，
	// 确保各地域资产合计 = 总资产(未减负债前)。
	regionOf := func(sid int64) string {
		r, ok := srcRegion[sid]
		if !ok {
			return "cn"
		}
		switch strings.ToLower(strings.TrimSpace(r)) {
		case "hk", "overseas":
			return "hk"
		case "us":
			return "us"
		default: // cn / domestic / 其它
			return "cn"
		}
	}
	// 按地域归集的资产/负债（均折 CNY）：map 结构，将来加市场不用再加字段
	regAssets := map[string]float64{}
	// 按币种归集的资产总额（权益+理财+现金，均折 CNY）：供资产页「资产构成」卡按币种对比
	curAssets := map[string]float64{}
	curKey := func(c string) string {
		c = strings.ToLower(strings.TrimSpace(c))
		if c == "rmb" {
			return "cny"
		}
		return c
	}

	// 1) 权益类（基金/股票）
	hs, _ := db.List(uid)
	var eqMV, eqCV, eqPnl, eqDay float64
	eqItems := make([]gin.H, 0, len(hs))
	for _, h := range hs {
		v := enrich(h, uid)
		cmv := round2(fxToCNY(v.MarketValue, h.Currency, cnyRate, hkdRate))
		eqMV += cmv
		eqCV += fxToCNY(v.CostValue, h.Currency, cnyRate, hkdRate)
		eqPnl += fxToCNY(v.Pnl, h.Currency, cnyRate, hkdRate)
		eqDay += fxToCNY(v.DayPnl, h.Currency, cnyRate, hkdRate)
		regAssets[regionOf(h.SourceID)] += cmv
		curAssets[curKey(h.Currency)] += cmv
		eqItems = append(eqItems, gin.H{
			"id":           h.ID,
			"name":         h.Name,
			"symbol":       h.Symbol,
			"category":     h.Category,
			"market":       h.Market,
			"market_value": cmv,
			"day_pnl":      round2(fxToCNY(v.DayPnl, h.Currency, cnyRate, hkdRate)),
			"pnl":          round2(fxToCNY(v.Pnl, h.Currency, cnyRate, hkdRate)),
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
		// 当日已录净存入 + 前一快照金额：供「更新理财持仓」弹框预填与盈亏预览（绝对值语义）
		_, todayCf, _, todayFound, _ := db.GetWealthSnapshot(w.ID, today)
		_, prevAmt, prevOk, _ := db.GetWealthPrevSnapshot(w.ID, today)
		if !todayFound {
			todayCf = 0
		}
		if !prevOk {
			prevAmt = 0
		}
		wTotal += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		regAssets[regionOf(w.SourceID)] += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		wToday += fxToCNY(todayPnl, w.Currency, cnyRate, hkdRate)
		wByCur[w.Currency] += amt
		curAssets[curKey(w.Currency)] += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
		cnt, _ := db.CountWealthSnapshots(w.ID)
		// 持有天数：从首次录入快照日期起算（与持仓 buy_date 口径一致），无快照记 0
		firstDate, _, _ := db.GetWealthFirst(w.ID)
		wDays := db.CalcHoldingDays(firstDate)
		// 累计收益：手动编辑值优先（CumPnl 非 0），否则按每日快照自动累计。
		cum := round2(w.CumPnl)
		if cum == 0 {
			cum = round2(wealthCumPnl(w.ID))
		}
		// 本金基准 = 当前金额 − 累计收益（等价于「期初金额 + 后续净存入」）。
		// 已清仓（archived）产品的最新快照金额被清零，该式失效 → 回落到快照历史里
		// 最后一个仍持有金额的节点反推，否则清仓行盈亏率/年化只能显示「—」。
		principal := math.NaN()
		if amt > 0.005 {
			principal = amt - cum
		}
		snaps, snapErr := db.ListWealthSnapshots(w.ID)
		if snapErr == nil && len(snaps) > 0 {
			if math.IsNaN(principal) || principal <= 0.005 {
				if p := wealthPrincipalAtLastHold(snaps); !math.IsNaN(p) {
					principal = p
				}
			}
			// 已清仓：持有天数固定为「首次快照 → 最后一次快照」，避免清仓后逐日拉长把年化稀释
			if w.Archived {
				wDays = daysBetweenDates(firstDate, snaps[len(snaps)-1].Date)
			}
		}
		// 累计收益率 = 累计收益 ÷ 本金 × 100
		cumReturnRate := math.NaN()
		if !math.IsNaN(principal) && principal > 0.005 {
			cumReturnRate = math.Round(cum/principal*10000) / 100
		}
		var cumRateVal interface{} = nil
		if !math.IsNaN(cumReturnRate) {
			cumRateVal = cumReturnRate
		}
		// 年化%（单利）= 累计收益率 × 365 ÷ 持有天数；与原持仓「单利年化」口径一致
		var annRateVal interface{} = nil
		if !math.IsNaN(cumReturnRate) && wDays > 0 {
			annRateVal = math.Round(cumReturnRate*365/float64(wDays)*100) / 100
		}
		wItems = append(wItems, gin.H{
			"id":                     w.ID,
			"name":                   w.Name,
			"code":                   w.Code,
			"currency":               w.Currency,
			"note":                   w.Note,
			"source_id":              w.SourceID,
			"source_name":            srcName[w.SourceID],
			"amount":                 amt,
			"today_pnl":              todayPnl,
			"cum_pnl":                cum,
			"snap_date":              latestDate,
			"snap_count":             cnt,
			"holding_days":           wDays,
			"cum_return_rate":        cumRateVal,
			"annualized_return_rate": annRateVal,
			"archived":               w.Archived,
			"cashflow_today":         round2(todayCf),
			"prev_amount":            round2(prevAmt),
			"nav":                    round4(w.Nav),
			"nav_updated_at":         w.NavUpdatedAt,
			"shares":                 round4(w.Shares),
		})
	}

	// 3.5) 现金
	cashs, _ := db.ListCash(uid)
	var cTotalCNY float64
	cByCur := map[string]float64{}
	cItems := make([]gin.H, 0, len(cashs))
	for _, cc := range cashs {
		cTotalCNY += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		curAssets[curKey(cc.Currency)] += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		regAssets[regionOf(cc.SourceID)] += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
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
			// 日常开销账户：账户表打「日常」徽标，再平衡页据此把这部分从口径里剔除
			"excluded": cc.Excluded,
		})
	}

	// 4) 负债（按来源地域归集，供前端拆分各地域净资产）
	libs, _ := db.ListLiabilities(uid)
	var lTotal float64
	regLiab := map[string]float64{}
	lItems := make([]gin.H, 0, len(libs))
	for _, l := range libs {
		lCNY := fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
		lTotal += lCNY
		regLiab[regionOf(l.SourceID)] += lCNY
		lItems = append(lItems, gin.H{
			"id":          l.ID,
			"name":        l.Name,
			"type":        l.Type,
			"source_id":   l.SourceID,
			"source_name": srcName[l.SourceID],
			"currency":    l.Currency,
			"amount":      round2(l.Amount),
			"note":        l.Note,
		})
	}

	// 5) 消费模块已下线（2026-10-19）：consumptions 表保留兼容旧库，不再输出

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
			"total": round2(lTotal),
			"items": lItems,
		},
		"net_asset":          netAsset,
		"currency_assets":    curAssets,
		"region_assets":      regAssets,
		"region_liabilities": regLiab,
		"rate":               cnyRate,
		"day":                today,
	})
}

// computeWealthPnl returns the daily P&L for a wealth product on a given date:
// pnl = today's amount − previous day's amount − today's net cashflow.
// Returns 0 when there is no snapshot for the date or no previous-day baseline.
func computeWealthPnl(wealthID int64, date string) float64 {
	amt, cash, div, ok, _ := db.GetWealthSnapshot(wealthID, date)
	if !ok {
		return 0
	}
	_, prevAmt, pok, _ := db.GetWealthPrevSnapshot(wealthID, date)
	if !pok {
		return 0
	}
	// 分红（现金分红）作为已实现收益计入：净值因分红跳降不计入亏损。红利再投资金额不变，dividend 恒为 0。
	return round2(amt - prevAmt - cash + div)
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
			cum += s.Amount - prevAmt - s.Cashflow + s.Dividend
		}
		prevAmt = s.Amount
		hasPrev = true
	}
	return round2(cum)
}

// wealthPrincipalAtLastHold 从快照历史反推理财本金基准：
// 取「最后一个金额 > 0 的快照」，用「该点金额 − 截至该点的累计收益」得到本金。
// 不能直接用「期初金额 + 全部净存入」——清仓那一笔 cashflow 是「本金 + 收益」的整额赎回，
// 加进去会把本金算穿（变成负数或只剩收益部分），导致盈亏率/年化出现 0 或荒谬值。
func wealthPrincipalAtLastHold(snaps []db.WealthSnapshot) float64 {
	idx := -1
	for i, s := range snaps {
		if s.Amount > 0.005 {
			idx = i
		}
	}
	if idx < 0 {
		return math.NaN()
	}
	var cum float64
	for i := 1; i <= idx; i++ {
		cum += snaps[i].Amount - snaps[i-1].Amount - snaps[i].Cashflow + snaps[i].Dividend
	}
	return snaps[idx].Amount - cum
}

// daysBetweenDates 返回两个 YYYY-MM-DD 日期之间的天数（end − start）。
// 日期非法或 end 早于 start 时返回 0，供持有天数/年化计算时安全除零。
func daysBetweenDates(start, end string) int {
	s, e1 := time.Parse("2006-01-02", start)
	e, e2 := time.Parse("2006-01-02", end)
	if e1 != nil || e2 != nil {
		return 0
	}
	d := int(e.Sub(s).Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
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
		// 存量兼容：currencies 列为空的来源按现有子账户币种推断回填（一次性自愈）
		if strings.TrimSpace(s.Currencies) == "" {
			s.Currencies = db.InferSourceCurrencies(uid, s.ID)
			if err := db.UpdateSourceCurrencies(uid, s.ID, s.Currencies); err != nil {
				log.Printf("[source] 回填币种集合失败(source=%d): %v", s.ID, err)
			}
		}
		items = append(items, gin.H{
			"id": s.ID, "user_id": s.UserID, "name": s.Name, "type": s.Type, "region": s.Region, "currencies": s.Currencies, "account_no": s.AccountNo, "note": s.Note, "created_at": s.CreatedAt,
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
	conv := func(cur string, v float64) float64 {
		return fxToCNY(v, cur, cnyRate, hkdRate)
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
	s.Region = db.NormRegion(s.Region)
	s.UserID = currentUserID(c)
	// 币种集合：勾选的币种（cny/hkd/usd）规范化后入库。
	// 每个勾选的币种默认生成一个同币种子账户（落点账户），免去新建账户后再手动建子账户的步骤；
	// 子账户仍可在资产页继续增删，互不影响。
	s.Currencies = db.NormalizeCurrencies(s.Currencies)
	id, err := db.CreateSource(&s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.ID = id
	// 为每个勾选币种补建默认子账户（该来源下已存在同币种子账户则不重复创建）
	for _, cur := range db.ParseSourceCurrencies(s.Currencies) {
		if _, e := db.EnsureCashForCurrency(s.UserID, id, s.Name, cur); e != nil {
			log.Printf("warn: createSource id=%d 自动补建 %s 子账户失败: %v", id, cur, e)
		}
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
	s.Region = db.NormRegion(s.Region)
	s.UserID = currentUserID(c)
	// 币种集合联动：仅作为「该账户允许的子账户币种」元数据（新增/编辑子账户时反向同步补全）；
	// 编辑时不自动补建子账户（新建账户会按勾选币种自动生成，见 createSource）。
	s.Currencies = db.NormalizeCurrencies(s.Currencies)
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
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	// 归属校验：仅产品所有者可永久删除
	if owner, e := db.WealthProductOwner(id); e == nil && owner != 0 && owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除该理财"})
		return
	}
	if err := db.DeleteWealth(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// enableWealth 重新启用已清仓停用的理财（archived 0→1 反向）。
func enableWealth(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
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
	if err := db.SetWealthArchived(id, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// clearWealth 清仓一笔理财：剩余持仓全额赎回入账现金账户，并标记「已清仓停用」
// （archived=1：保留产品与历史收益，归入已平仓视图，可重新启用或永久删除）。
// 金额已为 0 时仅停用。快照/现金/审计与「更新理财持仓」同一套机制：
// 当日快照金额清零、净存入记全额（本金变动不计当日盈亏，口径同 computeWealthPnl）。
func clearWealth(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
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
	if p.Archived {
		c.JSON(http.StatusBadRequest, gin.H{"error": "「" + p.Name + "」已清仓停用"})
		return
	}
	today := time.Now().Format("2006-01-02")
	now := time.Now().Format("2006-01-02 15:04:05")
	// 剩余持仓 > 0：当日快照清零并全额赎回（cfDelta = 新净存入 − 旧净存入 = −剩余金额）
	_, latestAmt, _, _ := db.GetWealthLatest(id)
	latestAmt = round2(latestAmt)
	if latestAmt > 0.005 {
		oldAmt, oldCf, oldDiv, existed, _ := db.GetWealthSnapshot(id, today)
		newCf := math.Round((oldCf-latestAmt)*100) / 100
		// 落账账户：缺省回落同来源、同币种余额最大的子账户（解析失败直接拒绝，避免半程状态）
		acc, e := resolveCashAccount(uid, 0, p.SourceID, p.Currency)
		if e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
			return
		}
		if e := db.UpsertWealthSnapshot(id, today, 0, newCf, oldDiv); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		cfDelta := math.Round((newCf-oldCf)*100) / 100
		if e := applyWealthCash(uid, id, today, cfDelta, acc.ID); e != nil {
			// 回滚快照，保证「快照 + 现金」原子生效（审计未写，无残留）
			if existed {
				_ = db.UpsertWealthSnapshot(id, today, oldAmt, oldCf, oldDiv)
			} else {
				_ = db.DeleteWealthSnapshot(id, today)
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
			return
		}
		if e := db.InsertWealthAudit(db.WealthAudit{
			WealthID: id, Date: today, Action: "upsert", Field: "row",
			OldAmount: oldAmt, OldCash: oldCf, OldDividend: oldDiv,
			NewAmount: 0, NewCash: newCf, NewDividend: oldDiv,
			OldExists: existed, CashAccountID: acc.ID, UserID: uid, CreatedAt: now,
		}); e != nil {
			log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", id, today, e)
		}
	}
	if err := db.SetWealthArchived(id, true); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "redeemed": latestAmt})
}

// reduceWealth：部分减仓（赎回）——按指定金额赎回并入账到指定现金账户，产品保留并继续每日录入；
// 金额等于剩余持仓时等同清仓（清零并归档）。复用 clearWealth 同一套快照/现金/审计原子逻辑。
func reduceWealth(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
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
	if p.Archived {
		c.JSON(http.StatusBadRequest, gin.H{"error": "「" + p.Name + "」已清仓停用"})
		return
	}
	var req struct {
		Amount        float64 `json:"amount"`
		CashAccountID int64   `json:"cash_account_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	_, latestAmt, _, _ := db.GetWealthLatest(id)
	latestAmt = round2(latestAmt)
	if latestAmt <= 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该理财当前无持仓，无法减仓"})
		return
	}
	amount := round2(req.Amount)
	if amount <= 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "减仓金额必须大于 0"})
		return
	}
	if amount > latestAmt+0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "减仓金额不能超过剩余持仓"})
		return
	}
	full := amount >= latestAmt-0.005
	// 落账账户：必须与理财同来源、同币种（跨来源/跨币种拒绝），缺省回落同来源同币种余额最大子账户
	acc, e := resolveCashAccount(uid, req.CashAccountID, p.SourceID, p.Currency)
	if e != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
	}
	today := time.Now().Format("2006-01-02")
	now := time.Now().Format("2006-01-02 15:04:05")
	oldAmt, oldCf, oldDiv, existed, _ := db.GetWealthSnapshot(id, today)
	newAmt := 0.0
	if !full {
		newAmt = round2(latestAmt - amount)
	}
	newCf := round2(oldCf - amount)
	cfDelta := round2(newCf - oldCf)
	if e := db.UpsertWealthSnapshot(id, today, newAmt, newCf, oldDiv); e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	}
	if e := applyWealthCash(uid, id, today, cfDelta, acc.ID); e != nil {
		if existed {
			_ = db.UpsertWealthSnapshot(id, today, oldAmt, oldCf, oldDiv)
		} else {
			_ = db.DeleteWealthSnapshot(id, today)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
	}
	if e := db.InsertWealthAudit(db.WealthAudit{
		WealthID: id, Date: today, Action: "upsert", Field: "row",
		OldAmount: oldAmt, OldCash: oldCf, OldDividend: oldDiv,
		NewAmount: newAmt, NewCash: newCf, NewDividend: oldDiv,
		OldExists: existed, CashAccountID: acc.ID, UserID: uid, CreatedAt: now,
	}); e != nil {
		log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", id, today, e)
	}
	if full {
		if e := db.SetWealthArchived(id, true); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "reduced": amount, "full": full})
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
			"note": cc.Note, "excluded": cc.Excluded, "created_at": cc.CreatedAt,
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
		cc.Currency = "cny"
	}
	cc.UserID = currentUserID(c)
	id, err := db.CreateCash(&cc)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	cc.ID = id
	// 币种集合反向同步：子账户用到的币种补进所属账户的 currencies（只补不删），
	// 保证「账户已勾选币种」始终覆盖实际子账户币种。
	if err := db.SyncSourceCurrency(cc.UserID, cc.SourceID, cc.Currency); err != nil {
		log.Printf("[cash] 同步来源币种集合失败(source=%d): %v", cc.SourceID, err)
	}
	c.JSON(http.StatusOK, gin.H{"cash": cc})
}

func updateCash(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	// excluded 是布尔值，false 与「没传这个键」不可区分。本接口是全量 PUT，若直接绑定会把
	// 老调用方（余额对账、± 资金调整）没带的 excluded 静默清成 false → 用指针探测键是否存在，
	// 缺失时沿用库中原值。
	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	var probe struct {
		Excluded *bool `json:"excluded"`
	}
	_ = json.Unmarshal(raw, &probe)
	var cc db.Cash
	if err := json.Unmarshal(raw, &cc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	cc.ID = id
	if probe.Excluded != nil {
		cc.Excluded = *probe.Excluded
	} else if fresh, e := db.GetCash(id); e == nil && fresh != nil {
		cc.Excluded = fresh.Excluded
	}
	cc.Name = strings.TrimSpace(cc.Name)
	if cc.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if cc.Currency == "" {
		cc.Currency = "cny"
	}
	cc.UserID = currentUserID(c)
	// 币种集合反向同步：改币种时把新币种补进所属账户的 currencies（只补不删）。
	if err := db.SyncSourceCurrency(cc.UserID, cc.SourceID, cc.Currency); err != nil {
		log.Printf("[cash] 同步来源币种集合失败(source=%d): %v", cc.SourceID, err)
	}
	if err := db.UpdateCash(&cc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 回读库中真实状态返回
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

// listFlows 返回资产全景「流水」tab 的资金流水：合并现金流水与负债流水，
// 按年份/日期区间筛选；无 start/end 时仅返回可选年份列表（前端默认取近 2 个月）。
func listFlows(c *gin.Context) {
	uid := currentUserID(c)
	years, err := db.FlowYears(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	start := strings.TrimSpace(c.Query("start"))
	end := strings.TrimSpace(c.Query("end"))
	out := []db.AggFlow{}
	if start != "" && end != "" {
		flows, e := db.ListFlows(uid, start, end)
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		out = flows
	}
	c.JSON(http.StatusOK, gin.H{"flows": out, "years": years})
}

// ---- 财务：被动收入 / 收支汇总 ----

// finScope 是一个统计周期（月/年）的收支汇总结果。
type finScope struct {
	Income    float64     `json:"income"`     // 收入合计（含落袋收益）
	Expense   float64     `json:"expense"`    // 支出合计
	Net       float64     `json:"net"`        // 结余 = 收入 − 支出
	Breakdown []finCatRow `json:"breakdown"`  // 按语义分类拆分（收入为正、支出为绝对值）
	InvestIn  float64     `json:"invest_in"`  // 投资活动流入（赎回/到期回款）
	InvestOut float64     `json:"invest_out"` // 投资活动流出（存入/买入/存款）
	Transfer  float64     `json:"transfer"`   // 内部划转净额
	Financing float64     `json:"financing"`  // 融资借贷净额（借入−还款）
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

type finCatRow struct {
	Category string  `json:"category"`
	Type     string  `json:"type"` // "income" | "expense"
	Amount   float64 `json:"amount"`
}

// financeSummary 聚合「财务」页所需的被动收入、月度/年度收支汇总与覆盖月数。
// 口径（2026-10-22 分类重构）：
//   - 收入 = 工资/经营/分红/利息/落袋收益/其他收入；
//   - 支出 = 日常消费/居住/资本开支/负债偿还/税费/保险/教育医疗/投资费用/其他支出；
//   - 投资活动（加仓/减仓/定投/理财申赎/存款本息本金）与内部划转（转账）不计入收支，单独列小计；
//   - 被动收入 = 投资分红 + 投资利息（含存款利息）+ 已落袋投资收益（减仓实现 + 手动平仓）+ 理财派息。
func financeSummary(c *gin.Context) {
	uid := currentUserID(c)
	cnyRate, hkdRate, degraded := market.GetFXRates()
	toCNY := func(amt float64, cur string) float64 { return fxToCNY(amt, cur, cnyRate, hkdRate) }
	now := time.Now()
	curYear := now.Format("2006")
	// 支持 ?year=YYYY 查询指定年度（财务页年度选择器）；非法值回落当前年。
	year := curYear
	if y := strings.TrimSpace(c.Query("year")); len(y) == 4 && y >= "2000" && y <= "2999" {
		year = y
	}
	// 「本月」口径只在所选年度为当年时有意义；往年留空，月度 scope 保持零值。
	ym := ""
	if year == curYear {
		ym = now.Format("2006-01")
	}
	yearStart, yearEnd := year+"-01-01", year+"-12-31"
	years, _ := db.ListFlowYears(uid)
	if len(years) == 0 {
		years = []string{curYear}
	} else if !containsStr(years, curYear) {
		years = append([]string{curYear}, years...)
	}
	flows, err := db.ListFlows(uid, yearStart, yearEnd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 已落袋收益（减仓 + 手动平仓）与理财派息：按月份聚合，折 CNY 后计入收入/被动收入
	gainByMonth := map[string]float64{}
	wealthDivByMonth := map[string]float64{}
	var gainYear, wealthDivYear float64
	if rows, e := db.ListGainRows(uid, yearStart, yearEnd); e == nil {
		for _, r := range rows {
			cny := toCNY(r.Amount, r.Currency)
			gainByMonth[r.YM] += cny
			gainYear += cny
		}
	}
	if rows, e := db.ListWealthDividendRows(uid, yearStart, yearEnd); e == nil {
		for _, r := range rows {
			cny := toCNY(r.Amount, r.Currency)
			wealthDivByMonth[r.YM] += cny
			wealthDivYear += cny
		}
	}

	month := newFinScope()
	yearScope := newFinScope()
	// 12 个月度归集（热力图：月度收支柱 + 当月子项 treemap 用），下标 = 月份−1。
	monthScopes := make([]*finScope, 12)
	for i := range monthScopes {
		monthScopes[i] = newFinScope()
	}
	// 自定义分类的方向不在内置表内，按用户设置解析；设置缺失时按金额方向兜底
	customDir := map[string]string{}
	if defs, e := loadFlowCategories(uid); e == nil {
		for _, d := range defs {
			customDir[d.Key] = d.Dir
		}
	}
	var divYear, intYear float64 // 被动收入：分红 / 利息（现金流部分）
	// 兜底去重：同一笔还款可能产生两条流水（现金 debt outflow + 负债 repay），
	// 同日同金额同时存在时只计入现金那条（expense 口径一致），剔除负债 repay 以避免支出翻倍。
	flows = dedupRepayFlows(flows)
	for _, f := range flows {
		cny := toCNY(f.Amount, f.Currency)
		// 符号归一：现金流水 amount 自带方向（入账正/出账负）；负债流水 amount 恒为正，
		// 语义由 type 决定（loan=融资流入 / repay=偿还流出）。
		signed := cny
		if f.Kind == "liability" {
			if f.Type == "repay" {
				signed = -math.Abs(cny)
			} else {
				signed = math.Abs(cny)
			}
		}
		cat := f.Category
		if cat == "" {
			cat = db.AutoCategory(f.Type, f.Amount, f.Note)
		}
		dir := db.FinCatDir(cat)
		if dir == "neutral" {
			// 内置 neutral（投资/划转/融资）保持原样；自定义分类按用户设置的方向归收支
			if d, ok := customDir[cat]; ok {
				dir = d
			} else if !db.IsKnownFinCat(cat) && signed >= 0 {
				dir = "income"
			} else if !db.IsKnownFinCat(cat) {
				dir = "expense"
			}
		}
		if ym != "" && strings.HasPrefix(f.Date, ym) {
			addFinFlow(month, cat, dir, signed)
		}
		addFinFlow(yearScope, cat, dir, signed)
		// 按月归集（仅同年度内的 12 个月）：用于热力图月度柱与当月子项 treemap
		if len(f.Date) >= 7 {
			ymFull := f.Date[:7]
			if ymFull >= year+"-01" && ymFull <= year+"-12" {
				if mm, e := strconv.Atoi(ymFull[5:7]); e == nil && mm >= 1 && mm <= 12 {
					addFinFlow(monthScopes[mm-1], cat, dir, signed)
				}
			}
		}
		if dir == "income" && cat == db.CatInvestDiv {
			divYear += signed
		}
		if dir == "income" && cat == db.CatInvestInt {
			intYear += signed
		}
	}
	// 落袋收益计入收入（月/年），不经过现金流
	month.addGain(gainByMonth[ym])
	yearScope.addGain(gainYear)
	// 理财派息计入被动收入（不进现金流收支，避免与快照净存入重复）
	month.breakdownAdd(db.CatInvestDiv, "income", wealthDivByMonth[ym])
	yearScope.breakdownAdd(db.CatInvestDiv, "income", wealthDivYear)
	// 各月同样计入落袋收益与理财派息（热力图月度口径与年/月一致）
	for i := 0; i < 12; i++ {
		mi := fmt.Sprintf("%02d", i+1)
		ymFull := year + "-" + mi
		monthScopes[i].addGain(gainByMonth[ymFull])
		monthScopes[i].breakdownAdd(db.CatInvestDiv, "income", wealthDivByMonth[ymFull])
	}

	// 被动收入（年度）：分红 + 利息 + 落袋收益 + 理财派息
	passiveYear := divYear + intYear + gainYear + wealthDivYear
	// 覆盖月数基准：优先当年本月支出年化；本月无支出或所选为往年时，用该年度月均支出。
	var coverage, monthsCovered float64
	base := month.Expense
	if base <= 0 {
		base = yearScope.Expense / 12
	}
	if base > 0 {
		coverage = passiveYear / (base * 12)
		monthsCovered = coverage * 12
	}
	// 收支平衡：结余 / 收入（收入为 0 时不做除法，按 0 处理）。
	// 注意 Net 只在 out() 里推导，此处须自行用 Income-Expense。
	saveRate := 0.0
	if yearScope.Income > 0 {
		saveRate = (yearScope.Income - yearScope.Expense) / yearScope.Income
	}
	// 月度明细（热力图 + 月度分类详情用）：12 个月各自的收入/支出/结余与分类子项（收入为正、支出为绝对值）。
	monthsOut := make([]gin.H, 0, 12)
	for i := 0; i < 12; i++ {
		mi := fmt.Sprintf("%02d", i+1)
		ymFull := year + "-" + mi
		ms := monthScopes[i].out()
		monthsOut = append(monthsOut, gin.H{
			"ym":      ymFull,
			"month":   i + 1,
			"income":  ms.Income,
			"expense": ms.Expense,
			"net":     ms.Net,
			"items":   ms.Breakdown, // []finCatRow{category,type,amount}
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"selected_year":       year,
		"available_years":     years,
		"save_rate":           round2(saveRate),
		"passive_income_year": round2(passiveYear),
		"passive_breakdown": []gin.H{
			{"label": "投资分红", "amount": round2(divYear)},
			{"label": "投资利息", "amount": round2(intYear)},
			{"label": "落袋收益", "amount": round2(gainYear)},
			{"label": "理财派息", "amount": round2(wealthDivYear)},
		},
		"month":          month.out(),
		"year":           yearScope.out(),
		"months":         monthsOut,
		"coverage":       round2(coverage),
		"months_covered": round2(monthsCovered),
		"rate_degraded":  degraded,
	})
}

func newFinScope() *finScope { return &finScope{Breakdown: []finCatRow{}} }

// addFinFlow 把一条现金流按语义分类归入统计（neutral 类只累计投资/划转/融资小计，不进收支）。
// signed 为带符号金额：收入类为正、支出类为负（冲正流水天然抵消）。
func addFinFlow(s *finScope, cat, dir string, signed float64) {
	switch dir {
	case "income":
		s.Income += signed
		s.breakdownAdd(cat, "income", signed)
	case "expense":
		s.Expense += -signed
		s.breakdownAdd(cat, "expense", -signed)
	default:
		switch cat {
		case db.CatInvest:
			if signed >= 0 {
				s.InvestIn += signed
			} else {
				s.InvestOut += -signed
			}
		case db.CatTransfer:
			s.Transfer += signed
		case db.CatFinancing:
			s.Financing += signed
		}
	}
}

// addGain 计入一笔非现金流的落袋收益（收入）。
func (s *finScope) addGain(amount float64) {
	if amount == 0 {
		return
	}
	s.Income += amount
	s.breakdownAdd(db.CatGain, "income", amount)
}

func (s *finScope) breakdownAdd(cat, dir string, amount float64) {
	if amount == 0 {
		return
	}
	for i := range s.Breakdown {
		if s.Breakdown[i].Category == cat && s.Breakdown[i].Type == dir {
			s.Breakdown[i].Amount += amount
			return
		}
	}
	s.Breakdown = append(s.Breakdown, finCatRow{Category: cat, Type: dir, Amount: amount})
}

// dedupRepayFlows 剔除与现金还款流水重复的负债 repay 流水（同日同额），
// 避免「分两步操作（记支出 + 改负债）」或「原子还款 endpoint 同时写双流水」导致支出翻倍。
// 只剔除 kind=liability & type=repay & category=CatDebt 的记录，保留其他负债流水（loan 等）。
func dedupRepayFlows(flows []db.AggFlow) []db.AggFlow {
	// 先收集所有现金 debt outflow：key = date|currency|abs(amount)
	cashKeys := make(map[string]bool)
	for _, f := range flows {
		if f.Kind == "cash" && f.Category == db.CatDebt && f.Amount < 0 {
			k := f.Date + "|" + f.Currency + "|" + fmt.Sprintf("%.2f", math.Abs(f.Amount))
			cashKeys[k] = true
		}
	}
	if len(cashKeys) == 0 {
		return flows
	}
	out := make([]db.AggFlow, 0, len(flows))
	for _, f := range flows {
		if f.Kind == "liability" && f.Type == "repay" && f.Category == db.CatDebt {
			k := f.Date + "|" + f.Currency + "|" + fmt.Sprintf("%.2f", math.Abs(f.Amount))
			if cashKeys[k] {
				continue // 同日同额已有现金 debt 出账，跳过这条 repay 流水，避免 double count
			}
		}
		out = append(out, f)
	}
	return out
}

func (s *finScope) out() finScope {
	cp := *s
	cp.Net = round2(cp.Income - cp.Expense)
	cp.Income = round2(cp.Income)
	cp.Expense = round2(cp.Expense)
	cp.InvestIn = round2(cp.InvestIn)
	cp.InvestOut = round2(cp.InvestOut)
	cp.Transfer = round2(cp.Transfer)
	cp.Financing = round2(cp.Financing)
	sort.SliceStable(cp.Breakdown, func(i, j int) bool {
		if cp.Breakdown[i].Type != cp.Breakdown[j].Type {
			return cp.Breakdown[i].Type == "income"
		}
		return cp.Breakdown[i].Amount > cp.Breakdown[j].Amount
	})
	for i := range cp.Breakdown {
		cp.Breakdown[i].Amount = round2(cp.Breakdown[i].Amount)
	}
	return cp
}

func deleteCash(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	acc, err := db.GetCash(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if acc == nil || acc.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "子账户不存在"})
		return
	}
	// 被收支计划引用（入账/还款账户）的子账户不能删，否则计划完成时无账户可落账
	if plans, e := db.ListCashflowPlans(uid); e == nil {
		for _, p := range plans {
			if p.AccountID == id {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该子账户正被收支计划「" + p.Title + "」引用（入账/还款账户），不能删除"})
				return
			}
		}
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
		CashID   int64   `json:"cash_id"`
		Delta    float64 `json:"delta"`
		Note     string  `json:"note"`
		Category string  `json:"category"` // 收支语义分类（空=按类型自动推导）
		Snapshot bool    `json:"snapshot"` // 仅快照：计入汇总分析不改动账户真实余额
		Date     string  `json:"date"`     // 可选：补录历史流水（YYYY-MM-DD），空=今天
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.CashID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择子账户"})
		return
	}
	// 补录日期：截图批量录入要把流水落在那一天，而不是导入当天（否则月度统计串位）
	flowDate := strings.TrimSpace(b.Date)
	if flowDate != "" {
		if _, err := time.Parse("2006-01-02", flowDate); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式应为 YYYY-MM-DD"})
			return
		}
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
	// 仅快照流水不改动真实余额，不校验余额是否充足（用于汇总分析的假设性记录）。
	if !b.Snapshot && acc.Amount+delta < -0.004 {
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
	category, err := resolveFlowCategory(c, b.Category, delta)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 仅手动调账路径支持快照；还款到负债走原子端点（repayLiability），忽略 snapshot。
	if err := db.AddCashAmountFromCatOn("", acc.ID, delta, "manual", "manual", acc.ID, acc.Name, note, category, b.Snapshot, flowDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// adjustLiability 直接对负债账户记账（添加流水弹框合并「关联负债」后：
// 用户在子账户下拉选中负债账户，后端按账户类型自动记 loan/repay）。
// delta 符号与现金调账一致：>0 = 账户余额增加（借入 / 新增负债，type=loan），
// <0 = 账户余额减少（还款，type=repay，余额最低截到 0，避免负数）。
func adjustLiability(c *gin.Context) {
	var b struct {
		LiabilityID int64   `json:"liability_id"`
		Delta        float64 `json:"delta"`
		Note         string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.LiabilityID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择负债账户"})
		return
	}
	delta := math.Round(b.Delta*100) / 100
	if math.Abs(delta) < 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "调整金额不能为 0（借入填正数，还款填负数）"})
		return
	}
	uid := currentUserID(c)
	liab, err := db.GetLiability(b.LiabilityID)
	if err != nil || liab == nil || liab.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "负债账户不存在或无权访问"})
		return
	}
	newBal := math.Round((liab.Amount+delta)*100) / 100
	if newBal < 0 {
		newBal = 0
	}
	typ := "loan"
	if delta < 0 {
		typ = "repay"
	}
	note := strings.TrimSpace(b.Note)
	if note == "" {
		if delta > 0 {
			note = "借入 " + liab.Name
		} else {
			note = "还款至 " + liab.Name
		}
	}
	liab.Amount = newBal
	if err := db.UpdateLiability(liab); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.InsertLiabilityFlow(&db.LiabilityFlow{
		UserID: uid, LiabilityID: liab.ID, Type: typ,
		Amount: math.Abs(delta), Balance: newBal, Note: note,
	}); err != nil {
		// 回滚负债余额
		old := *liab
		old.Amount = math.Round((newBal-delta)*100) / 100
		_ = db.UpdateLiability(&old)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "type": typ, "liability": liab.Name})
}

// repayLiability 原子完成「子账户扣款 → 负债还款」：
//  1. 从 cash_id 扣款 amount（负数），写一条 cash_flow，type=repay_liability，category=CatDebt；
//  2. liabilities 余额减记 amount，写一条 liability_flow type=repay；
//     任一步失败时回滚前一步，保证「现金+负债」同时生效。
//
// 用原子端点替代用户分两步（记支出 + 改负债）操作，避免支出 double count。
func repayLiability(c *gin.Context) {
	var b struct {
		CashID      int64   `json:"cash_id"`
		LiabilityID int64   `json:"liability_id"`
		Amount      float64 `json:"amount"`
		Note        string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.CashID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择子账户"})
		return
	}
	if b.LiabilityID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要还款的负债"})
		return
	}
	amt := math.Round(b.Amount*100) / 100
	if amt <= 0.005 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "还款金额必须大于 0"})
		return
	}
	uid := currentUserID(c)
	cash, err := db.GetCash(b.CashID)
	if err != nil || cash == nil || cash.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "子账户不存在或无权访问"})
		return
	}
	liab, err := db.GetLiability(b.LiabilityID)
	if err != nil || liab == nil || liab.UserID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "负债不存在或无权访问"})
		return
	}
	if cash.Amount+(-amt) < -0.004 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("还款金额超过子账户余额（当前余额 %.2f）", cash.Amount)})
		return
	}
	note := strings.TrimSpace(b.Note)
	if note == "" {
		note = "还款至 " + liab.Name
	}
	// 1) 现金扣款（category=CatDebt：负债偿还 → 计入支出）
	if err := db.AddCashAmountCat(cash.ID, -amt, "repay_liability", "liability", liab.ID, liab.Name, note, db.CatDebt); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 2) 负债减记（余额最低为 0，避免负数）
	newBal := math.Round((liab.Amount-amt)*100) / 100
	if newBal < 0 {
		newBal = 0
	}
	liab.Amount = newBal
	if err := db.UpdateLiability(liab); err != nil {
		// 回滚现金
		_ = db.AddCashAmount(cash.ID, amt, "repay_rollback", "liability", liab.ID, liab.Name, "还款失败回滚")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 3) 写负债还款流水（listFlows 会统一带 CatDebt，与现金流水的 CatDebt 做兜底去重）
	if _, err := db.InsertLiabilityFlow(&db.LiabilityFlow{
		UserID: uid, LiabilityID: liab.ID, Type: "repay",
		Amount: amt, Balance: newBal, Note: note,
	}); err != nil {
		// 回滚现金 + 回滚负债余额
		_ = db.AddCashAmount(cash.ID, amt, "repay_rollback", "liability", liab.ID, liab.Name, "还款流水失败回滚")
		old := *liab
		old.Amount = math.Round((newBal+amt)*100) / 100
		if old.Amount != liab.Amount {
			_ = db.UpdateLiability(&old)
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "new_cash": round2(newBal), "liability": liab.Name})
}

// resolveFlowCategory 校验并归一化前端提交的收支分类：空=按类型/方向自动推导；
// 内置 key 或用户自定义分类（settings flow_categories）均放行，其余拒绝。
func resolveFlowCategory(c *gin.Context, raw string, delta float64) (string, error) {
	cat := strings.TrimSpace(raw)
	if cat == "" {
		if delta >= 0 {
			return db.CatOtherIn, nil
		}
		return db.CatOtherOut, nil
	}
	if db.IsKnownFinCat(cat) {
		return cat, nil
	}
	custom, err := loadFlowCategoryKeys(currentUserID(c))
	if err != nil {
		return "", err
	}
	for _, k := range custom {
		if k == cat {
			return cat, nil
		}
	}
	return "", fmt.Errorf("未知的收支分类：%s", cat)
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
			Dividend      float64 `json:"dividend"`
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
		p, e := db.GetWealthProduct(it.WealthID)
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		if p == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "理财产品不存在（id=" + strconv.FormatInt(it.WealthID, 10) + "）"})
			return
		}
		// 已清仓停用的产品不再接受持仓录入（弹框本就不显示；防过期页面提交）
		if p.Archived {
			c.JSON(http.StatusBadRequest, gin.H{"error": "「" + p.Name + "」已清仓停用；如需继续记录持仓，请先在理财列表中点「启用」"})
			return
		}
		if it.Amount < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "持仓金额不能为负（产品 " + strconv.FormatInt(it.WealthID, 10) + "）"})
			return
		}
		// 拉取当日已存快照：用于「本次实际资金变动」差值计算（cfDelta = 新 cashflow − 旧 cashflow）。
		oldAmt, oldCf, oldDiv, existed, _ := db.GetWealthSnapshot(it.WealthID, b.Date)
		// 净存入正负均合法：正数=存入（子账户扣款），负数=取出（回款入账，2026-10-18 减仓弹框删除后
		// 由「更新理财持仓」的负净存入承担；当日盈亏按 computeWealthPnl 口径天然剔除本金变动）。
		// phantom 盈亏拦截：仅在「今日首次录入快照（existed=false）」时生效。
		// 今日已存过快照后再调 amount 是合法操作（用户修正持仓金额），不应因 cashflow 沿用旧值而拦截。
		// 首次录入时 cashflow≠0 但 amount==prevAmt 才是真 Phantom（把净存入算成了当日盈亏）。
		if !existed && math.Abs(it.Cashflow) > 1e-9 {
			_, prevAmt, prevOk, pe := db.GetWealthPrevSnapshot(it.WealthID, b.Date)
			if pe == nil && prevOk {
				if math.Abs(prevAmt-it.Amount) < 0.005 {
					c.JSON(http.StatusBadRequest, gin.H{"error": "产品 " + strconv.FormatInt(it.WealthID, 10) + " 在 " + b.Date + " 的净存入不为 0，但持仓金额与前一日相同，将产生错误盈亏。无资金变动请把净存入填 0。"})
					return
				}
			}
		}
		// 写审计：记录改前/改后
		// 与当日快照完全一致 → 无变化：跳过落库与审计（防御性兜底，前端本就只提交有变化的行）
		if existed && math.Abs(oldAmt-it.Amount) < 0.005 && math.Abs(oldCf-it.Cashflow) < 0.005 {
			continue
		}
		// 现金落账前先解析账户：审计需记录实际落账子账户（撤销时优先冲正回原账户）。
		// 仅在确有资金变动（cfDelta≠0）时解析；解析失败直接拒绝，避免快照已改而现金未动的半程状态。
		cashAccID := int64(0)
		cfDelta := math.Round((it.Cashflow-oldCf)*100) / 100
		if math.Abs(cfDelta) >= 0.005 {
			acc, e := resolveCashAccount(uid, it.CashAccountID, p.SourceID, p.Currency)
			if e != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
				return
			}
			cashAccID = acc.ID
		}
		if err := db.UpsertWealthSnapshot(it.WealthID, b.Date, it.Amount, it.Cashflow, it.Dividend); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 净存入变动联动现金账户（按新旧 cashflow 差值落账，重复保存只补差额，天然幂等）。
		// 分红不联动现金账户（分红现金由用户在银行子账户自行登记，避免与已对账余额重复计入）。
		// 落账失败时回滚快照到改前值，保证「快照 + 现金」原子生效（审计未写，无残留）。
		if e := applyWealthCash(uid, it.WealthID, b.Date, cfDelta, cashAccID); e != nil {
			if existed {
				_ = db.UpsertWealthSnapshot(it.WealthID, b.Date, oldAmt, oldCf, oldDiv)
			} else {
				_ = db.DeleteWealthSnapshot(it.WealthID, b.Date)
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
			return
		}
		if e := db.InsertWealthAudit(db.WealthAudit{
			WealthID: it.WealthID, Date: b.Date, Action: "upsert", Field: "row",
			OldAmount: oldAmt, OldCash: oldCf, OldDividend: oldDiv,
			NewAmount: it.Amount, NewCash: it.Cashflow, NewDividend: it.Dividend,
			OldExists: existed, CashAccountID: cashAccID, UserID: uid, CreatedAt: now,
		}); e != nil {
			log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", it.WealthID, b.Date, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "date": b.Date})
}

// applyWealthCash 把一次理财快照「当日净存入」的变动落到现金账户（并写一条流水）：
//   - cfDelta > 0（净申购/存入理财）：现金账户扣款（理财存入），账户取前端选定的 cashIDIn；
//   - cfDelta < 0（净赎回/取出理财）：现金账户入账（理财回款），账户同样取前端选定的 cashIDIn；
//
// cashIDIn 为 0（未选）时由 resolveCashAccount 回落该理财同来源、同币种余额最大的子账户。
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
// postedAmount 为当初入账金额（正=入账/负=出账）。冲正账户优先级：
//  1. preferCashID > 0（审计记录里存的当时落账子账户）→ 直接用；
//  2. 按引用+金额匹配原流水所在账户（FindCashFlowByRef）；
//  3. 兜底回落来源默认账户。
func reverseWealthCash(uid, wealthID int64, postedAmount float64, note string, preferCashID int64) error {
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
	cashID := preferCashID
	if cashID <= 0 {
		if f, e := db.FindCashFlowByRef("wealth", wealthID, postedAmount); e == nil && f != nil {
			cashID = f.CashID
		}
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
	oldAmt, oldCf, oldDiv, existed, err := db.GetWealthSnapshot(wid, date)
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
		OldAmount: oldAmt, OldCash: oldCf, OldDividend: oldDiv, OldExists: true, UserID: uid,
		CreatedAt: time.Now().Format("2006-01-02 15:04:05"),
	}); e != nil {
		log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", wid, date, e)
	}
	// 冲正该快照净存入对应的现金账户变动（当初入账金额 = -oldCf）
	if e := reverseWealthCash(uid, wid, -oldCf, "删除 "+date+" 快照", 0); e != nil {
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
			if err := db.UpsertWealthSnapshot(a.WealthID, a.Date, a.OldAmount, a.OldCash, a.OldDividend); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// upsert 当初入账金额 = 旧净存入 − 新净存入（账户视角）
		cashPosted = a.OldCash - a.NewCash
		// 撤销清仓记录时同时恢复产品为启用状态，回到清仓前的完整状态
		if a.Field == "clear" {
			if err := db.SetWealthArchived(a.WealthID, false); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
	} else if a.Action == "delete" {
		// 恢复被删除的行
		if err := db.UpsertWealthSnapshot(a.WealthID, a.Date, a.OldAmount, a.OldCash, a.OldDividend); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// delete 当初冲正入账金额 = +旧净存入
		cashPosted = a.OldCash
	}
	if e := db.InsertWealthAudit(db.WealthAudit{
		WealthID: a.WealthID, Date: a.Date, Action: "undo", Field: "row",
		OldAmount: a.OldAmount, OldCash: a.OldCash, OldDividend: a.OldDividend,
		NewAmount: a.OldAmount, NewCash: a.OldCash, NewDividend: a.OldDividend,
		OldExists: true, UserID: uid, CreatedAt: now,
	}); e != nil {
		log.Printf("[wealth-audit] 写入审计失败(wealth=%d date=%s): %v", a.WealthID, a.Date, e)
	}
	// 反向冲正当初的现金账户变动（优先回审计记录里存的当时落账子账户）
	if e := reverseWealthCash(uid, a.WealthID, cashPosted, "撤销 "+a.Date+" 记录", a.CashAccountID); e != nil {
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
			pnl = s.Amount - prevAmt - s.Cashflow + s.Dividend
		}
		cum += pnl
		rows = append(rows, gin.H{
			"date":     s.Date,
			"amount":   round2(s.Amount),
			"cashflow": round2(s.Cashflow),
			"dividend": round2(s.Dividend),
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
	// 除负债自身字段外，额外接受 flow_note：本次余额变动流水的备注（可选）。
	// 填入时覆盖默认的「余额调高 / 还款」，让负债侧的「± 借入/还款 + 说明」与
	// 子账户的「± 资金 + 说明」（adjustCash）对齐。
	var body struct {
		db.Liability
		FlowNote string `json:"flow_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	l := body.Liability
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
		if fn := strings.TrimSpace(body.FlowNote); fn != "" {
			note = fn
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
	prompt := b.Template
	if !b.Resolved {
		prompt = injectData(b.Template, stats)
	}
	content, err := callChatCompletions(b.BaseURL, b.APIKey, b.Model, prompt)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
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
// wealth products (理财), liabilities (负债) and asset snapshot data.
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
		eqMV += fxToCNY(v.MarketValue, h.Currency, cnyRate, hkdRate)
		eqCV += fxToCNY(v.CostValue, h.Currency, cnyRate, hkdRate)
		eqPnl += fxToCNY(v.Pnl, h.Currency, cnyRate, hkdRate)
		eqDay += fxToCNY(v.DayPnl, h.Currency, cnyRate, hkdRate)
	}
	eqTotalPct := 0.0
	if eqCV > 0 {
		eqTotalPct = eqPnl / eqCV * 100
	}
	b.WriteString("\n【权益类（基金 / 股票）】\n")
	b.WriteString("持仓数：" + fmt.Sprintf("%d", len(hs)) + " 条\n")
	b.WriteString("市值(CNY)：" + nf(eqMV) + "  成本(CNY)：" + nf(eqCV) + "\n")
	b.WriteString("总盈亏(CNY)：" + sf(eqPnl) + "（" + pf(eqTotalPct) + "）  今日盈亏(CNY)：" + sf(eqDay) + "\n")
	for i, v := range eqViews {
		h := v.Holding
		line := fmt.Sprintf("%d. %s(%s) %s/%s 市值(CNY)%s 今日盈亏%s(%s) 总盈亏%s(%s)",
			i+1, h.Name, h.Symbol, catLabel(h.Category), h.Market,
			nf(fxToCNY(v.MarketValue, h.Currency, cnyRate, hkdRate)),
			sf(fxToCNY(v.DayPnl, h.Currency, cnyRate, hkdRate)), pf(v.DayPnlPct),
			sf(fxToCNY(v.Pnl, h.Currency, cnyRate, hkdRate)), pf(v.PnlPct))
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
	var lTotal float64
	b.WriteString("\n【负债】\n")
	if len(libs) == 0 {
		b.WriteString("（暂无负债）\n")
	}
	for i, l := range libs {
		lTotal += fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
		cur := strings.ToLower(strings.TrimSpace(l.Currency))
		var owe string
		if cur == "usd" || cur == "hkd" {
			owe = fmt.Sprintf("%s%s（≈¥%s CNY）", curSymbol(l.Currency), nf(l.Amount), nf(fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)))
		} else {
			owe = "欠款(CNY)" + nf(l.Amount)
		}
		// 负债 type 自 2026-10-16 起不再写入（统一表单移除类型字段），存量数据可能仍带值；
		// 为空时只显示来源，避免出现（来源/）空括号
		var srcPart string
		if strings.TrimSpace(l.Type) != "" {
			srcPart = fmt.Sprintf("（%s/%s）", srcName[l.SourceID], l.Type)
		} else {
			srcPart = fmt.Sprintf("（%s）", srcName[l.SourceID])
		}
		line := fmt.Sprintf("%d. %s%s%s",
			i+1, l.Name, srcPart, owe)
		b.WriteString(line + "\n")
	}
	b.WriteString("负债合计(CNY)：" + nf(lTotal) + "\n")

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
