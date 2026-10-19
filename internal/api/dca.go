package api

// 基金定投（DCA）接口层
//
// 资金安全约定（重要）：
//   • 计划只负责「按周期生成待办期次」，绝不自动动账 —— 成交价/份额未知且常与计划金额有出入。
//   • 每期由用户确认后动账一次：加仓（position_tx）+ 子账户扣款（cash_flow），
//     两个 id 写回记录（tx_id / cash_flow_id），撤销/修改时精确回滚，不靠金额反查。
//   • 已执行期次不可删除，只能「修改」（回滚后重记）或「撤销」（回滚回 pending）。
//   • 限购 / 关门：计划可手工暂停（status=paused），或设单期上限（max_amount）自动截断。

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

var dcaIntervals = map[string]string{
	"daily":     "每日",
	"weekly":    "每周",
	"biweekly":  "每两周",
	"monthly":   "每月",
	"quarterly": "每季",
}

// ============================ 计划 ============================

// listDCAPlans GET /api/dca/plans —— 先补齐到期期次，再返回计划列表（含统计与下一期日）。
func listDCAPlans(c *gin.Context) {
	uid := currentUserID(c)
	if _, err := db.EnsureDCARecords(uid); err != nil {
		log.Printf("[dca] 补期失败(uid=%d): %v", uid, err)
	}
	plans, err := db.ListDCAPlans(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]db.DCAPlan, 0, len(plans))
	totalPending := 0
	for _, p := range plans {
		fillDCAPlan(&p)
		if p.Status == "active" {
			totalPending += p.PendingCount
		}
		out = append(out, p)
	}
	c.JSON(http.StatusOK, gin.H{"plans": out, "pending_total": totalPending})
}

// fillDCAPlan 拼装计划的展示字段：持仓名/币种、期次统计、下一期日。
func fillDCAPlan(p *db.DCAPlan) {
	if h, err := db.Get(p.HoldingID); err == nil && h != nil {
		p.HoldingName = h.Name
		p.HoldingSymbol = h.Symbol
		p.Currency = h.Currency
		p.Category = h.Category
	}
	pending, done, _, doneAmount, _ := db.DCAPlanStats(p.ID)
	p.PendingCount = pending
	p.DoneCount = done
	p.DoneAmount = round2(doneAmount)
	if p.Status == "active" || p.Status == "paused" {
		var last string
		_ = db.DB.QueryRow(`SELECT COALESCE(MAX(plan_date),'') FROM dca_records WHERE plan_id=?`, p.ID).Scan(&last)
		p.NextDate = db.NextDCADate(*p, last)
	}
}

// createDCAPlan POST /api/dca/plans
func createDCAPlan(c *gin.Context) {
	uid := currentUserID(c)
	var req struct {
		HoldingID    int64   `json:"holding_id"`
		Amount       float64 `json:"amount"`
		Interval     string  `json:"interval"`
		DayOfMonth   int     `json:"day_of_month"`
		StartDate    string  `json:"start_date"`
		EndDate      string  `json:"end_date"`
		MaxAmount    float64 `json:"max_amount"`
		CashAccount  int64   `json:"cash_account_id"`
		Note         string  `json:"note"`
		CreateHolding *struct {
			Name     string `json:"name"`
			Symbol   string `json:"symbol"`
			Category string `json:"category"`
			Market   string `json:"market"`
			SourceID int64  `json:"source_id"`
			Currency string `json:"currency"`
		} `json:"create_holding"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	// 「添加基金的时候支持定投」：允许一次提交同时新建持仓（名称+代码）并直接挂定投计划。
	if (req.HoldingID == 0) && req.CreateHolding != nil && strings.TrimSpace(req.CreateHolding.Name) != "" {
		nh := req.CreateHolding
		h := db.Holding{
			Name:      strings.TrimSpace(nh.Name),
			Symbol:    strings.ToUpper(strings.TrimSpace(nh.Symbol)),
			Category:  strings.TrimSpace(nh.Category),
			Market:    strings.TrimSpace(nh.Market),
			Currency:  strings.TrimSpace(nh.Currency),
			SourceID:  nh.SourceID,
			Quantity:  0,
			CostPrice: 0,
			UserID:    uid,
			UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
		}
		normalize(&h)
		// 未指定来源时落到用户的第一个账户，避免新建持仓挂在 source_id=0 上
		// （资金扣款会因此落到「无来源」的默认子账户，不便于对账）
		if h.SourceID == 0 {
			if srcs, e := db.ListSources(uid); e == nil && len(srcs) > 0 {
				h.SourceID = srcs[0].ID
			}
		}
		// 关联真实资金账户：用所选扣款子账户反推币种与来源，确保持仓/定投/账户三方一致
		if req.CashAccount != 0 {
			if acc, e := db.GetCash(req.CashAccount); e == nil && acc != nil {
				if h.Currency == "" {
					h.Currency = acc.Currency
				}
				if h.SourceID == 0 {
					h.SourceID = acc.SourceID
				}
			}
		}
		id, err := db.Create(&h)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.HoldingID = id
	}
	p, bad := buildDCAPlan(uid, req.HoldingID, req.Amount, req.Interval, req.DayOfMonth, req.StartDate, req.EndDate, req.MaxAmount, req.CashAccount, req.Note)
	if bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": bad})
		return
	}
	id, err := db.CreateDCAPlan(p)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 立即补期：起始日若已过，首期当天即可确认
	if _, e := db.EnsureDCARecords(uid); e != nil {
		log.Printf("[dca] 新建后补期失败(uid=%d): %v", uid, e)
	}
	p.ID = id
	fillDCAPlan(p)
	c.JSON(http.StatusOK, gin.H{"ok": true, "plan": p})
}

// updateDCAPlan PUT /api/dca/plans/:id
func updateDCAPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	old, err := db.GetDCAPlan(id)
	if err != nil || old == nil || old.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	var req struct {
		Amount      float64 `json:"amount"`
		Interval    string  `json:"interval"`
		DayOfMonth  int     `json:"day_of_month"`
		StartDate   string  `json:"start_date"`
		EndDate     string  `json:"end_date"`
		MaxAmount   float64 `json:"max_amount"`
		Status      string  `json:"status"`
		CashAccount int64   `json:"cash_account_id"`
		Note        string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	p, bad := buildDCAPlan(uid, old.HoldingID, req.Amount, req.Interval, req.DayOfMonth, req.StartDate, req.EndDate, req.MaxAmount, req.CashAccount, req.Note)
	if bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": bad})
		return
	}
	p.ID = id
	p.Status = strings.TrimSpace(req.Status)
	if p.Status == "" {
		p.Status = old.Status
	}
	if _, ok := dcaIntervals[p.Interval]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "间隔不支持"})
		return
	}
	if err := db.UpdateDCAPlan(p); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 未执行期次同步新金额（含限购截断）
	_ = db.UpdateDCAPendingAmounts(id, p.Amount, p.MaxAmount)
	if _, e := db.EnsureDCARecords(uid); e != nil {
		log.Printf("[dca] 编辑后补期失败(uid=%d): %v", uid, e)
	}
	np, _ := db.GetDCAPlan(id)
	fillDCAPlan(np)
	c.JSON(http.StatusOK, gin.H{"ok": true, "plan": np})
}

// buildDCAPlan 校验并组装计划（共用新建/编辑校验）。
func buildDCAPlan(uid, holdingID int64, amount float64, interval string, day int, start, end string, maxAmount float64, cashID int64, note string) (*db.DCAPlan, string) {
	interval = strings.TrimSpace(interval)
	if interval == "" {
		interval = "monthly"
	}
	if _, ok := dcaIntervals[interval]; !ok {
		return nil, "定投间隔不支持"
	}
	if holdingID <= 0 {
		return nil, "请选择定投标的"
	}
	h, err := db.Get(holdingID)
	if err != nil || h == nil || h.UserID != uid {
		return nil, "定投标的不存在"
	}
	if amount <= 0 {
		return nil, "每期金额必须大于 0"
	}
	start = strings.TrimSpace(start)
	if start == "" {
		start = time.Now().Format("2006-01-02")
	}
	if _, e := time.Parse("2006-01-02", start); e != nil {
		return nil, "起始日格式应为 YYYY-MM-DD"
	}
	end = strings.TrimSpace(end)
	if end != "" {
		if _, e := time.Parse("2006-01-02", end); e != nil {
			return nil, "截止日格式应为 YYYY-MM-DD"
		}
		if end < start {
			return nil, "截止日不能早于起始日"
		}
	}
	if day < 1 || day > 31 {
		day = 1
	}
	if maxAmount < 0 {
		maxAmount = 0
	}
	return &db.DCAPlan{
		UserID:      uid,
		HoldingID:   holdingID,
		Amount:      round2(amount),
		Interval:    interval,
		DayOfMonth:  day,
		StartDate:   start,
		EndDate:     end,
		MaxAmount:   round2(maxAmount),
		Status:      "active",
		CashAccount: cashID,
		Note:        strings.TrimSpace(note),
	}, ""
}

// deleteDCAPlan DELETE /api/dca/plans/:id
func deleteDCAPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	p, err := db.GetDCAPlan(id)
	if err != nil || p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	if _, err := db.DeleteDCAPlan(id, uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// setDCAStatus POST /api/dca/plans/:id/status —— active（恢复）/ paused（暂停，应对限购关门）/ ended（结束）
func setDCAStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	var req struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	st := strings.TrimSpace(req.Status)
	if st != "active" && st != "paused" && st != "ended" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "状态不支持"})
		return
	}
	p, err := db.GetDCAPlan(id)
	if err != nil || p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	if err := db.SetDCAStatus(id, uid, st); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 暂停原因写备注（限购/关门等），空则不覆盖。
	// 注意：p 是改状态前的快照，整行 UPDATE 时必须带上新状态，否则会把刚改的状态覆盖回去。
	if s := strings.TrimSpace(req.Note); s != "" {
		p.Status = st
		p.Note = s
		_ = db.UpdateDCAPlan(p)
	}
	if st == "active" {
		if _, e := db.EnsureDCARecords(uid); e != nil {
			log.Printf("[dca] 恢复后补期失败(uid=%d): %v", uid, e)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": st})
}

// ============================ 期次记录 ============================

// listDCARecords GET /api/dca/plans/:id/records
func listDCARecords(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	p, err := db.GetDCAPlan(id)
	if err != nil || p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	recs, err := db.ListDCARecords(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h, _ := db.Get(p.HoldingID)
	for i := range recs {
		if h != nil {
			recs[i].HoldingName = h.Name
			recs[i].HoldingSymbol = h.Symbol
			recs[i].Currency = h.Currency
		}
	}
	fillDCAPlan(p)
	c.JSON(http.StatusOK, gin.H{"records": recs, "plan": p})
}

// dcaExecReq 执行/修改一期定投的入参。
// 份额与金额二选一：给 quantity 直接按份额成交；只给 amount 则按 (amount-fee)/price 反推份额。
type dcaExecReq struct {
	Price         float64 `json:"price"`
	Quantity      float64 `json:"quantity"`
	Amount        float64 `json:"amount"`
	Fee           float64 `json:"fee"`
	Note          string  `json:"note"`
	CashAccountID int64   `json:"cash_account_id"`
}

// doExecuteDCA 执行一期：加仓 + 子账户扣款 + 回写记录。revert 为 true 时先回滚既有执行结果。
func doExecuteDCA(uid int64, rec *db.DCARecord, req dcaExecReq, revert bool) error {
	if revert && rec.Status == "done" {
		if err := revertDCAExec(rec); err != nil {
			return err
		}
		fresh, err := db.GetDCARecord(rec.ID)
		if err != nil {
			return err
		}
		*rec = *fresh
	}
	if rec.Status == "done" {
		return fmt.Errorf("该期已执行，请点「修改」调整")
	}
	h, err := db.Get(rec.HoldingID)
	if err != nil || h == nil || h.UserID != uid {
		return fmt.Errorf("定投标的不存在")
	}
	price := req.Price
	if price <= 0 {
		// 未填成交价时回落到持仓现价（基金为最新净值）
		price = h.CurrentPrice
	}
	if price <= 0 {
		return fmt.Errorf("成交价必须大于 0")
	}
	fee := req.Fee
	if fee < 0 {
		fee = 0
	}
	qty := req.Quantity
	if qty <= 0 {
		amt := req.Amount
		if amt <= 0 {
			amt = rec.Amount
		}
		qty = (amt - fee) / price
	}
	if qty <= 0 {
		return fmt.Errorf("份额必须大于 0（请检查金额与费用）")
	}
	amount := round2(qty*price + fee)

	note := fmt.Sprintf("定投第%d期", rec.Seq)
	if s := strings.TrimSpace(req.Note); s != "" {
		note += "｜" + s
	}
	// 1) 加仓（写 position_tx）
	if _, _, err := db.AdjustHolding(rec.HoldingID, "BUY", qty, price, fee, note); err != nil {
		return err
	}
	txID, _ := db.LatestPositionTxID(rec.HoldingID)
	// 2) 资金扣款（写 cash_flow）；失败则回滚加仓，避免「份额多了钱没扣」
	acc, err := resolveCashAccount(uid, req.CashAccountID, h.SourceID, h.Currency)
	cashFlowID := int64(0)
	if err != nil {
		_ = db.RevertBuyTx(rec.HoldingID, txID)
		return err
	}
	detail := fmt.Sprintf("定投扣款 %s %s｜第%d期｜份额 %g｜价 %g｜费 %g", h.Name, h.Symbol, rec.Seq, qty, price, fee)
	if s := strings.TrimSpace(req.Note); s != "" {
		detail += "｜" + s
	}
	if e := db.AddCashAmount(acc.ID, -amount, "dca_buy", "dca_record", rec.ID, h.Name, detail); e != nil {
		_ = db.RevertBuyTx(rec.HoldingID, txID)
		return e
	}
	if f, e := db.GetLatestCashFlowByRef("dca_record", rec.ID); e == nil && f != nil {
		cashFlowID = f.ID
	}
	// 3) 回写记录
	keepNote := rec.Note
	if keepNote != "" && !strings.Contains(keepNote, "限购") {
		keepNote = ""
	}
	return db.MarkDCARecordDone(rec.ID, amount, round4(price), qty, fee, txID, cashFlowID, keepNote)
}

// revertDCAExec 回滚一期已执行结果：删现金流水（还原余额）+ 删加仓交易（还原份额成本）。
func revertDCAExec(rec *db.DCARecord) error {
	if rec.CashFlowID > 0 {
		if err := db.DeleteCashFlowRecord(rec.CashFlowID); err != nil {
			return fmt.Errorf("回滚资金流水失败: %w", err)
		}
	}
	if rec.TxID > 0 {
		if err := db.RevertBuyTx(rec.HoldingID, rec.TxID); err != nil {
			return fmt.Errorf("回滚加仓失败: %w", err)
		}
	}
	return db.ResetDCARecordPending(rec.ID, rec.Note)
}

// getDCARecordOwned 取记录并校验归属。
func getDCARecordOwned(c *gin.Context) (*db.DCARecord, int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return nil, 0, false
	}
	uid := currentUserID(c)
	rec, err := db.GetDCARecord(id)
	if err != nil || rec == nil || rec.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
		return nil, 0, false
	}
	return rec, uid, true
}

// executeDCARecord POST /api/dca/records/:id/execute —— 确认执行（pending / skipped → done）
func executeDCARecord(c *gin.Context) {
	rec, uid, ok := getDCARecordOwned(c)
	if !ok {
		return
	}
	var req dcaExecReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	if err := doExecuteDCA(uid, rec, req, false); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	finalizeDCA(c, rec.ID)
}

// modifyDCARecord PUT /api/dca/records/:id —— 修改已执行期次的实际成交（回滚后按新值重记）
func modifyDCARecord(c *gin.Context) {
	rec, uid, ok := getDCARecordOwned(c)
	if !ok {
		return
	}
	var req dcaExecReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	if err := doExecuteDCA(uid, rec, req, true); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	finalizeDCA(c, rec.ID)
}

// finalizeDCA 统一回包：返回最新记录 + 该计划统计 + 持仓概览，供前端就地刷新。
func finalizeDCA(c *gin.Context, recID int64) {
	rec, _ := db.GetDCARecord(recID)
	planID := int64(0)
	if rec != nil {
		planID = rec.PlanID
		if h, e := db.Get(rec.HoldingID); e == nil && h != nil {
			rec.HoldingName, rec.HoldingSymbol, rec.Currency = h.Name, h.Symbol, h.Currency
		}
	}
	uid := currentUserID(c)
	var plan *db.DCAPlan
	if planID > 0 {
		if p, err := db.GetDCAPlan(planID); err == nil && p != nil {
			fillDCAPlan(p)
			plan = p
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "record": rec, "plan": plan, "pending_total": dcaPendingTotal(uid)})
}

func dcaPendingTotal(uid int64) int {
	recs, err := db.ListPendingDCARecords(uid)
	if err != nil {
		return 0
	}
	return len(recs)
}

// skipDCARecord POST /api/dca/records/:id/skip —— 本期跳过（不扣款、不加仓）
func skipDCARecord(c *gin.Context) {
	rec, _, ok := getDCARecordOwned(c)
	if !ok {
		return
	}
	if rec.Status == "done" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "已执行的期次不能跳过，请先撤销"})
		return
	}
	target := "skipped"
	if rec.Status == "skipped" {
		target = "pending" // 再点一次 = 恢复待确认
	}
	if err := db.SetDCARecordStatus(rec.ID, target); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	finalizeDCA(c, rec.ID)
}

// revertDCARecord POST /api/dca/records/:id/revert —— 撤销已执行（回滚持仓与资金，退回待确认）
func revertDCARecord(c *gin.Context) {
	rec, _, ok := getDCARecordOwned(c)
	if !ok {
		return
	}
	if rec.Status != "done" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该期未执行"})
		return
	}
	if err := revertDCAExec(rec); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	finalizeDCA(c, rec.ID)
}

// deleteDCARecord DELETE /api/dca/records/:id —— 删除未执行的期次（已执行需先撤销）
func deleteDCARecord(c *gin.Context) {
	rec, _, ok := getDCARecordOwned(c)
	if !ok {
		return
	}
	if rec.Status == "done" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "已执行的期次不能删除，请先撤销"})
		return
	}
	if err := db.DeleteDCARecordCascade(rec.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EnsureDCA 启动时为所有用户补齐到期期次（幂等）。
func EnsureDCA() {
	for _, u := range allUsers() {
		if n, err := db.EnsureDCARecords(u.ID); err != nil {
			log.Printf("[dca] 启动补期失败(uid=%d): %v", u.ID, err)
		} else if n > 0 {
			log.Printf("[dca] 启动补齐 %d 期待确认(uid=%d)", n, u.ID)
		}
	}
}
