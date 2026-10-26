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
	SourceName   string  `json:"source_name"`  // 所属平台/来源名称（来自 asset_sources）
	RealizedPnl  float64 `json:"realized_pnl"` // 累计已实现盈亏（position_tx 聚合，含 SELL/DIV）
	ClosedDate   string  `json:"closed_date"`  // 清仓日期（最后一次 SELL 的日期，YYYY-MM-DD；未清仓为空）
	InvestedCost float64 `json:"invested_cost"` // 累计买入成本（BUY 金额之和；清仓后 quantity=0 致 cost_value 归零，供已平仓盈亏率分母）
}

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

func enrich(h db.Holding, userID int64) HoldingView {
	// 币种归一化：历史数据存在 'usd'/'USD'、'rmb'/'CNY' 混写（录入/编辑路径不一），
	// 统一按小写规范输出（cny/usd/hkd，人民币含存量 rmb 一并归一 cny）。
	// 前端 toRmb/renderSummary 等比较均大小写不敏感，严格比较处也按小写规范对齐。
	h.Currency = strings.ToLower(strings.TrimSpace(h.Currency))
	if h.Currency == "rmb" {
		h.Currency = "cny"
	}
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
	// 首日（买入日=今天）：当日盈亏基准是买入成本而非昨收。买入前那段涨跌（现价-昨收）
	// 与持有人无关，券商口径为 (现价-成本)×份额；次日恢复昨收口径。
	// 美股跨时区下该判据依然成立：北京时间当天买入（=美东前一交易日盘中）后，
	// 当天早上 7 点的快照夜恰好是买入所属交易日，昨收还是买入前一日收盘价。
	if h.BuyDate == today {
		dayPnl = (h.CurrentPrice - h.CostPrice) * h.Quantity
		if costMv := h.CostPrice * h.Quantity; costMv > 0 {
			dayPnlPct = dayPnl / costMv * 100
		}
	} else if h.PrevClose > 0 {
		dayPnl = (h.CurrentPrice - h.PrevClose) * h.Quantity
		if prevMv := h.PrevClose * h.Quantity; prevMv > 0 {
			dayPnlPct = dayPnl / prevMv * 100
		}
	} else if prev, ok, _ := db.GetPrevClose(h.Symbol, today, userID); ok {
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
	// 常规精度：金额/盈亏保留 2 位，避免浮点长小数进入 API/导出/AI 文本
	return HoldingView{Holding: h,
		MarketValue: round2(mv), CostValue: round2(cv), Pnl: round2(pnl), PnlPct: round2(pct),
		DayPnl: round2(dayPnl), DayPnlPct: round2(dayPnlPct), HoldingDays: db.CalcHoldingDays(h.BuyDate)}
}

func RegisterRoutes(r *gin.Engine) {
	g := r.Group("/api")
	{
		// 多用户：用户列表/新增/删除/统计/清空
		g.GET("/users", listUsers)
		g.POST("/users", createUserHandler)
		g.DELETE("/users/:id", deleteUserHandler)
		g.GET("/users/:id/stats", userStats)
		g.POST("/users/:id/clear", clearUserHandler)

		// 证券联想：名称/代码模糊匹配（添加/编辑持仓弹框的自动填充数据源）
		g.GET("/search", searchSecuritiesHandler)

		g.GET("/holdings", listHoldings)
		g.POST("/holdings", createHolding)
		g.PUT("/holdings/:id", updateHolding)
		g.DELETE("/holdings/:id", deleteHolding)
		g.GET("/holdings/:id/analysis", getAnalysis)
		g.POST("/refresh", refresh)
		g.POST("/holdings/:id/adjust", adjustHolding)
		g.POST("/holdings/:id/dividend", dividendHolding)
		g.GET("/holdings/:id/transactions", listTransactions)
		g.POST("/holdings/:id/transactions/:txid/revert", revertTransaction)
		g.POST("/holdings/:id/reopen", reopenHolding)
		// 基金定投：计划（周期/金额/限购/暂停）+ 期次记录（逐期确认、可改可撤）
		g.GET("/dca/plans", listDCAPlans)
		g.POST("/dca/plans", createDCAPlan)
		g.PUT("/dca/plans/:id", updateDCAPlan)
		g.DELETE("/dca/plans/:id", deleteDCAPlan)
		g.POST("/dca/plans/:id/status", setDCAStatus)
		g.GET("/dca/plans/:id/records", listDCARecords)
		g.POST("/dca/records/:id/execute", executeDCARecord)
		g.PUT("/dca/records/:id", modifyDCARecord)
		g.POST("/dca/records/:id/skip", skipDCARecord)
		g.POST("/dca/records/:id/revert", revertDCARecord)
		g.DELETE("/dca/records/:id", deleteDCARecord)

		g.GET("/home", home)
		g.GET("/rate", rate)
		g.GET("/fx", fxInfo)
		g.POST("/pnl/snapshot", snapshotHandler)
		g.GET("/pnl/history", pnlHistory)
		g.GET("/holdings/:id/pnl-history", holdingPnlHistory)

		// 已平仓视图：手动补录的平仓记录（纯记录，不入账）+ 系统记录「回退（撤销清仓/重开）」
		g.GET("/manual-closed", listManualClosed)
		g.POST("/manual-closed", createManualClosed)
		g.PUT("/manual-closed/:id", updateManualClosed)
		g.DELETE("/manual-closed/:id", deleteManualClosed)
		g.GET("/ai/settings", aiSettingsGet)
		g.POST("/ai/settings", aiSettingsPost)
		g.GET("/mcp/config", mcpConfigGet)
		g.PUT("/mcp/config", mcpConfigPut)
		g.GET("/mcp/status", mcpConfigStatus)
		g.POST("/mcp/restart", mcpConfigRestart)
		g.POST("/ai/summary", aiSummary)
		g.GET("/ai/data", aiData)

		// 内置 AI 助手（右下角悬浮聊天面板）：会话 CRUD + 工具调用式对话
		g.GET("/ai/chats", aiChatsList)
		g.POST("/ai/chats", aiChatCreate)
		g.GET("/ai/chats/:id", aiChatGet)
		g.PUT("/ai/chats/:id", aiChatRename)
		g.DELETE("/ai/chats/:id", aiChatDelete)
		g.POST("/ai/chat", aiChatPost)

		// 通知渠道：配置读写 + 测试发送
		g.GET("/version", versionGet)
		g.GET("/notify/settings", notifySettingsGet)
		g.POST("/notify/settings", notifySettingsPost)
		g.POST("/notify/test", notifyTest)

		// 数据导入（格式与「导出数据」一致）
		g.POST("/import", importData)

		// 资产全景：来源 / 理财 / 负债 / 汇总 / AI 总结
		g.GET("/asset/overview", assetOverview)
		g.GET("/asset/sources", listSources)
		g.POST("/asset/sources", createSource)
		g.PUT("/asset/sources/:id", updateSource)
		g.DELETE("/asset/sources/:id", deleteSource)
		g.GET("/asset/wealth", listWealth)
		g.POST("/asset/wealth", createWealth)
		g.PUT("/asset/wealth/:id", updateWealth)
		g.DELETE("/asset/wealth/:id", deleteWealth)
		g.POST("/asset/wealth/:id/enable", enableWealth)
		g.POST("/asset/wealth/:id/clear", clearWealth)
		g.POST("/asset/wealth/:id/reduce", reduceWealth)
		g.POST("/asset/wealth/:id/nav", updateWealthNav)
		g.POST("/asset/wealth/nav/refresh", refreshWealthNavBatch)
		g.POST("/asset/wealth/snapshots", assetWealthSnapshotsPost)
		g.DELETE("/asset/wealth/snapshots", assetWealthSnapshotDelete)
		g.POST("/asset/wealth/snapshots/undo", assetWealthSnapshotUndo)
		g.GET("/asset/wealth/:id/audit", assetWealthAuditList)
		g.GET("/asset/wealth/:id/history", assetWealthHistory)
		g.GET("/asset/cash", listCash)
		g.GET("/asset/cash/:id/flows", listCashFlows)
		g.POST("/asset/cash", createCash)
		g.POST("/asset/cash/adjust", adjustCash)
		g.POST("/asset/cash/repay-liability", repayLiability)
		g.POST("/asset/balance/sync", balanceSync)
		g.POST("/asset/cash/transfer", transferCash)
		g.PUT("/asset/cash/:id", updateCash)
		g.DELETE("/asset/cash/:id", deleteCash)
		g.GET("/asset/liabilities", listLiabilities)
		g.POST("/asset/liabilities", createLiability)
		g.PUT("/asset/liabilities/:id", updateLiability)
		g.DELETE("/asset/liabilities/:id", deleteLiability)
		g.GET("/asset/liabilities/:id/flows", liabilityFlows)
		// 存款（定期存款 / 大额存单）：新增扣款、到期确认落袋后才入账利息
		g.GET("/asset/deposits", listDeposits)
		g.POST("/asset/deposits", createDeposit)
		g.PUT("/asset/deposits/:id", updateDeposit)
		g.DELETE("/asset/deposits/:id", deleteDeposit)
		g.POST("/asset/deposits/:id/settle", settleDeposit)
		// 统一账户表单：子账户 ⇄ 负债 换性质（无流水、无引用时才允许）
		g.POST("/asset/accounts/convert", convertAccount)

		// 月度待入账 / 待还款计划：首页紧凑卡片 + 资产全景编辑入口 + 待还款定时提醒
		g.GET("/cashflow/plans", listCashflowPlans)
		g.POST("/cashflow/plans", createCashflowPlan)
		g.PUT("/cashflow/plans/:id", updateCashflowPlan)
		g.DELETE("/cashflow/plans/:id", deleteCashflowPlan)
		g.POST("/cashflow/plans/:id/complete", completeCashflowPlan)
		g.POST("/cashflow/plans/:id/uncomplete", uncompleteCashflowPlan)
		g.GET("/asset/flows", listFlows)
		g.GET("/finance/summary", financeSummary)
		g.PUT("/asset/flows/:kind/:id", updateFlow)
		g.DELETE("/asset/flows/:kind/:id", deleteFlow)
		g.POST("/asset/flows/:kind/:id/rollback", rollbackFlow)
		g.POST("/asset/summary", assetSummary)

		// 设置：风险偏好 / 资产类型标签（JSON 配置，按用户隔离）
		g.GET("/settings/:kind", settingsGet)
		g.PUT("/settings/:kind", settingsPut)
		g.DELETE("/settings/:kind", settingsDelete)

		// 自定义评级脚本（资产工具 → 评级逻辑）
	}
}

// currentUserID 从请求头 X-User-Id 解析当前用户；缺失或非数字时回退到首个用户。
func currentUserID(c *gin.Context) int64 {
	raw := strings.TrimSpace(c.GetHeader("X-User-Id"))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		if us, e := db.ListUsers(); e == nil && len(us) > 0 {
			return us[0].ID
		}
		return 0
	}
	return id
}

// allUsers returns every user. On error it logs and returns nil so scheduled
// jobs simply skip their work rather than crash the server.
func allUsers() []db.User {
	us, err := db.ListUsers()
	if err != nil {
		log.Printf("[users] 列举用户失败: %v", err)
		return nil
	}
	return us
}

// ---- 多用户管理 ----

func listUsers(c *gin.Context) {
	users, err := db.ListUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func createUserHandler(c *gin.Context) {
	var b struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&b); err != nil || strings.TrimSpace(b.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名不能为空"})
		return
	}
	name := strings.TrimSpace(b.Name)
	if id, err := db.CreateUser(name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	} else {
		c.JSON(http.StatusOK, gin.H{"id": id, "name": name})
	}
}

func deleteUserHandler(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteUser(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func userStats(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	stats, err := db.CountUserData(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func clearUserHandler(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.ClearUserData(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// computeHoldings builds the enriched holdings list plus the helper fields the
// client needs for the first screen. Split out of listHoldings so the merged
// /api/home endpoint can reuse it without duplicating the logic.
func computeHoldings(uid int64) ([]HoldingView, string, string, string, error) {
	hs, err := db.List(uid)
	if err != nil {
		return nil, "", "", "", err
	}

	// 批量聚合每个 holding 的已实现盈亏（SELL/DIV 累计 realized_pnl），一次查询搞定。
	ids := make([]int64, 0, len(hs))
	for _, h := range hs {
		ids = append(ids, h.ID)
	}
	realizedMap, _ := db.BatchSumRealizedPnl(uid, ids)
	closeDateMap, _ := db.BatchLastSellDate(uid, ids)
	investMap, _ := db.BatchInvestedCost(uid, ids)

	out := make([]HoldingView, 0, len(hs))
	srcName := map[int64]string{}
	if srcs, e := db.ListSources(uid); e == nil {
		for _, s := range srcs {
			srcName[s.ID] = s.Name
		}
	}
	for _, h := range hs {
		v := enrich(h, uid)
		v.SourceName = srcName[h.SourceID]
		v.RealizedPnl = realizedMap[h.ID]
		v.ClosedDate = closeDateMap[h.ID]
		v.InvestedCost = investMap[h.ID]
		out = append(out, v)
	}
	return out,
		time.Now().Format("2006-01-02"),
		latestSnapshotDate(uid),
		maxUpdatedAt(hs),
		nil
}

func listHoldings(c *gin.Context) {
	uid := currentUserID(c)
	out, day, snap, upd, err := computeHoldings(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"holdings":       out,
		"day_date":       day,
		"snapshot_date":  snap,
		"updated_at_max": upd,
	})
}

// searchSecuritiesHandler 处理 GET /api/search?q=，供添加/编辑持仓弹框做名称/代码联想。
// 联想失败（网络/上游异常）时返回空结果而非 5xx，避免打断弹框输入体验。
func searchSecuritiesHandler(c *gin.Context) {
	q := c.Query("q")
	results, err := market.SearchSecurities(q)
	if err != nil || results == nil {
		c.JSON(http.StatusOK, gin.H{"results": []market.SearchResult{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

// maxUpdatedAt returns the most recent holdings.updated_at across the slice
// (format "2006-01-02 15:04:05"), or "" when none is set.
func maxUpdatedAt(hs []db.Holding) string {
	var max time.Time
	has := false
	for _, h := range hs {
		if h.UpdatedAt == "" {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02 15:04:05", h.UpdatedAt, time.Local)
		if err != nil {
			continue
		}
		if !has || t.After(max) {
			max = t
			has = true
		}
	}
	if !has {
		return ""
	}
	return max.Format("2006-01-02 15:04:05")
}

// latestSnapshotDate returns the date of the most recent daily P&L snapshot
// (pnl_daily) for a user, falling back to today when none exists yet.
func latestSnapshotDate(uid int64) string {
	if row, err := db.GetPnlLatest(uid); err == nil && row != nil {
		return row.Date
	}
	return time.Now().Format("2006-01-02")
}

func createHolding(c *gin.Context) {
	var req struct {
		db.Holding
		CashAccountID int64 `json:"cash_account_id"` // 新建持仓的出资子账户；扣款 = quantity * cost_price + transaction_cost
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	h := req.Holding
	uid := currentUserID(c)
	h.UserID = uid
	normalize(&h)
	if exists, e := db.ExistsBySymbol(h.Symbol, 0, uid); e == nil && exists {
		c.JSON(http.StatusConflict, gin.H{"error": "该代码已存在，请勿重复添加"})
		return
	}
	id, err := db.Create(&h)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.ID = id
	// 新建持仓：自动从所选子账户扣 (quantity * cost_price + transaction_cost)。
	// 与加减仓 applyCashForAdjust 同一套资金联动逻辑；cash_account_id 由前端传入，0 则回落来源默认子账户。
	cost := h.Quantity*h.CostPrice + h.TransactionCost
	if cost > 0 && req.CashAccountID >= 0 {
		if accID, ce := applyCashForAdjust(uid, h, "BUY", h.Quantity, h.CostPrice, h.TransactionCost, req.CashAccountID, "新建持仓"); ce != nil {
			log.Printf("[createHolding] 新建持仓现金联动失败(uid=%d hid=%d): %v", uid, id, ce)
		} else if accID > 0 {
			if txID, le := db.LatestPositionTxID(id); le == nil {
				_ = db.SetTxCashAccount(txID, accID)
			}
		}
	}
	v := enrich(h, uid)
	// 单条返回也补全来源名称（enrich 本身不含来源解析；列表接口 listHoldings 已补全）。
	if srcs, e := db.ListSources(uid); e == nil {
		m := map[int64]string{}
		for _, s := range srcs {
			m[s.ID] = s.Name
		}
		v.SourceName = m[h.SourceID]
	}
	c.JSON(http.StatusOK, gin.H{"holding": v})
}

func updateHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var req struct {
		db.Holding
		CashAccountID int64 `json:"cash_account_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	h := req.Holding
		h.ID = id
		uid := currentUserID(c)
		// 编辑时表单不回传 buy_plan / user_id：先取旧行保留，避免保存时被清空（#修复：编辑持仓导致所属用户被重置为 0、从当前用户列表消失）
		ex, e := db.Get(id)
		if e == nil {
			h.BuyPlan = ex.BuyPlan
			// 取旧值用于资金联动对比：仅当新旧总成本变化 ≥ 0.01 时才联动（避免误改名字/代码时触发）
			oldCost := ex.Quantity*ex.CostPrice + ex.TransactionCost
			newCost := h.Quantity*h.CostPrice + h.TransactionCost
			diff := newCost - oldCost
			if math.Abs(diff) >= 0.01 && req.CashAccountID >= 0 {
				acc, accErr := resolveCashAccount(uid, req.CashAccountID, h.SourceID, h.Currency)
				if accErr == nil {
					flowType, label := "holding_edit_add", "编辑追补资金"
					delta := -diff // diff>0 追补=扣款（负）；diff<0 调减=回款（正）
					if diff < 0 {
						flowType, label = "holding_edit_reduce", "编辑调减资金"
						delta = -diff // diff 为负 → delta 为正（入账）
					}
					detail := fmt.Sprintf("%s %s｜旧成本 %.2f → 新成本 %.2f｜差额 %+.2f", label, h.Name, oldCost, newCost, -diff)
					if e2 := db.AddCashAmount(acc.ID, delta, flowType, "holding", h.ID, h.Name, detail); e2 != nil {
						log.Printf("[updateHolding] 编辑持仓现金联动失败(uid=%d hid=%d): %v", uid, id, e2)
					}
				}
			}
		}
	h.UserID = uid
	normalize(&h)
	if exists, e := db.ExistsBySymbol(h.Symbol, id, currentUserID(c)); e == nil && exists {
		c.JSON(http.StatusConflict, gin.H{"error": "该代码已存在，请勿与其他持仓重复"})
		return
	}
	if err := db.Update(&h); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	v := enrich(h, uid)
	if srcs, e := db.ListSources(uid); e == nil {
		m := map[int64]string{}
		for _, s := range srcs {
			m[s.ID] = s.Name
		}
		v.SourceName = m[h.SourceID]
	}
	c.JSON(http.StatusOK, gin.H{"holding": v})
}

func deleteHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	// 持仓删除后其定投计划/期次一并清理（持仓已不存在，保留只会成为悬空数据）
	_ = db.DeleteDCAPlansByHolding(id)
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
		Type          string  `json:"type"`
		Quantity      float64 `json:"quantity"`
		Price         float64 `json:"price"`
		Fee           float64 `json:"fee"`
		Note          string  `json:"note"`
		Date          string  `json:"date"` // 交易日期（YYYY-MM-DD 可回填历史）；为空则取当前时间
		CashAccountID int64   `json:"cash_account_id"` // 资金往来账户：加仓付款 / 减仓回款；为空则回落到该来源的默认现金账户
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	h, realized, err := db.AdjustHolding(id, req.Type, req.Quantity, req.Price, req.Fee, strings.TrimSpace(req.Note), strings.TrimSpace(req.Date))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid := currentUserID(c)
	// 减仓（SELL）：将实现盈亏落库到当日盈亏（回款入账统一走 applyCashForAdjust）。
	if req.Type == "SELL" {
		today := time.Now().Format("2006-01-02")
		if realized < -1e-9 || realized > 1e-9 {
			if txID, le := db.LatestPositionTxID(id); le == nil {
				if e := db.RecordRealizedPnl(uid, today, id, h.Symbol, h.Name, h.Currency, realized, txID); e != nil {
					log.Printf("[adjust] 记录已实现盈亏失败(uid=%d hid=%d): %v", uid, id, e)
				}
			}
		}
		// 立即将已实现盈亏并入当日盈亏（非交易日 doSnapshot 会提前返回，已实现盈亏仍保留在 ledger，下一交易日合并）
		if e := doSnapshot(uid); e != nil {
			log.Printf("[adjust] 重算当日盈亏失败(uid=%d): %v", uid, e)
		}
	}
	// 现金联动：加仓（BUY）从所选账户扣款，减仓（SELL）回款入账到所选账户。
	if accID, ce := applyCashForAdjust(uid, *h, req.Type, req.Quantity, req.Price, req.Fee, req.CashAccountID, req.Note); ce != nil {
		log.Printf("[adjust] 现金联动失败(uid=%d hid=%d): %v", uid, id, ce)
	} else if accID > 0 {
		// 回填联动账户，供回退时冲正到同一账户
		if txID, le := db.LatestPositionTxID(id); le == nil {
			_ = db.SetTxCashAccount(txID, accID)
		}
	}
	realizedTotal, _ := db.SumRealizedPnl(id)
	c.JSON(http.StatusOK, gin.H{
		"holding":        enrich(*h, currentUserID(c)),
		"realized_pnl":   realized,
		"realized_total": realizedTotal,
	})
}

// dividendHolding 记一次现金分红：份额不变、成本价按每股分红下调（除息摊薄），
// 分红金额入账到所选（或默认 ★）现金账户并写流水；DIV 记录进 position_tx 留痕。
// 两种录入方式（前端小胶囊切换）：
//   mode=per_share  只给 per_share，总额 = 每股 × 份额（A股/港股按股派息）
//   mode=total      给 total_amount，按 总额÷份额 反推每股后一次性摊薄（账单只给累计总额时用）
// fee（代扣税/手续费等）单独记一笔 fee 流水，position_tx.fee 留痕；成本按税前摊薄，不扣 fee。
func dividendHolding(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var req struct {
		PerShare      float64 `json:"per_share"`       // 每股分红（税前口径，用于摊薄成本）；mode=total 时忽略
		TotalAmount   float64 `json:"total_amount"`    // 分红总额（一次摊薄）；mode=total 时必填 >0
		Mode          string  `json:"mode"`            // per_share（默认）| total
		Fee           float64 `json:"fee"`             // 扣除的费用（代扣税/手续费），单独记一笔费用流水
		CashAccountID int64   `json:"cash_account_id"` // 分红入账账户；为空则回落到该来源的默认现金账户
		Date          string  `json:"date"`            // 分红日期（YYYY-MM-DD 可回填历史）；为空则取当前时间
		Method        string  `json:"method"`          // cash（默认，现金分红）| reinvest（红利再投：增加份额、不出现金）
		Note          string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if req.Fee < 0 {
		req.Fee = 0
	}
	uid := currentUserID(c)
	// mode=total：由总额反推每股（先取持仓校验，避免除以 0）
	perShare := req.PerShare
	if strings.TrimSpace(req.Mode) == "total" {
		cur, gErr := db.Get(id)
		if gErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": gErr.Error()})
			return
		}
		if req.TotalAmount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请输入大于 0 的分红总额"})
			return
		}
		if cur.Quantity <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "空仓/观察仓（份额为 0）没有分红，请先建仓"})
			return
		}
		perShare = req.TotalAmount / cur.Quantity
	}
	h, total, err := db.AdjustDividend(id, perShare, req.Fee, strings.TrimSpace(req.Note), strings.TrimSpace(req.Date), strings.TrimSpace(req.Method))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 现金联动：分红入账（失败不阻断——成本已摊薄，流水缺失可手工对账，与加减仓联动同风格）
	// 红利再投（reinvest）不出现金，跳过整块现金入账逻辑。
	netCash := total
	if strings.TrimSpace(req.Method) == "reinvest" {
		netCash = 0
	} else if acc, accErr := resolveCashAccount(uid, req.CashAccountID, h.SourceID, h.Currency); accErr != nil {
		log.Printf("[dividend] 解析现金账户失败(uid=%d hid=%d): %v", uid, id, accErr)
	} else {
		// 回填联动账户，供回退时冲正到同一账户
		if txID, le := db.LatestPositionTxID(id); le == nil {
			_ = db.SetTxCashAccount(txID, acc.ID)
		}
		modeTag := ""
		if strings.TrimSpace(req.Mode) == "total" {
			modeTag = "｜按总额录入"
		}
		detail := fmt.Sprintf("分红入账 %s %s｜每股 %g｜份额 %g%s", h.Name, h.Symbol, perShare, h.Quantity, modeTag)
		if req.Fee > 0 {
			detail += fmt.Sprintf("｜费用 %g", req.Fee)
		}
		if s := strings.TrimSpace(req.Note); s != "" {
			detail += "｜" + s
		}
		if e := db.AddCashAmount(acc.ID, total, "dividend", "holding", h.ID, h.Name, detail); e != nil {
			log.Printf("[dividend] 现金入账失败(uid=%d hid=%d): %v", uid, id, e)
		} else if req.Fee > 0 {
			// 费用单独记一笔「费用」流水（负数出账），与分红入账成对可见
			feeDetail := fmt.Sprintf("分红费用 %s %s｜代扣税/手续费", h.Name, h.Symbol)
			if s := strings.TrimSpace(req.Note); s != "" {
				feeDetail += "｜" + s
			}
			if e := db.AddCashAmount(acc.ID, -req.Fee, "fee", "holding", h.ID, h.Name, feeDetail); e != nil {
				log.Printf("[dividend] 费用流水写入失败(uid=%d hid=%d): %v", uid, id, e)
			}
			netCash = round2(total - req.Fee)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"holding":        enrich(*h, uid),
		"dividend_total": total,
		"fee":            req.Fee,
		"net_cash":       netCash,
		"new_cost_price": h.CostPrice,
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

// revertTransaction 回退一笔持仓交易（加仓/减仓/分红）。仅允许回退最新一笔（LIFO），
// 对称还原持仓数量/成本价、资金账户余额与已实现盈亏台账，原交易保留并标记 reverted（审计）。
func revertTransaction(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	txID, err := strconv.ParseInt(c.Param("txid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad txid"})
		return
	}
	uid := currentUserID(c)
	if err := db.RevertHoldingTx(id, txID, uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// 重算当日盈亏（SELL 回退已撤销已实现盈亏台账，需并入快照）
	if e := doSnapshot(uid); e != nil {
		log.Printf("[revert] 重算当日盈亏失败(uid=%d hid=%d): %v", uid, id, e)
	}
	h, gErr := db.Get(id)
	if gErr != nil || h == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "holding": enrich(*h, uid)})
}

// applyCashForAdjust 把一次加仓/减仓的资金变动落到现金账户（并写一条流水）：
//   加仓 BUY ：从账户扣款  数量×价格 + 费用
//   减仓 SELL：回款入账    数量×价格 − 费用
// 未指定账户时回落到该持仓所属来源的默认现金账户（★ 账户，不存在则自动创建）。
// 注意：减仓不再自动生成「XX 减仓回款」现金条目，改为并入账户余额 + 记流水。
// 返回实际联动的现金账户 id（供回退时冲正到同一账户；无资金变动时返回 0）。
func applyCashForAdjust(uid int64, h db.Holding, typ string, qty, price, fee float64, cashID int64, note string) (int64, error) {
	typ = strings.ToUpper(strings.TrimSpace(typ))
	var delta float64
	var flowType, label string
	switch typ {
	case "BUY":
		cost := qty*price + fee
		if cost <= 0 {
			return 0, nil
		}
		delta, flowType, label = -cost, "adjust_buy", "加仓付款"
	case "SELL":
		proceeds := qty*price - fee
		if proceeds <= 0 {
			return 0, nil
		}
		delta, flowType, label = proceeds, "adjust_sell", "减仓回款"
	default:
		return 0, nil
	}
	acc, err := resolveCashAccount(uid, cashID, h.SourceID, h.Currency)
	if err != nil {
		return 0, err
	}
	detail := fmt.Sprintf("%s %s %s｜数量 %g｜价 %g｜费 %g", label, h.Name, h.Symbol, qty, price, fee)
	if s := strings.TrimSpace(note); s != "" {
		detail += "｜" + s
	}
	if e := db.AddCashAmount(acc.ID, delta, flowType, "holding", h.ID, h.Name, detail); e != nil {
		return 0, e
	}
	return acc.ID, nil
}

// resolveCashAccount 返回本次资金变动使用的现金账户：显式指定优先（并校验归属当前用户、来源一致），
// 否则取该来源（sourceID>0）或该用户全部（收支计划，sourceID=0）同币种中余额最大的子账户；
// 仍没有且来源明确时，按币种现场补建一个落点账户（2026-10-16 起无「默认子账户」概念）。
func resolveCashAccount(uid, cashID, sourceID int64, currency string) (*db.Cash, error) {
	if cashID > 0 {
		acc, err := db.GetCash(cashID)
		if err != nil {
			return nil, err
		}
		if acc == nil || acc.UserID != uid {
			return nil, fmt.Errorf("子账户不存在或不属于当前用户（id=%d）", cashID)
		}
		// 资金只能来自与持仓/理财相同来源的现金账户（跨来源账户拒绝，防止资金链路串源）
		if sourceID > 0 && acc.SourceID != sourceID {
			return nil, fmt.Errorf("子账户与该持仓/理财所属账户不一致，只能选择同一账户下的子账户")
		}
		return acc, nil
	}
	if acc, err := db.PickCashAccount(uid, sourceID, currency); err == nil && acc != nil {
		return acc, nil
	}
	// sourceID=0（收支计划等不挂来源的场景）不现场补建——补出来也是无主账户，直接报错引导用户先建
	if sourceID <= 0 {
		return nil, fmt.Errorf("没有可用的 %s 子账户，请先在「账户」中添加该币种的子账户", strings.ToUpper(db.NormCurrency(currency)))
	}
	id, err := db.EnsureCashForCurrency(uid, sourceID, "", currency)
	if err != nil {
		return nil, err
	}
	if id <= 0 {
		return nil, fmt.Errorf("找不到可用的现金子账户（source=%d currency=%s）", sourceID, currency)
	}
	acc, err := db.GetCash(id)
	if err != nil {
		return nil, err
	}
	if acc == nil {
		return nil, fmt.Errorf("现金子账户创建失败（source=%d）", sourceID)
	}
	return acc, nil
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
	// 市场合法性：基金不再手选细分市场（前端自动识别后留空，由行情/关联代码决定），故基金市场允许为空、不做强制；
	// 股票仅认可 沪深/美股/港股，其它兜底为 沪深。
	if h.Category != "fund" {
		switch h.Market {
		case "沪深", "美股", "港股":
		default:
			h.Market = "沪深"
		}
	}
}

func refresh(c *gin.Context) {
	uid := currentUserID(c)
	hs, failed, err := refreshAllQuotes(uid)
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
	srcName := map[int64]string{}
	if srcs, e := db.ListSources(uid); e == nil {
		for _, s := range srcs {
			srcName[s.ID] = s.Name
		}
	}
	rids := make([]int64, 0, len(hs))
	for _, h := range hs {
		rids = append(rids, h.ID)
	}
	closeDateMap, _ := db.BatchLastSellDate(uid, rids)
	investMap, _ := db.BatchInvestedCost(uid, rids)
	for _, h := range hs {
		v := enrich(h, uid)
		v.SourceName = srcName[h.SourceID]
		v.ClosedDate = closeDateMap[h.ID]
		v.InvestedCost = investMap[h.ID]
		out = append(out, v)
	}
	_ = doSnapshot(uid)
	NotifyNetValueUpdated(uid, "手动刷新行情", "")
	c.JSON(http.StatusOK, gin.H{"holdings": out, "rate": rate, "rate_degraded": degraded, "rate_error": rateErr, "failed": failed, "updated_at_max": maxUpdatedAt(hs)})
}

// refreshOne 已移除：单只持仓手动刷新逻辑取消，行情改由定时快照（refreshAllQuotes）自动更新。
// 批量刷新 /api/refresh 与定时快照仍复用 refreshAllQuotes。


func rate(c *gin.Context) {
	r, degraded := market.GetUSDRate()
	c.JSON(http.StatusOK, gin.H{"rate": r, "rate_degraded": degraded})
}

// fxInfo returns the cached USD/HKD/RMB exchange rates and last update time for display.
func fxInfo(c *gin.Context) {
	c.JSON(http.StatusOK, market.GetFXInfo())
}

func computeSummary(uid int64) (gin.H, error) {
	hs, err := db.List(uid)
	if err != nil {
		return nil, err
	}
	cnyRate, hkdRate, degraded := market.GetFXRates()
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
		case "USD":
			usdMV += mv
			usdCV += cv
			usdPnl += pnl
		case "HKD":
			hkdMV += mv
			hkdCV += cv
			hkdPnl += pnl
		default:
			// 未知币种仍按 CNY 计入总额，避免被丢弃；但收集起来返回给
			// 调用方，便于排查，而不是静默错算成 CNY。
			cnyMV += mv
			cnyCV += cv
			cnyPnl += pnl
			unsupported = append(unsupported, fmt.Sprintf("%s(%s)", h.Symbol, h.Currency))
		}
		totalCNY += fxToCNY(mv, h.Currency, cnyRate, hkdRate)
		totalCostCNY += fxToCNY(cv, h.Currency, cnyRate, hkdRate)
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
	// 本月累计盈亏：汇总最近 pnl_daily 中本月（按数据日期）的总盈亏；
	// 同时按币种拆分（解析 detail.by_currency，原始货币口径），供前端列出本月 CNY/USD 盈亏。
	var monthPNL, monthPNLCny, monthPNLUsd float64
	if hist, e := db.GetPnlHistory(uid); e == nil {
		ym := time.Now().Format("2006-01")
		for _, r := range hist {
			if !strings.HasPrefix(r.Date, ym) {
				continue
			}
			monthPNL += r.TotalCNY
			var det struct {
				ByCurrency map[string]float64 `json:"by_currency"`
			}
			if jErr := json.Unmarshal([]byte(r.Detail), &det); jErr == nil && det.ByCurrency != nil {
				monthPNLCny += det.ByCurrency["CNY"]
				monthPNLUsd += det.ByCurrency["USD"]
			}
		}
	}
	// 今日已实现盈亏（减仓落库）：从 realized_pnl_daily 取当日记录，折算 CNY 后返回，
	// 供前端「当日盈亏」卡片并入清仓/减仓收益。持仓已清仓时其 day_pnl 为 0，
	// 若不加这一项，当日清仓的已实现盈亏会漏算在首页「当日盈亏」之外。
	var todayRealizedCNY float64
	type realizedItem struct {
		Symbol   string  `json:"symbol"`
		Name     string  `json:"name"`
		Currency string  `json:"currency"`
		Amount   float64 `json:"amount"`
		Date     string  `json:"date"`
	}
	var realizedToday []realizedItem
	todayStr := time.Now().Format("2006-01-02")
	if rrows, e := db.ListRealizedPnl(uid, todayStr); e == nil {
		for _, rp := range rrows {
			todayRealizedCNY += fxToCNY(rp.Amount, rp.Currency, cnyRate, hkdRate)
			realizedToday = append(realizedToday, realizedItem{
				Symbol: rp.Symbol, Name: rp.Name, Currency: rp.Currency, Amount: rp.Amount, Date: rp.Date,
			})
		}
	}
	return gin.H{
		"today_realized_cny":  round2(todayRealizedCNY),
		"realized_today":      realizedToday,
		"rate":                cnyRate,
		"rate_degraded":       degraded,
		"unsupported_currencies": unsupported,
		"month_pnl_cny":       round2(monthPNL),
		"month_pnl_cny_ccy":   round2(monthPNLCny),
		"month_pnl_usd":       round2(monthPNLUsd),
		"hkd_rate":            fxToCNY(1, "HKD", cnyRate, hkdRate),
		"cny_market_value":    round2(cnyMV),
		"cny_cost_value":      round2(cnyCV),
		"cny_pnl":             round2(cnyPnl),
		"cny_pnl_pct":         round2(cnyPct),
		"usd_market_value":    round2(usdMV),
		"usd_cost_value":      round2(usdCV),
		"usd_pnl":             round2(usdPnl),
		"usd_pnl_pct":         round2(usdPct),
		"usd_market_value_cny": round2(fxToCNY(usdMV, "USD", cnyRate, hkdRate)),
		"hkd_market_value":    round2(hkdMV),
		"hkd_cost_value":      round2(hkdCV),
		"hkd_pnl":             round2(hkdPnl),
		"hkd_pnl_pct":         round2(hkdPct),
		"hkd_market_value_cny": round2(fxToCNY(hkdMV, "HKD", cnyRate, hkdRate)),
		"total_cny":           round2(totalCNY),
		"total_cost_cny":      round2(totalCostCNY),
		"total_pnl":           round2(totalPnl),
		"total_pnl_pct":       round2(totalPct),
	}, nil
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
// runAutoAnalysis performs technical analysis for a holding (if it supports analysis)
// and returns a normalized signal: "buy", "sell", "hold", or "" if not applicable.
// "Supported" mirrors supportsAnalysis: a stock (has symbol) or a fund with a linked_symbol.
// Funds without a linked_symbol cannot be analyzed and return "".
func runAutoAnalysis(h db.Holding) (signal string, upPct float64) {
	if h.Category == "fund" && strings.TrimSpace(h.LinkedSymbol) == "" {
		return "", 0
	}
	symbol := h.Symbol
	if h.Category == "fund" {
		symbol = h.LinkedSymbol // 基金用关联股票做技术分析
	}
	sym := resolveSymbol(symbol, h.Market)
	today := time.Now().Format("2006-01-02")

	// 优先命中当日缓存：避免每次整页刷新都对每个持仓实时抓 K线（多持仓时显著拖慢）。
	// 命中仍需通过新鲜度校验（末根K线落后于期望交易日或超 TTL 则回落到实时抓取）。
	if row, e := db.GetAnalysisCache(sym, today); e == nil && row != nil && analysisCacheFresh(row, h.Market) {
		var prob market.ProbabilityResult
		if e2 := json.Unmarshal([]byte(row.ProbabilityJSON), &prob); e2 == nil && prob.UpPct > 0 {
			upPct = prob.UpPct
			return market.SignalFromUpPct(upPct), upPct
		}
	}

	bars, err := market.FetchKline(sym)
	if err != nil || len(bars) < 30 {
		log.Printf("[autoAnalysis] %s(%s) 跳过：K线获取失败或不足30根", h.Name, symbol)
		return "", 0
	}
	ind := market.CalculateIndicators(bars)
	prob := market.CalculateProbability(ind)
	if prob == nil {
		return "", 0
	}
	upPct = prob.UpPct
	// 回写缓存：供弹框与 AI 分析复用（K线 + 指标 + 概率）；逐日信号与估值已不再计算
	go func() {
		barsJSON, _ := json.Marshal(bars)
		indJSON, _ := json.Marshal(ind)
		probJSON, _ := json.Marshal(prob)
		_ = db.SaveAnalysisCache(sym, today, string(barsJSON), string(indJSON), string(probJSON), "[]", "{}", time.Now().Format("2006-01-02 15:04:05"))
	}()
	return market.SignalFromUpPct(upPct), upPct
}

// autoAnalyzeAndStore 对一只持仓跑自动技术分析并落库（best-effort：网络失败/数据不足仅记日志，不阻断刷新）。
func autoAnalyzeAndStore(h db.Holding) {
	sig, up := runAutoAnalysis(h)
	if sig == "" {
		return
	}
	if err := db.UpdateAnalysis(h.ID, sig, up, time.Now().Format("2006-01-02 15:04:05")); err != nil {
		log.Printf("[autoAnalysis] 落库失败 id=%d: %v", h.ID, err)
	}
}

func refreshAllQuotes(uid int64) ([]db.Holding, []string, error) {
	hs, err := db.List(uid)
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
				autoAnalyzeAndStore(hs[i])
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
				autoAnalyzeAndStore(hs[i])
			} else {
				failed = append(failed, fmt.Sprintf("%s: %s", hs[i].Symbol, e.Error()))
			}
		}
	}
	return hs, failed, nil
}

// doSnapshot records today's closing prices and computes the daily P&L vs the previous
// recorded day. Daily P&L = Σ (today's close − previous close) × quantity, per holding.
// 中国非交易日（周末/法定节假日）不再整体跳过：美股不跟中国假期（2026 国庆 10-01~10-07
// 美股照常交易 5 天，整体 return 导致这 5 天涨跌全部丢失，且 T+1 的 PrevClose 链在长假
// 断档后无法回补），改为仅记录美股；A股/港股/基金无新数据，保持"非交易日不记录"不污染日历。
// 每条持仓的当日盈亏按其类别的"数据就绪时间"分时段计入（见下方 switch）：
//   美股→美东收盘后(T+1)、A股→15:00后、港股→16:00后、基金→21:00后；未到时间记为 0。
func doSnapshot(uid int64) error {
	now := time.Now()
	bj := now.In(time.FixedZone("CST", 8*3600))
	bjHour := bj.Hour()
	usOnly := !isTradingDayCN(now)
	if usOnly {
		log.Printf("[snapshot] %s 中国非交易日，仅记录美股每日盈亏", now.Format("2006-01-02"))
	}
	hs, err := db.List(uid)
	if err != nil {
		return err
	}
	cnyRate, hkdRate, fxDegraded := market.GetFXRates()
	if fxDegraded {
		log.Printf("[snapshot] 汇率源降级，使用上次成功汇率 CNY=%.4f HKD=%.4f", cnyRate, hkdRate)
	}
	today := now.Format("2006-01-02")
	var totalCNY, totalUSD float64
	byCat := map[string]float64{"stock": 0, "fund": 0}
	byCur := map[string]float64{"CNY": 0, "USD": 0, "HKD": 0}
	var bySym []symPnl
	for i := range hs {
		h := hs[i]
		// 非交易日只记美股：其余市场休市无新数据，不写 price_daily / 不算当日盈亏
		// （若照写价格，节后首日 GetPrevClose 会取到假期里的同价记录，兜底口径被污染）。
		if usOnly && h.Market != "美股" {
			continue
		}
		if e := db.SavePriceDaily(today, h.Symbol, h.CurrentPrice, uid); e != nil {
			return e
		}
		// Daily P&L basis must match the holdings list (enrich): prefer the
		// official previous close from the quote feed (h.PrevClose), and only
		// fall back to the last recorded daily close when it is missing. This
		// keeps pnl_daily (consumed by the trend chart & calendar) aligned with
		// the list's real-time daily P&L, and avoids a missed snapshot day
		// silently turning "daily P&L" into a multi-day cumulative figure.
		var dp float64
		// 防重复（全市场通用，2026-09-08 美股 Labor Day 复现）：休市日行情源仍返回上一
		// 已记录收盘的快照（美股/港股独有假期、QDII 净值滞后多日），若 price_daily 最近
		// 一条已记录收盘 == 当前价，说明没有新数据，当日盈亏记 0，避免同一份涨跌被
		// 重复计入（美股同一天 07:00/21:00 两次任务、以及休市跨天都会中招）。
		lastClose, lastOk, lastErr := db.GetPrevClose(h.Symbol, today, uid)
		staleQuote := lastErr == nil && lastOk && lastClose == h.CurrentPrice
		switch {
		case h.BuyDate == today && h.CostPrice > 0:
			// 首日（买入日=今天）：基准是买入成本而非昨收，买入前那段涨跌（现价-昨收）
			// 不计入当日盈亏——与持仓列表 enrich 的首日口径一致（2026-10-23 NVDA 复现：
			// 美东 10-22 盘中买入成本 213，昨收 221.97，误计 -4.4%）。
			dp = (h.CurrentPrice - h.CostPrice) * h.Quantity
		case staleQuote:
			dp = 0
		case h.Market == "美股":
			// 美股 T+1：仅在美东盘中（北京对应时段）把当日盈亏视为 0（盘中浮动不算数）；
			// 收盘后 (现价-昨收) 即最近一个已收盘美股交易日的涨跌，于下一中国交易日体现，
			// 故周五美股（周末凌晨收盘）自然合并进下周一的盈亏。
			if usMarketInSession() {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today, uid); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		case h.Category == "fund":
			// 基金净值一般北京时间 21:00 后公布，此前不计入当日盈亏。
			if bjHour < 21 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today, uid); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		case h.Market == "港股":
			// 港股 16:00 收盘，此前不计入当日盈亏。
			if bjHour < 16 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today, uid); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		default:
			// A股及其他股票 15:00 收盘，此前不计入当日盈亏。
			if bjHour < 15 {
				dp = 0
			} else if h.PrevClose > 0 {
				dp = (h.CurrentPrice - h.PrevClose) * h.Quantity
			} else if prev, ok2, e2 := db.GetPrevClose(h.Symbol, today, uid); e2 == nil && ok2 {
				dp = (h.CurrentPrice - prev) * h.Quantity
			}
		}
		byCat[h.Category] += dp
		byCur[h.Currency] += dp
		if strings.EqualFold(h.Currency, "USD") {
			totalUSD += dp
		}
		dpCNY := fxToCNY(dp, h.Currency, cnyRate, hkdRate)
		totalCNY += dpCNY
		// 涨跌幅：现价相对昨收，昨收优先持仓字段，兜底查历史
		chgPct := 0.0
		prevClose := h.PrevClose
		if prevClose <= 0 {
			if p, ok2, e2 := db.GetPrevClose(h.Symbol, today, uid); e2 == nil && ok2 {
				prevClose = p
			}
		}
		if prevClose > 0 {
			chgPct = (h.CurrentPrice - prevClose) / prevClose * 100
		}
		// 已清仓（份额为 0）的持仓不再计入 by_symbol 明细：其浮动盈亏恒为 0，
		// 且落袋盈亏已由下方「·已实现」条目表达，避免推送/日历出现「现价有值、当日¥0.00」的重复冗余行。
		if h.Quantity <= 0 {
			continue
		}
		bySym = append(bySym, symPnl{Symbol: h.Symbol, Name: h.Name, Pnl: round2(dp), PnlCNY: round2(dpCNY), Currency: h.Currency, CurrentPrice: round4(h.CurrentPrice), ChangePct: round2(chgPct)})
	}
	// 合并当日已实现盈亏（减仓落库）：从 realized_pnl_daily 取当日记录，叠加到总盈亏与明细。
	// 由于 doSnapshot 每次整体重算价格盈亏并重新取该表，这里天然幂等、不会被覆盖。
	if rrows, e := db.ListRealizedPnl(uid, today); e == nil {
		for _, rp := range rrows {
			if strings.EqualFold(rp.Currency, "USD") {
				totalUSD += rp.Amount
			}
			dpCNY := fxToCNY(rp.Amount, rp.Currency, cnyRate, hkdRate)
			totalCNY += dpCNY
			byCur[rp.Currency] += rp.Amount
			bySym = append(bySym, symPnl{Symbol: rp.Symbol, Name: rp.Name + "·已实现", Pnl: round2(rp.Amount), PnlCNY: round2(dpCNY), Currency: rp.Currency, ChangePct: 0})
		}
	}
	detail := fmt.Sprintf(`{"by_category":{"stock":%.2f,"fund":%.2f},"by_currency":{"CNY":%.2f,"USD":%.2f,"HKD":%.2f},"by_symbol":%s}`,
		byCat["stock"], byCat["fund"], byCur["CNY"], byCur["USD"], byCur["HKD"], mustJSON(bySym))
	// 真实日收益率分母：当日净资产基数 = 持仓市值 + 理财市值 + 现金 − 负债（折算 CNY）。
	// 盈亏日历/走势切换"盈亏率"时用 当日盈亏 / base_cny 计算，而非对金额做归一化。
	baseCNY := computeEquityBaseCNY(uid, hs, cnyRate, hkdRate)
	return db.SavePnlDaily(today, round2(totalCNY), round2(totalUSD), cnyRate, round2(baseCNY), detail, uid)
}

// computeEquityBaseCNY 计算该用户当日净资产基数（CNY），用于真实日收益率：
// 当日收益率 = 当日盈亏(含理财) / 净资产基数。基数 = 持仓市值 + 理财市值 + 现金 − 负债（均折算 CNY）。
func computeEquityBaseCNY(uid int64, hs []db.Holding, cnyRate, hkdRate float64) float64 {
	var base float64
	for _, h := range hs {
		base += fxToCNY(h.CurrentPrice*h.Quantity, h.Currency, cnyRate, hkdRate)
	}
	if wps, e := db.ListWealth(uid); e == nil {
		for _, w := range wps {
			if _, amt, found, _ := db.GetWealthLatest(w.ID); found {
				base += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
			}
		}
	}
	if cashs, e := db.ListCash(uid); e == nil {
		for _, cc := range cashs {
			base += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
		}
	}
	if libs, e := db.ListLiabilities(uid); e == nil {
		for _, l := range libs {
			base -= fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
		}
	}
	return base
}

// BackfillPnlBaseCNY 为历史 pnl_daily 行补齐 base_cny（新增列前产生的历史行默认 0，
// 导致"盈亏率"视图全 0）。用"当前净资产基数"近似补全：真实日收益率 = 当日盈亏 / 净资产基数；
// 历史行无当时净值，以当前基数代填即可展示，后续每日快照会写入当时真实基数。幂等：仅更新 0 值行。
func BackfillPnlBaseCNY() {
	for _, u := range allUsers() {
		hs, err := db.List(u.ID)
		if err != nil {
			continue
		}
		cnyRate, hkdRate, _ := market.GetFXRates()
		base := computeEquityBaseCNY(u.ID, hs, cnyRate, hkdRate)
		if base <= 0 {
			continue
		}
		if err := db.BackfillPnlBase(u.ID, round2(base)); err != nil {
			log.Printf("[backfill] base_cny 补齐失败(uid=%d): %v", u.ID, err)
		}
	}
}

// EnsureSnapshot records today's snapshot on startup if missing (per user).
// 中国非交易日也补齐（doSnapshot 内部自动切"仅美股"模式），避免假期重启丢失当日美股快照。
func EnsureSnapshot() {
	today := time.Now().Format("2006-01-02")
	for _, u := range allUsers() {
		if has, _ := db.HasPnlDate(today, u.ID); has {
			continue
		}
		if _, _, err := refreshAllQuotes(u.ID); err != nil {
			log.Printf("[snapshot] 启动补齐行情刷新失败(uid=%d): %v", u.ID, err)
		}
		_ = doSnapshot(u.ID)
	}
}

// ScheduleDailySnapshot runs three time-triggered P&L snapshots per day, each
// aligned to when its asset class data becomes available:
//   - 美股: 每天 07:00（美东收盘后，T+1 体现最近一个美股交易日涨跌）
//   - A股:  每天 15:15（A股 15:00 收盘后）
//   - 基金: 每天 21:00（基金净值一般 21:00 后公布）
// 中国非交易日不再整体跳过（美股不跟中国假期），由 doSnapshot 内部仅记录美股。
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
// 中国非交易日照常跑（doSnapshot 内部仅记美股）；通知只随 07:00 美股任务发——
// 假期里 15:15/21:00 两次任务记录的仍是同一份美股收盘数据，重复推送没有信息量。
func runScheduledSnapshot(label string) {
	for _, u := range allUsers() {
		if _, _, err := refreshAllQuotes(u.ID); err != nil {
			log.Printf("[snapshot] %s 行情刷新失败(uid=%d): %v", label, u.ID, err)
		}
		if err := doSnapshot(u.ID); err != nil {
			log.Printf("[snapshot] %s 快照失败(uid=%d): %v", label, u.ID, err)
			continue
		}
		log.Printf("[snapshot] %s 定时盈亏记录完成(uid=%d)", label, u.ID)
		if !isTradingDayCN(time.Now()) && !strings.Contains(label, "美股") {
			continue
		}
		NotifyNetValueUpdated(u.ID, "定时快照("+label+")", scopeFromLabel(label))
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
	for _, u := range allUsers() {
		if has, _ := db.HasPnlDate(settleDate, u.ID); !has {
			if err := finalizePnlFromPrices(settleDate, u.ID); err != nil {
				log.Printf("[midnight] %s 当日盈亏回填失败(uid=%d): %v", settleDate, u.ID, err)
			} else {
				log.Printf("[midnight] %s 当日盈亏已落库(uid=%d)（回填）", settleDate, u.ID)
			}
		} else {
			log.Printf("[midnight] %s 当日盈亏已存在(uid=%d)，跳过回填", settleDate, u.ID)
		}
		// 2) 归零：把每个持仓的 prev_close 重设为最新价，使当日盈亏归零、不带入下一交易日。
		if err := db.RebasePrevCloseAll(u.ID); err != nil {
			log.Printf("[midnight] uid=%d prev_close 归零失败: %v", u.ID, err)
			return
		}
	}
	log.Printf("[midnight] 当日盈亏结算完成，结算日 %s", settleDate)
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
func finalizePnlFromPrices(date string, uid int64) error {
	closes, err := db.GetPriceDailyByDate(date, uid)
	if err != nil {
		return err
	}
	if len(closes) == 0 {
		return nil // 当日无行情记录，无需落库
	}
	hs, err := db.List(uid)
	if err != nil {
		return err
	}
	qtyBySym := map[string]float64{}
	for _, h := range hs {
		qtyBySym[h.Symbol] = h.Quantity
	}
	cnyRate, hkdRate, _ := market.GetFXRates()
	var totalCNY, totalUSD float64
	byCat := map[string]float64{"stock": 0, "fund": 0}
	byCur := map[string]float64{"CNY": 0, "USD": 0, "HKD": 0}
	var bySym []symPnl
	for sym, close := range closes {
		prev, ok, e := db.GetPrevClose(sym, date, uid)
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
		if strings.EqualFold(cur, "USD") {
			totalUSD += dp
		}
		dpCNY := fxToCNY(dp, cur, cnyRate, hkdRate)
		totalCNY += dpCNY
		bySym = append(bySym, symPnl{Symbol: sym, Name: name, Pnl: dp, PnlCNY: dpCNY, Currency: cur})
	}
	// 合并当日已实现盈亏（减仓落库）：与 doSnapshot 保持一致。否则白天快照漏跑时，
	// 午夜回填只会按价格重算、把已实现盈亏（如清仓落袋）丢掉。
	if rrows, e := db.ListRealizedPnl(uid, date); e == nil {
		for _, rp := range rrows {
			if strings.EqualFold(rp.Currency, "USD") {
				totalUSD += rp.Amount
			}
			rCNY := fxToCNY(rp.Amount, rp.Currency, cnyRate, hkdRate)
			totalCNY += rCNY
			byCur[rp.Currency] += rp.Amount
			bySym = append(bySym, symPnl{Symbol: rp.Symbol, Name: rp.Name + "·已实现", Pnl: round2(rp.Amount), PnlCNY: round2(rCNY), Currency: rp.Currency, ChangePct: 0})
		}
	}
	detail := fmt.Sprintf(`{"by_category":{"stock":%.2f,"fund":%.2f},"by_currency":{"CNY":%.2f,"USD":%.2f,"HKD":%.2f},"by_symbol":%s}`,
		byCat["stock"], byCat["fund"], byCur["CNY"], byCur["USD"], byCur["HKD"], mustJSON(bySym))
	// 同 doSnapshot：补齐当日净资产基数，保证"真实日收益率"口径一致
	baseCNY := computeEquityBaseCNY(uid, hs, cnyRate, hkdRate)
	return db.SavePnlDaily(date, totalCNY, totalUSD, cnyRate, round2(baseCNY), detail, uid)
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
	uid := currentUserID(c)
	if _, _, err := refreshAllQuotes(uid); err != nil {
		log.Printf("[snapshot] 手动快照行情刷新失败: %v", err)
	}
	if err := doSnapshot(uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	NotifyNetValueUpdated(uid, "手动快照", "")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func pnlHistory(c *gin.Context) {
	uid := currentUserID(c)
	rows, err := db.GetPnlHistory(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 叠加理财之前，保存一份纯持仓的 total_cny 给 equity_pnl_cny ——
	// 前端权益曲线用它（去理财波动），盈亏日历/其他地方继续用叠加后的 total_cny。
	type eqRow struct {
		Date       string  `json:"date"`
		EquityCNY  float64 `json:"equity_pnl_cny"` // 纯持仓每日盈亏（CNY）
	}
	eqByDate := map[string]float64{}
	for _, r := range rows {
		eqByDate[r.Date] = r.TotalCNY
	}

	// 合并理财每日盈亏：折算 CNY 叠加进当日 total_cny（盈亏日历/走势即自动包含理财收益）；
	// 理财有快照而持仓无 pnl_daily 记录的日期补行。detail 追加 by_wealth 供当日明细弹框展示，
	// 原 by_symbol/by_category 结构保持不变。
	if wd := wealthDailyPnlByDate(uid); len(wd) > 0 {
		cnyRate, _, _ := market.GetFXRates()
		idx := map[string]int{}
		for i := range rows {
			idx[rows[i].Date] = i
		}
		for date, wp := range wd {
			if i, ok := idx[date]; ok {
				rows[i].TotalCNY += wp.totalCNY
				rows[i].Detail = mergeWealthDetail(rows[i].Detail, wp.items)
			} else {
				detail, _ := json.Marshal(map[string]interface{}{"by_wealth": wp.items})
				rows = append(rows, db.PnlDay{Date: date, TotalCNY: wp.totalCNY, Rate: cnyRate, Detail: string(detail)})
				eqByDate[date] = 0 // 新补行：只有理财，持仓无盈亏
			}
		}
		sort.Slice(rows, func(a, b int) bool { return rows[a].Date < rows[b].Date })
	}

	// 给每行追加 equity_pnl_cny（纯持仓）：前端曲线用它去理财噪声
	type pnlWrap struct {
		db.PnlDay
		EquityCNY float64 `json:"equity_pnl_cny"`
	}
	out := make([]pnlWrap, len(rows))
	for i, r := range rows {
		out[i] = pnlWrap{PnlDay: r, EquityCNY: round2(eqByDate[r.Date])}
	}

	// 推算每日累计净投入 contrib_cny（纯持仓成本）
	calcContribCNY(uid, rows)
	// calcContribCNY 写的是 rows（无 equity_pnl_cny），同步给 out
	for i := range out {
		out[i].ContribCNY = rows[i].ContribCNY
	}

	c.JSON(http.StatusOK, gin.H{"history": out})
}

// calcContribCNY 根据 position_tx 的 BUY/SELL 交易还原"每日持仓本金"（CNY）。
// 正向逐月累加：BUY 按买入金额加本金，SELL 按 (amount − realized_pnl) 减本金（即卖出部分的原始成本）；
// DIV 分红不动本金（分红是已实现收益，不影响持仓投入）。未发生任何交易的日期沿用上一值。
func calcContribCNY(uid int64, rows []db.PnlDay) {
	if len(rows) == 0 {
		return
	}

	// 1) 收集所有非 reverted 交易，按日期归组，并折算 CNY
	cnyRate, hkdRate, _ := market.GetFXRates()
	txByDate := map[string]float64{}
	if dbs, err := db.DB.Query(`SELECT substr(pt.created_at,1,10) AS date, pt.amount, pt.realized_pnl, pt.tx_type, h.currency
		FROM position_tx pt JOIN holdings h ON h.id=pt.holding_id
		WHERE pt.reverted=0 AND h.user_id=?`, uid); err == nil {
		for dbs.Next() {
			var date, txType, cur string
			var amt, rp float64
			if dbs.Scan(&date, &amt, &rp, &txType, &cur) != nil {
				continue
			}
			var delta float64
			switch txType {
			case "BUY":
				delta = amt
			case "SELL":
				delta = -(amt - rp) // 卖出部分的原始成本
			default:
				delta = 0 // DIV 不动本金
			}
			txByDate[date] += fxToCNY(delta, cur, cnyRate, hkdRate)
		}
		dbs.Close()
	}

	// 2) 当前持仓总本金（CNY），作为最后一天的锚点
	var holdCost float64
	if hs, err := db.List(uid); err == nil {
		for _, h := range hs {
			holdCost += fxToCNY(h.CostPrice*h.Quantity, h.Currency, cnyRate, hkdRate)
		}
	}

	// 3) 正向累加：rows[i] 表示"当天结束时的本金"，顺序 = pnl_daily ASC。
	//    非交易日没有 txMap[r.Date] → contrib 不变；交易日先加 delta 再赋值。
	//    初始 contrib = holdCost（最终锚） − Σ 所有历史交易 delta（反向推到起始值）
	var totalDelta float64
	for _, v := range txByDate {
		totalDelta += v
	}
	contrib := holdCost - totalDelta

	for i := range rows {
		if v, ok := txByDate[rows[i].Date]; ok {
			contrib += v // 当天有交易，先加 delta 再赋值
		}
		rows[i].ContribCNY = round2(contrib)
	}
}

// wealthPnlItem 理财单日盈亏条目（盈亏日历/走势合并展示用）。
type wealthPnlItem struct {
	Name     string  `json:"name"`
	Currency string  `json:"currency"`
	Pnl      float64 `json:"pnl"`
	PnlCNY   float64 `json:"pnl_cny"`
}

type wealthDayPnl struct {
	totalCNY float64
	items    []wealthPnlItem
}

// wealthDailyPnlByDate 汇总该用户所有理财产品的每日盈亏（按日期分组）。
// 单产品当日盈亏 = 当日快照金额 - 前一日快照金额 - 当日现金流（与资产全景「每日盈亏」口径一致），
// USD/HKD 按当前汇率折算 CNY；跨产品同日期累加。
func wealthDailyPnlByDate(uid int64) map[string]*wealthDayPnl {
	products, err := db.ListWealth(uid)
	if err != nil {
		return nil
	}
	cnyRate, hkdRate, _ := market.GetFXRates()
	out := map[string]*wealthDayPnl{}
	for _, w := range products {
		snaps, err := db.ListWealthSnapshots(w.ID)
		if err != nil {
			continue
		}
		var prevAmt float64
		hasPrev := false
		for _, s := range snaps {
			var pnl float64
			if hasPrev {
				pnl = s.Amount - prevAmt - s.Cashflow + s.Dividend
			}
			pnlCNY := fxToCNY(pnl, w.Currency, cnyRate, hkdRate)
			d := out[s.Date]
			if d == nil {
				d = &wealthDayPnl{}
				out[s.Date] = d
			}
			pnl = round2(pnl)
			pnlCNY = round2(pnlCNY)
			d.totalCNY += pnlCNY
			d.items = append(d.items, wealthPnlItem{Name: w.Name, Currency: w.Currency, Pnl: pnl, PnlCNY: pnlCNY})
			prevAmt = s.Amount
			hasPrev = true
		}
	}
	return out
}

// mergeWealthDetail 把理财条目合并进 pnl_daily 的 detail JSON（保留原 by_symbol/by_category 等字段）。
func mergeWealthDetail(orig string, items []wealthPnlItem) string {
	var m map[string]interface{}
	if orig != "" && json.Unmarshal([]byte(orig), &m) == nil && m != nil {
		m["by_wealth"] = items
		b, _ := json.Marshal(m)
		return string(b)
	}
	b, _ := json.Marshal(map[string]interface{}{"by_wealth": items})
	return string(b)
}

// computeSpark returns each symbol's last N trading-day close prices (ascending),
// for the in-table mini sparklines. Shared by the merged
// /api/home endpoint so the logic lives in exactly one place.
// computeSpark returns each symbol's last N trading-day (back-adjusted) net values
// (ascending), for the in-table mini sparklines. For holdings with cash dividends the
// cumulative per-share dividend is added back to the raw NAV/price so the sparkline
// stays continuous across ex-dividend days instead of showing a false crash.
// minDates：每个 symbol 的最早买入日（home 收集）。price_daily 按 symbol 全量取数，
// 同 symbol 旧持仓遗留的快照不属于当前持仓生命周期——否则「近20日走势」会拿两个月前
// 的旧点当起点画出假趋势（2026-10-23 NVDA 复现：8-27 旧快照 → 两点上升假阳线）。
func computeSpark(uid int64, syms []string, minDates map[string]string) map[string][]float64 {
	const days = 30
	out := make(map[string][]float64, len(syms))
	for _, s := range syms {
		minDate := minDates[s]
		series, err := db.GetPriceSeries(s, uid)
		if err != nil || len(series) == 0 {
			continue
		}
		// 后复权：累计现金分红加回净值（净值+分红口径），消除除息断崖
		divs, _ := db.GetSymbolCashDividends(uid, s)
		closes := make([]float64, 0, len(series))
		var cum float64
		for _, p := range series {
			if minDate != "" && p.Date < minDate {
				continue
			}
			if d, ok := divs[p.Date]; ok {
				cum += d
			}
			closes = append(closes, p.Close+cum)
		}
		if len(closes) > days {
			closes = closes[len(closes)-days:]
		}
		out[s] = closes
	}
	return out
}


// home is the merged first-screen endpoint. It runs the same computations the client
// previously fetched via /api/holdings + /api/summary + /api/fx + /api/asset/sources
// + /api/price/spark and returns them in ONE response, removing the request waterfall
// that delayed visual completion (the Speed Index bottleneck).
func home(c *gin.Context) {
	uid := currentUserID(c)
	out, day, snap, upd, herr := computeHoldings(uid)
	if herr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": herr.Error()})
		return
	}
	sd, serr := computeSummary(uid)
	if serr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": serr.Error()})
		return
	}
	fx := market.GetFXInfo()
	srcs, _ := db.ListSources(uid)
	seen := map[string]bool{}
	minDates := map[string]string{} // symbol → 最早买入日，供 computeSpark 截掉旧持仓遗留快照
	syms := make([]string, 0, len(out))
	for _, h := range out {
		if d := h.BuyDate; d != "" {
			if cur, ok := minDates[h.Symbol]; !ok || d < cur {
				minDates[h.Symbol] = d
			}
		}
		if !seen[h.Symbol] {
			seen[h.Symbol] = true
			syms = append(syms, h.Symbol)
		}
	}
	spark := computeSpark(uid, syms, minDates)
	// 现金子账户余额：key = "sourceID:currency"（币种小写），value = 该 (来源,币种) 下所有现金子账户余额合计。
	// 供首页持仓表「仓位」列计算分母（同账户同币种持仓市值合计 + 现金余额）；匹配不到 key 时前端显示 —。
	cashBal := make(map[string]float64)
	if cashList, cerr := db.ListCash(uid); cerr == nil {
		for _, cc := range cashList {
			cur := strings.ToLower(cc.Currency)
			if cur == "cny" {
				cur = "cny" // 存量数据人民币有 rmb/cny 两种写法，归一为 cny 后与持仓侧 key 对齐
			}
			cashBal[strconv.FormatInt(cc.SourceID, 10)+":"+cur] += cc.Amount
		}
	}
	resp := gin.H{
		"holdings":       out,
		"day_date":       day,
		"snapshot_date":  snap,
		"updated_at_max": upd,
		"fx":             fx,
		"sources":        srcs,
		"spark":          spark,
		"cash":           cashBal,
	}
	for k, v := range sd {
		resp[k] = v
	}
	c.JSON(http.StatusOK, resp)
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
	// 历史盈亏重算基准：未清仓用当前份额/成本；已清仓或份额/成本已清零的老数据，
	// 优先用清仓前快照，快照缺失时从 position_tx 回退推算（兼容本次升级前已清仓的老数据）。
	qty := h.Quantity
	cost := h.CostPrice
	// 已清仓判定 + 清仓日（最后一次 SELL 的日期）。清仓后不应再产生浮动盈亏，
	// 曲线必须截断到清仓日，否则会把清仓后的涨跌算成持仓盈亏（历史 bug）。
	closed := h.Closed || h.Quantity <= 0
	var closedDate string
	var realizedSum float64
	var txs []db.PositionTx
	if t, e := db.ListPositionTx(h.ID); e == nil {
		txs = t
	}
	if closed {
		for _, t := range txs { // ListPositionTx 按 id DESC，最后一条 SELL 即清仓动作
			if t.TxType != "SELL" {
				continue
			}
			realizedSum += t.RealizedPnl
			if len(t.CreatedAt) >= 10 {
				d := t.CreatedAt[:10]
				if d > closedDate {
					closedDate = d
				}
			}
		}
	}
	if h.Closed || (h.Quantity <= 0 && h.CostPrice <= 0) {
		if h.LastQuantity > 0 {
			qty = h.LastQuantity
		}
		if h.LastCostPrice > 0 {
			cost = h.LastCostPrice
		}
		if qty <= 0 || cost <= 0 {
			var sellQty, sellFee, realizedAll, lastPrice float64
			for _, t := range txs {
				if t.TxType == "SELL" {
					sellQty += t.Quantity
					sellFee += t.Fee
					realizedAll += t.RealizedPnl
					lastPrice = t.Price
				}
			}
			if qty <= 0 && sellQty > 0 {
				qty = sellQty
			}
			if cost <= 0 && sellQty > 0 && lastPrice > 0 {
				// realized = (price - cost)*qty - fee  =>  cost = price - (realized+fee)/qty
				cost = lastPrice - (realizedAll+sellFee)/sellQty
			}
		}
	}
	series, err := db.GetPriceSeries(h.Symbol, h.UserID)
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
	// 现金分红后复权：把累计每股现金分红加回净值，使分红日的当日盈亏不再假跌
	// （净值+分红口径）。红利再投（REINVEST）不在此处理——分红已转为份额，市值连续。
	divs := map[string]float64{}
	for _, t := range txs {
		if t.TxType == "DIV" && t.Reverted != 1 && len(t.CreatedAt) >= 10 {
			divs[t.CreatedAt[:10]] = t.Price
		}
	}
	// 累计每股分红总和。现金分红入账时成本价已按每股分红下调（除息摊薄，db.AdjustDividend），
	// 持仓列表盈亏 = (现价 − 摊薄后成本) × 份额，分红已计一次。若算历史累计盈亏时再把 cumDiv
	// 加回净值，分红会被计两次（2026-10-23 复现：007172 分红 211.01，历史总盈亏 343.51
	// vs 持仓列表 132.50；WMT/PEP 差额同样精确等于各自分红总额）。
	// 正确口径：把历史成本基准还原为「当前成本 + 当日之后才发生的每股分红」——
	//   分红前各点 = (收盘 − 原成本) × 份额（尚未收到分红，不计入）
	//   分红后各点 = (收盘 − 摊薄后成本) × 份额（与持仓列表盈亏逐分对齐）
	// 这样除息日累计盈亏连续（不假跌也不假涨），且逐日盈亏求和恰等于期末累计盈亏。
	var cumDivTotal float64
	for _, per := range divs {
		cumDivTotal += per
	}
	var rows []Row
	var cumDiv float64
	var prevAdj float64
	// 曲线截断到买入日：price_daily 按 symbol 全量取数，同 symbol 旧持仓遗留的
	// 历史快照不属于本持仓生命周期——否则首行基准错乱，两个月前的价差会被算成
	// 「当日盈亏」（2026-10-23 NVDA 复现：8-27 旧快照 209.66 作基准，10-23 虚增 +7.65）。
	startDate := h.BuyDate
	n := 0 // 纳入曲线的点数：过滤（continue）不重置 range 索引，首条判定必须用独立计数
	for _, p := range series {
		// 已清仓：曲线截止清仓日（含），之后的行情与持仓无关，不能再算成持仓盈亏
		if closed && closedDate != "" && p.Date > closedDate {
			break
		}
		if startDate != "" && p.Date < startDate {
			continue
		}
		if d, ok := divs[p.Date]; ok {
			cumDiv += d
		}
		adj := p.Close + cumDiv
		mv := p.Close * qty * fx
		// 历史成本基准：当前成本 + 尚未生效的每股分红（分红当日成本已摊薄，不再加回）。
		// 现金分红收益通过成本下调计入一次，与持仓列表 pnl = (现价−成本)×份额 完全同口径。
		costAt := cost + (cumDivTotal - cumDiv)
		totalPnl := (p.Close - costAt) * qty * fx
		var totalPct, dayPnl, dayPct float64
		if costAt > 0 {
			totalPct = totalPnl / (costAt * qty * fx) * 100
		}
		n++
		if n > 1 {
			// 当日盈亏用复权净值差值：分红日净值因除息跳降的部分由累计分红补回
			dayPnl = (adj - prevAdj) * qty * fx
			if prevAdj > 0 {
				dayPct = dayPnl / (prevAdj * qty * fx) * 100
			}
		} else {
			// 首点没有前一快照可差值：当日盈亏按成本基准（与持仓列表 enrich 首日口径一致），
			// 即首日「盈亏金额 = 累计盈亏」——不是 0。
			dayPnl = totalPnl
			dayPct = totalPct
		}
		prevAdj = adj
		// 清仓日当天的累计盈亏用已实现口径（卖出价落袋），而不是收盘价浮盈，避免与交易记录对不上
		if closed && closedDate != "" && p.Date == closedDate && realizedSum != 0 {
			totalPnl = realizedSum
			if costAt*qty*fx > 0 {
				totalPct = totalPnl / (costAt * qty * fx) * 100
			}
		}
		rows = append(rows, Row{Date: p.Date, Close: p.Close, DayPnl: dayPnl, DayPnlPct: dayPct, TotalPnl: totalPnl, TotalPnlPct: totalPct, MarketValue: mv})
	}
	// 买入日之后尚无快照（刚买入、当日快照任务未跑）：回退用最后一个 ≤买入日 的点
	// 保底，避免弹框空图（day_pnl 缺省 0，首行无基准问题）。
	if !closed && len(rows) == 0 && len(series) > 0 && startDate != "" {
		for i := len(series) - 1; i >= 0; i-- {
			if series[i].Date <= startDate {
				p := series[i]
				mv := p.Close * qty * fx
				totalPnl := (p.Close - cost) * qty * fx
				var totalPct float64
				if cost > 0 {
					totalPct = totalPnl / (cost * qty * fx) * 100
				}
				rows = append(rows, Row{Date: p.Date, Close: p.Close, TotalPnl: totalPnl, TotalPnlPct: totalPct, MarketValue: mv})
				break
			}
		}
	}
	// 清仓日之后没有价格序列时（清仓日超出已有行情范围），曲线至少保留最后一个点
	if closed && closedDate != "" && len(rows) == 0 && len(series) > 0 {
		p := series[0]
		mv := p.Close * qty * fx
		totalPnl := (p.Close - cost) * qty * fx
		var totalPct float64
		if cost > 0 {
			totalPct = totalPnl / (cost * qty * fx) * 100
		}
		rows = append(rows, Row{Date: p.Date, Close: p.Close, TotalPnl: totalPnl, TotalPnlPct: totalPct, MarketValue: mv})
	}
	// 交易点：BUY/SELL 供前端在曲线上打 B/S 标记；DIV（分红）不画。
	// 日期取 created_at[:10]，若当天没有行情点，前端会就近落到最近一个点上。
	type Marker struct {
		Date     string  `json:"date"`
		Type     string  `json:"type"` // BUY | SELL
		Price    float64 `json:"price"`
		Quantity float64 `json:"quantity"`
		Amount   float64 `json:"amount"` // 成交金额 = quantity * price
		Fee      float64 `json:"fee"`
		Note     string  `json:"note"`
	}
	var markers []Marker
	for _, t := range txs {
		if t.TxType != "BUY" && t.TxType != "SELL" {
			continue
		}
		if len(t.CreatedAt) < 10 {
			continue
		}
		d := t.CreatedAt[:10]
		if closed && closedDate != "" && d > closedDate {
			continue // 清仓日之后的交易不在曲线区间内
		}
		markers = append(markers, Marker{Date: d, Type: t.TxType, Price: t.Price, Quantity: t.Quantity, Amount: t.Amount, Fee: t.Fee, Note: t.Note})
	}
	// 已清仓日的落袋摘要：供前端在清仓日 hover 时显示「累计收益 / 持仓天数 / 收益率」
	var closedInfo *struct {
		Date        string  `json:"date"`
		RealizedPnl float64 `json:"realized_pnl"`
		HoldingDays int     `json:"holding_days"`
		ReturnRate  float64 `json:"return_rate"`
		CostAmount  float64 `json:"cost_amount"`
		SellPrice   float64 `json:"sell_price"`
		CostPrice   float64 `json:"cost_price"`
	}
	if closed && closedDate != "" && cost > 0 && qty > 0 {
		costAmt := cost * qty * fx
		info := &struct {
			Date        string  `json:"date"`
			RealizedPnl float64 `json:"realized_pnl"`
			HoldingDays int     `json:"holding_days"`
			ReturnRate  float64 `json:"return_rate"`
			CostAmount  float64 `json:"cost_amount"`
			SellPrice   float64 `json:"sell_price"`
			CostPrice   float64 `json:"cost_price"`
		}{Date: closedDate, RealizedPnl: realizedSum, CostAmount: costAmt,
			CostPrice: cost, ReturnRate: round2(realizedSum / costAmt * 100)}
		// 持仓天数：buy_date → 清仓日（老数据无 buy_date 时退化为 series 起点→清仓日）
		start := h.BuyDate
		if start == "" && len(rows) > 0 {
			start = rows[0].Date
		}
		if start != "" {
			if d1, e1 := time.Parse("2006-01-02", start); e1 == nil {
				if d2, e2 := time.Parse("2006-01-02", closedDate); e2 == nil {
					info.HoldingDays = int(d2.Sub(d1).Hours() / 24)
				}
			}
		}
		// 清仓成交价（最后一次 SELL 的价格）
		for _, t := range txs {
			if t.TxType == "SELL" && len(t.CreatedAt) >= 10 && t.CreatedAt[:10] == closedDate {
				info.SellPrice = t.Price
			}
		}
		closedInfo = info
	}
	holdPnl := round2((h.CurrentPrice - h.CostPrice) * h.Quantity * fx)
	var holdPct float64
	if cb := h.CostPrice * h.Quantity * fx; cb > 0 {
		holdPct = round2(holdPnl / cb * 100)
	}
	c.JSON(http.StatusOK, gin.H{
		"holding":     gin.H{"id": h.ID, "name": h.Name, "symbol": h.Symbol, "currency": h.Currency, "quantity": h.Quantity, "cost_price": h.CostPrice, "category": h.Category, "closed": closed, "closed_date": closedDate, "pnl": holdPnl, "pnl_pct": holdPct},
		"currency":    h.Currency,
		"fx":          fx,
		"series":      rows,
		"markers":     markers,
		"closed_info": closedInfo,
	})
}

