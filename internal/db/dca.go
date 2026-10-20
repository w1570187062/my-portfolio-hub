package db

// 基金定投（DCA）
//
// 设计要点：
//  1. 计划（dca_plans）只描述「怎么投」，执行（dca_records）才是真正动账的动作；
//     计划按周期自动生成 pending 记录，但**不会自动加仓扣款** —— 由用户逐期确认，
//     因为实际成交价/份额与计划金额常有出入（限购、确认价未知）。
//  2. 每期执行都会同时改持仓（position_tx）与现金账户（cash_flow），
//     并把两者的 id 记在记录上（tx_id / cash_flow_id），这样「修改/撤销」能精确回滚，
//     不靠金额反查，避免误伤同金额的其他流水。
//  3. 限购：max_amount > 0 时生成期自动截断计划金额（记 note），不静默多扣。

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// DCAPlan 定投计划
type DCAPlan struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"user_id"`
	HoldingID   int64   `json:"holding_id"`
	Amount      float64 `json:"amount"`       // 每期计划金额（持仓币种）
	Interval    string  `json:"interval"`     // daily | weekly | biweekly | monthly | quarterly
	DayOfMonth  int     `json:"day_of_month"` // monthly/quarterly 专用：每月几号（1-31，超出按月末）
	StartDate   string  `json:"start_date"`   // 首期日期 YYYY-MM-DD
	EndDate     string  `json:"end_date"`     // 截止日期 YYYY-MM-DD，空=长期
	MaxAmount   float64 `json:"max_amount"`   // 单期限购上限，0=不限
	FeeRate     float64 `json:"fee_rate"`     // 费率（%），每期执行时按 金额×费率 预填费用，可改
	Status      string  `json:"status"`       // active | paused | ended
	CashAccount int64   `json:"cash_account_id"`
	Note        string  `json:"note"`
	CreatedAt   string  `json:"created_at"`
	// ---- 列表展示用（不入库，查询时拼装）----
	HoldingName   string  `json:"holding_name"`
	HoldingSymbol string  `json:"holding_symbol"`
	Currency      string  `json:"currency"`
	Category      string  `json:"category"`
	NextDate      string  `json:"next_date"`     // 下一期计划日（已到期的会先被生成为 pending）
	PendingCount  int     `json:"pending_count"` // 待确认期数
	DoneCount     int     `json:"done_count"`
	DoneAmount    float64 `json:"done_amount"` // 累计已投金额
}

// DCARecord 定投执行记录（一期一条）
type DCARecord struct {
	ID           int64   `json:"id"`
	UserID       int64   `json:"user_id"`
	PlanID       int64   `json:"plan_id"`
	HoldingID    int64   `json:"holding_id"`
	Seq          int     `json:"seq"` // 第几期（从 1 开始）
	PlanDate     string  `json:"plan_date"`
	Amount       float64 `json:"amount"`        // 计划金额
	ActualAmount float64 `json:"actual_amount"` // 实际成交金额（含费）
	Price        float64 `json:"price"`         // 实际成交价（净值）
	Quantity     float64 `json:"quantity"`      // 实际确认份额
	Fee          float64 `json:"fee"`           // 手续费
	Status       string  `json:"status"`        // pending | done | skipped
	TxID         int64   `json:"tx_id"`         // 对应 position_tx.id（加仓流水，撤销时删除）
	CashFlowID   int64   `json:"cash_flow_id"`  // 对应 cash_flow.id（扣款流水，撤销时删除）
	Note         string  `json:"note"`
	CreatedAt    string  `json:"created_at"`
	DoneAt       string  `json:"done_at"`
	// ---- 展示用 ----
	HoldingName   string `json:"holding_name"`
	HoldingSymbol string `json:"holding_symbol"`
	Currency      string `json:"currency"`
}

func initDCATables() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS dca_plans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0,
			holding_id INTEGER NOT NULL DEFAULT 0,
			amount REAL NOT NULL DEFAULT 0,
			interval TEXT NOT NULL DEFAULT 'monthly',
			day_of_month INTEGER NOT NULL DEFAULT 1,
			start_date TEXT NOT NULL DEFAULT '',
			end_date TEXT NOT NULL DEFAULT '',
			max_amount REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			cash_account_id INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS dca_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0,
			plan_id INTEGER NOT NULL DEFAULT 0,
			holding_id INTEGER NOT NULL DEFAULT 0,
			seq INTEGER NOT NULL DEFAULT 0,
			plan_date TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			actual_amount REAL NOT NULL DEFAULT 0,
			price REAL NOT NULL DEFAULT 0,
			quantity REAL NOT NULL DEFAULT 0,
			fee REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			tx_id INTEGER NOT NULL DEFAULT 0,
			cash_flow_id INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT '',
			done_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dca_records_plan_date ON dca_records(plan_id, plan_date)`,
		`CREATE INDEX IF NOT EXISTS idx_dca_records_user ON dca_records(user_id, status)`,
	}
	for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			return err
		}
	}
	addColumnIfMissing("dca_plans", "fee_rate", "REAL NOT NULL DEFAULT 0")
	return nil
}

// ============================ 计划 CRUD ============================

func CreateDCAPlan(p *DCAPlan) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO dca_plans(user_id,holding_id,amount,interval,day_of_month,start_date,end_date,max_amount,fee_rate,status,cash_account_id,note,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.UserID, p.HoldingID, p.Amount, p.Interval, p.DayOfMonth, p.StartDate, p.EndDate, p.MaxAmount, p.FeeRate, p.Status, p.CashAccount, p.Note, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateDCAPlan(p *DCAPlan) error {
	_, err := DB.Exec(`UPDATE dca_plans SET holding_id=?,amount=?,interval=?,day_of_month=?,start_date=?,end_date=?,max_amount=?,fee_rate=?,status=?,cash_account_id=?,note=? WHERE id=? AND user_id=?`,
		p.HoldingID, p.Amount, p.Interval, p.DayOfMonth, p.StartDate, p.EndDate, p.MaxAmount, p.FeeRate, p.Status, p.CashAccount, p.Note, p.ID, p.UserID)
	return err
}

func SetDCAStatus(id, uid int64, status string) error {
	_, err := DB.Exec(`UPDATE dca_plans SET status=? WHERE id=? AND user_id=?`, status, id, uid)
	return err
}

func GetDCAPlan(id int64) (*DCAPlan, error) {
	var p DCAPlan
	err := DB.QueryRow(`SELECT id,user_id,holding_id,amount,interval,day_of_month,start_date,end_date,max_amount,fee_rate,status,cash_account_id,note,created_at
		FROM dca_plans WHERE id=?`, id).
		Scan(&p.ID, &p.UserID, &p.HoldingID, &p.Amount, &p.Interval, &p.DayOfMonth, &p.StartDate, &p.EndDate, &p.MaxAmount, &p.FeeRate, &p.Status, &p.CashAccount, &p.Note, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func ListDCAPlans(uid int64) ([]DCAPlan, error) {
	rows, err := DB.Query(`SELECT id,user_id,holding_id,amount,interval,day_of_month,start_date,end_date,max_amount,fee_rate,status,cash_account_id,note,created_at
		FROM dca_plans WHERE user_id=? ORDER BY
			CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, id DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DCAPlan
	for rows.Next() {
		var p DCAPlan
		if err := rows.Scan(&p.ID, &p.UserID, &p.HoldingID, &p.Amount, &p.Interval, &p.DayOfMonth, &p.StartDate, &p.EndDate, &p.MaxAmount, &p.FeeRate, &p.Status, &p.CashAccount, &p.Note, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListActiveDCAPlans 只返回在投的计划（自动补期用）。
func ListActiveDCAPlans(uid int64) ([]DCAPlan, error) {
	all, err := ListDCAPlans(uid)
	if err != nil {
		return nil, err
	}
	var out []DCAPlan
	for _, p := range all {
		if p.Status == "active" {
			out = append(out, p)
		}
	}
	return out, nil
}

// DeleteDCAPlan 删除计划及其未执行记录；已执行（done）记录存在时拒绝删除，
// 避免资金链路失去出处——这种情况应改用「暂停 / 结束」。
func DeleteDCAPlan(id, uid int64) (int64, error) {
	var done int
	if err := DB.QueryRow(`SELECT COUNT(1) FROM dca_records WHERE plan_id=? AND status='done'`, id).Scan(&done); err != nil {
		return 0, err
	}
	if done > 0 {
		return int64(done), fmt.Errorf("该计划已有 %d 期执行记录，只能暂停或结束，不能删除", done)
	}
	if _, err := DB.Exec(`DELETE FROM dca_records WHERE plan_id=?`, id); err != nil {
		return 0, err
	}
	if _, err := DB.Exec(`DELETE FROM dca_plans WHERE id=? AND user_id=?`, id, uid); err != nil {
		return 0, err
	}
	return 0, nil
}

// DeleteDCAPlansByHolding 持仓被删除时清理其定投数据（已执行记录一并清理：持仓本身已不存在）。
func DeleteDCAPlansByHolding(holdingID int64) error {
	if _, err := DB.Exec(`DELETE FROM dca_records WHERE holding_id=?`, holdingID); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM dca_plans WHERE holding_id=?`, holdingID)
	return err
}

// ============================ 补期（自动） ============================

// nextDCADate 由上一期日期推算下一期计划日（空则取首期 start_date）。
func NextDCADate(p DCAPlan, last string) string {
	if strings.TrimSpace(last) == "" {
		return p.StartDate
	}
	t, err := time.Parse("2006-01-02", last)
	if err != nil {
		return ""
	}
	switch p.Interval {
	case "daily":
		return t.AddDate(0, 0, 1).Format("2006-01-02")
	case "weekly":
		return t.AddDate(0, 0, 7).Format("2006-01-02")
	case "biweekly":
		return t.AddDate(0, 0, 14).Format("2006-01-02")
	case "quarterly":
		return alignMonthDay(t.AddDate(0, 3, 0), p.DayOfMonth)
	default: // monthly
		return alignMonthDay(t.AddDate(0, 1, 0), p.DayOfMonth)
	}
}

// alignMonthDay 把日期对齐到目标日；目标日超过当月天数时取月末（如 31 号 → 2/28）。
func alignMonthDay(t time.Time, day int) string {
	if day < 1 {
		day = 1
	}
	if day > 28 {
		if last := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day(); day > last {
			day = last
		}
	}
	return time.Date(t.Year(), t.Month(), day, 0, 0, 0, 0, t.Location()).Format("2006-01-02")
}

// lastDCADate 返回该计划已生成记录中最晚的一期日期（无记录返回 ""）。
func lastDCADate(planID int64) (string, error) {
	var d string
	err := DB.QueryRow(`SELECT COALESCE(MAX(plan_date),'') FROM dca_records WHERE plan_id=?`, planID).Scan(&d)
	return d, err
}

// dcaAmountFor 计算某期实际应投金额：受限购上限截断。
func dcaAmountFor(p DCAPlan) (float64, string) {
	amt := p.Amount
	note := ""
	if p.MaxAmount > 0 && amt > p.MaxAmount {
		amt = p.MaxAmount
		note = fmt.Sprintf("受限购上限 %g 调整", p.MaxAmount)
	}
	return amt, note
}

// EnsureDCARecords 为每个在投计划补齐「已到期但未生成」的期次（幂等，按 plan_date 唯一索引防重）。
// 只生成 plan_date <= 今天 的期；单轮最多补 24 期，避免旧计划一次性灌入大量历史待办。
func EnsureDCARecords(uid int64) (int, error) {
	today := time.Now().Format("2006-01-02")
	plans, err := ListActiveDCAPlans(uid)
	if err != nil {
		return 0, err
	}
	added := 0
	for _, p := range plans {
		last, err := lastDCADate(p.ID)
		if err != nil {
			continue
		}
		var seq int
		_ = DB.QueryRow(`SELECT COALESCE(MAX(seq),0) FROM dca_records WHERE plan_id=?`, p.ID).Scan(&seq)
		for i := 0; i < 24; i++ {
			d := NextDCADate(p, last)
			if d == "" || d > today {
				break
			}
			if p.EndDate != "" && d > p.EndDate {
				// 到截止日自动结束，不再生成新期
				_ = SetDCAStatus(p.ID, uid, "ended")
				break
			}
			amt, note := dcaAmountFor(p)
			seq++
			if err := InsertDCARecord(&DCARecord{
				UserID:    uid,
				PlanID:    p.ID,
				HoldingID: p.HoldingID,
				Seq:       seq,
				PlanDate:  d,
				Amount:    amt,
				Status:    "pending",
				Note:      note,
			}); err != nil {
				break // 唯一索引冲突（已生成）即停止
			}
			added++
			last = d
			if p.Interval == "daily" && i > 0 {
				// 日频也允许补多期，但上限 24 期
			}
		}
	}
	return added, nil
}

// ============================ 记录 CRUD ============================

func InsertDCARecord(r *DCARecord) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO dca_records(user_id,plan_id,holding_id,seq,plan_date,amount,actual_amount,price,quantity,fee,status,tx_id,cash_flow_id,note,created_at,done_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.UserID, r.PlanID, r.HoldingID, r.Seq, r.PlanDate, r.Amount, r.ActualAmount, r.Price, r.Quantity, r.Fee, r.Status, r.TxID, r.CashFlowID, r.Note, now, r.DoneAt)
	if err != nil {
		return err
	}
	r.ID, _ = res.LastInsertId()
	return nil
}

func GetDCARecord(id int64) (*DCARecord, error) {
	var r DCARecord
	err := DB.QueryRow(`SELECT id,user_id,plan_id,holding_id,seq,plan_date,amount,actual_amount,price,quantity,fee,status,tx_id,cash_flow_id,note,created_at,done_at
		FROM dca_records WHERE id=?`, id).
		Scan(&r.ID, &r.UserID, &r.PlanID, &r.HoldingID, &r.Seq, &r.PlanDate, &r.Amount, &r.ActualAmount, &r.Price, &r.Quantity, &r.Fee, &r.Status, &r.TxID, &r.CashFlowID, &r.Note, &r.CreatedAt, &r.DoneAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListDCARecords(planID int64) ([]DCARecord, error) {
	rows, err := DB.Query(`SELECT id,user_id,plan_id,holding_id,seq,plan_date,amount,actual_amount,price,quantity,fee,status,tx_id,cash_flow_id,note,created_at,done_at
		FROM dca_records WHERE plan_id=? ORDER BY plan_date DESC, id DESC`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DCARecord
	for rows.Next() {
		var r DCARecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.PlanID, &r.HoldingID, &r.Seq, &r.PlanDate, &r.Amount, &r.ActualAmount, &r.Price, &r.Quantity, &r.Fee, &r.Status, &r.TxID, &r.CashFlowID, &r.Note, &r.CreatedAt, &r.DoneAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListPendingDCARecords 返回某用户全部待确认期次（跨计划），按计划日升序。
func ListPendingDCARecords(uid int64) ([]DCARecord, error) {
	rows, err := DB.Query(`SELECT id,user_id,plan_id,holding_id,seq,plan_date,amount,actual_amount,price,quantity,fee,status,tx_id,cash_flow_id,note,created_at,done_at
		FROM dca_records WHERE user_id=? AND status='pending' ORDER BY plan_date ASC, id ASC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DCARecord
	for rows.Next() {
		var r DCARecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.PlanID, &r.HoldingID, &r.Seq, &r.PlanDate, &r.Amount, &r.ActualAmount, &r.Price, &r.Quantity, &r.Fee, &r.Status, &r.TxID, &r.CashFlowID, &r.Note, &r.CreatedAt, &r.DoneAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func SetDCARecordStatus(id int64, status string) error {
	_, err := DB.Exec(`UPDATE dca_records SET status=? WHERE id=?`, status, id)
	return err
}

// MarkDCARecordDone 落定一期执行结果（含联动的持仓流水与现金流水 id，供后续精确回滚）。
func MarkDCARecordDone(id int64, actualAmount, price, quantity, fee float64, txID, cashFlowID int64, note string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := DB.Exec(`UPDATE dca_records SET status='done', actual_amount=?, price=?, quantity=?, fee=?, tx_id=?, cash_flow_id=?, note=?, done_at=? WHERE id=?`,
		math.Round(actualAmount*100)/100, price, quantity, fee, txID, cashFlowID, note, now, id)
	return err
}

// ResetDCARecordPending 撤销执行后把记录退回待确认（清空成交字段与联动 id）。
func ResetDCARecordPending(id int64, note string) error {
	_, err := DB.Exec(`UPDATE dca_records SET status='pending', actual_amount=0, price=0, quantity=0, fee=0, tx_id=0, cash_flow_id=0, note=?, done_at='' WHERE id=?`, note, id)
	return err
}

// UpdateDCAPendingAmounts 计划金额/限购变更后，同步刷新其未执行期次的金额。
func UpdateDCAPendingAmounts(planID int64, amount, maxAmount float64) error {
	amt := amount
	if maxAmount > 0 && amt > maxAmount {
		amt = maxAmount
	}
	_, err := DB.Exec(`UPDATE dca_records SET amount=? WHERE plan_id=? AND status='pending'`, amt, planID)
	return err
}

// RevertBuyTx 精确回滚一次加仓：删除该条 position_tx 并按「加仓前」反算持仓数量与成本价。
// 不走反向 SELL，避免凭空产生已实现盈亏污染当日盈亏。
func RevertBuyTx(holdingID, txID int64) error {
	var typ string
	var qty, price, fee float64
	if err := DB.QueryRow(`SELECT tx_type,quantity,price,fee FROM position_tx WHERE id=? AND holding_id=?`, txID, holdingID).
		Scan(&typ, &qty, &price, &fee); err != nil {
		return fmt.Errorf("未找到该笔交易（tx=%d）", txID)
	}
	if typ != "BUY" {
		return fmt.Errorf("只能回滚加仓交易（tx=%d 为 %s）", txID, typ)
	}
	h, err := Get(holdingID)
	if err != nil {
		return err
	}
	oldQty := h.Quantity - qty
	if oldQty < -1e-9 {
		return fmt.Errorf("回滚数量超过当前份额，可能已被后续减仓影响（当前 %g，回滚 %g）", h.Quantity, qty)
	}
	if oldQty <= 1e-9 {
		oldQty = 0
		h.CostPrice = 0
	} else {
		// 加仓公式逆运算：newCost = (oldQty*oldCost + qty*price + fee) / newQty
		oldCost := (h.Quantity*h.CostPrice - qty*price - fee) / oldQty
		if oldCost < 0 {
			oldCost = 0
		}
		h.CostPrice = roundByCategory(h.Category, oldCost)
	}
	h.Quantity = oldQty
	if oldQty > 0 && h.Closed {
		h.Closed = false
	}
	if err := Update(h); err != nil {
		return err
	}
	_, err = DB.Exec(`DELETE FROM position_tx WHERE id=?`, txID)
	return err
}

// DeleteRealizedPnlByTx removes the realized-P&L ledger rows tied to a reverted SELL.
func DeleteRealizedPnlByTx(holdingID, txID int64) error {
	_, err := DB.Exec(`DELETE FROM realized_pnl_daily WHERE holding_id=? AND tx_id=?`, holdingID, txID)
	return err
}

// cashAccForRevert 定位回退时冲正的资金账户：优先用原交易记录的账户；不存在/非本人则
// 回落到该来源同币种余额最大的子账户，仍没有则现场补建（与 adjustHolding 同款口径）。
func cashAccForRevert(uid, cashAccID, sourceID int64, currency string) (*Cash, error) {
	if cashAccID > 0 {
		if acc, err := GetCash(cashAccID); err == nil && acc != nil && acc.UserID == uid {
			return acc, nil
		}
	}
	if acc, err := PickCashAccount(uid, sourceID, currency); err == nil && acc != nil {
		return acc, nil
	}
	if sourceID <= 0 {
		return nil, fmt.Errorf("没有可用的 %s 子账户", strings.ToUpper(NormCurrency(currency)))
	}
	id, err := EnsureCashForCurrency(uid, sourceID, "", currency)
	if err != nil {
		return nil, err
	}
	return GetCash(id)
}

// RevertHoldingTx 回退一笔持仓交易（LIFO：仅允许回退当前最新一笔），对称还原其对
// 持仓数量/成本价、资金账户余额、已实现盈亏台账的影响，并把原交易标记 reverted=1 保留审计。
//   - BUY：逆运算还原份额与平均成本，资金账户加回付款（数量×价+费）
//   - SELL：加回份额（清仓则恢复 LastQuantity/LastCostPrice），撤销已实现盈亏台账，资金账户扣回回款
//   - DIV：成本价加回每股分红，资金账户扣回分红入账并加回代扣费用
func RevertHoldingTx(holdingID, txID, uid int64) error {
	var typ string
	var qty, price, fee, realized, amount float64
	var cashAcc int64
	if err := DB.QueryRow(`SELECT tx_type,quantity,price,fee,realized_pnl,amount,cash_account_id FROM position_tx WHERE id=? AND holding_id=?`,
		txID, holdingID).Scan(&typ, &qty, &price, &fee, &realized, &amount, &cashAcc); err != nil {
		return fmt.Errorf("未找到该笔交易（tx=%d）", txID)
	}
	if typ != "BUY" && typ != "SELL" && typ != "DIV" && typ != "REINVEST" {
		return fmt.Errorf("不支持回退的交易类型 %s", typ)
	}
	// LIFO：仅最新一笔（按 id 最大且未回退）可回退，避免乱序导致平均成本错乱
	var latest int64
	if err := DB.QueryRow(`SELECT id FROM position_tx WHERE holding_id=? AND reverted=0 ORDER BY id DESC LIMIT 1`, holdingID).Scan(&latest); err != nil {
		return err
	}
	if latest != txID {
		return fmt.Errorf("只能回退最新一笔交易（请先回退较新的记录）")
	}
	h, err := Get(holdingID)
	if err != nil {
		return err
	}
	switch typ {
	case "BUY", "REINVEST":
		// REINVEST 与 BUY 同一套数量/成本还原；但 REINVEST 不联动现金（再投不出现金），跳过现金冲正。
		oldQty := h.Quantity - qty
		if oldQty < -1e-9 {
			return fmt.Errorf("回退数量超过当前份额（当前 %g，回退 %g），可能已被后续减仓影响", h.Quantity, qty)
		}
		if oldQty <= 1e-9 {
			oldQty = 0
			h.CostPrice = 0
		} else {
			oldCost := (h.Quantity*h.CostPrice - qty*price - fee) / oldQty
			if oldCost < 0 {
				oldCost = 0
			}
			h.CostPrice = roundByCategory(h.Category, oldCost)
		}
		h.Quantity = oldQty
		if typ == "REINVEST" {
			if err := Update(h); err != nil {
				return err
			}
			_, err = DB.Exec(`UPDATE position_tx SET reverted=1 WHERE id=?`, txID)
			return err
		}
		if oldQty > 0 && h.Closed {
			h.Closed = false
		}
		if acc, e := cashAccForRevert(uid, cashAcc, h.SourceID, h.Currency); e == nil {
			_ = AddCashAmount(acc.ID, qty*price+fee, "revert", "holding", h.ID, h.Name, "回退加仓付款")
		}
	case "SELL":
		if h.Closed && h.LastQuantity > 0 {
			h.Quantity = h.LastQuantity
			h.CostPrice = h.LastCostPrice
			h.Closed = false
		} else {
			h.Quantity = h.Quantity + qty
		}
		_ = DeleteRealizedPnlByTx(holdingID, txID)
		if acc, e := cashAccForRevert(uid, cashAcc, h.SourceID, h.Currency); e == nil {
			_ = AddCashAmount(acc.ID, -(qty*price - fee), "revert", "holding", h.ID, h.Name, "回退减仓回款")
		}
	case "DIV":
		newCost := roundByCategory(h.Category, h.CostPrice+price)
		if newCost < 0 {
			newCost = 0
		}
		h.CostPrice = newCost
		if acc, e := cashAccForRevert(uid, cashAcc, h.SourceID, h.Currency); e == nil {
			_ = AddCashAmount(acc.ID, -amount, "revert", "holding", h.ID, h.Name, "回退分红入账")
			if fee > 0 {
				_ = AddCashAmount(acc.ID, fee, "revert", "holding", h.ID, h.Name, "回退分红费用")
			}
		}
	}
	if err := Update(h); err != nil {
		return err
	}
	_, err = DB.Exec(`UPDATE position_tx SET reverted=1 WHERE id=?`, txID)
	return err
}

// DeleteDCARecordCascade 删除单期记录（仅未执行的允许删；已执行需先撤销）。
func DeleteDCARecordCascade(id int64) error {
	_, err := DB.Exec(`DELETE FROM dca_records WHERE id=? AND status!='done'`, id)
	return err
}

// LatestPositionTxID 返回该持仓最近一笔交易的 id（加仓后立即调用可定位本次流水）。
func LatestPositionTxID(holdingID int64) (int64, error) {
	var id int64
	err := DB.QueryRow(`SELECT id FROM position_tx WHERE holding_id=? ORDER BY id DESC LIMIT 1`, holdingID).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// DCAPlanStats 汇总某计划的期次统计。
func DCAPlanStats(planID int64) (pending, done, skipped int, doneAmount float64, err error) {
	rows, err := DB.Query(`SELECT status, COUNT(1), COALESCE(SUM(actual_amount),0) FROM dca_records WHERE plan_id=? GROUP BY status`, planID)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		var amt float64
		if err := rows.Scan(&st, &n, &amt); err != nil {
			continue
		}
		switch st {
		case "pending":
			pending = n
		case "done":
			done = n
			doneAmount = amt
		case "skipped":
			skipped = n
		}
	}
	return pending, done, skipped, doneAmount, rows.Err()
}
