package db

import (
	"database/sql"
	"time"
)

// ManualClosed 是「已平仓记录」里用户纯手动补录的一类：只记录名称/盈亏金额/备注/类型，
// 与持仓、现金完全隔离（不入账），用于补登系统之外发生的平仓（如线下清仓、朋友代持了结）。
// 系统自动归集的已平仓（持仓 quantity<=0 或理财 archived=1）不在此表，单独在已平仓视图合并展示。
type ManualClosed struct {
	ID          int64    `json:"id"`
	UserID      int64    `json:"user_id"`
	Kind        string   `json:"kind"`         // stock（股票）| fund（基金）| wealth（理财）
	Code        string   `json:"code"`         // 代码（股票/基金代码或理财产品代码，可空）
	Name        string   `json:"name"`         // 名称
	Amount      float64  `json:"amount"`       // 盈亏金额（正=赚，负=亏）
	Principal   *float64 `json:"principal"`    // 本金（可空：留空表示不参与收益率计算）
	ReturnRate  *float64 `json:"return_rate"`  // 持有期收益率 %（可空：留空表示按 盈亏÷本金 推算）
	Note        string   `json:"note"`         // 备注（前端已下线输入，保留列兼容旧数据）
	HoldingDays int      `json:"holding_days"` // 持仓天数
	Source      string   `json:"source"`       // 来源/账户名（下拉取自 asset_sources，纯文本不关联）
	RealizedAt  string   `json:"realized_at"`  // 清仓时间 YYYY-MM-DD
	CreatedAt   string   `json:"created_at"`
}

func initManualClosed() error {
	if _, err := DB.Exec(`CREATE TABLE IF NOT EXISTS manual_closed_records (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id       INTEGER NOT NULL DEFAULT 0,
		kind          TEXT NOT NULL DEFAULT 'stock',
		code          TEXT NOT NULL DEFAULT '',
		name          TEXT NOT NULL DEFAULT '',
		amount        REAL NOT NULL DEFAULT 0,
		note          TEXT NOT NULL DEFAULT '',
		holding_days  INTEGER NOT NULL DEFAULT 0,
		source        TEXT NOT NULL DEFAULT '',
		realized_at   TEXT NOT NULL DEFAULT '',
		created_at    TEXT NOT NULL DEFAULT '',
		principal     REAL,
		return_rate   REAL
	)`); err != nil {
		return err
	}
	addColumnIfMissing("manual_closed_records", "realized_at", "TEXT NOT NULL DEFAULT ''")
	addColumnIfMissing("manual_closed_records", "code", "TEXT NOT NULL DEFAULT ''")
	// 本金 / 收益率：可空（NULL = 用户没填）。用 NULL 而不是 0，才能区分「收益率为 0%」与「未填」——
	// 前者决定表格显示 +0.00% 还是显示「—」。
	addColumnIfMissing("manual_closed_records", "principal", "REAL")
	addColumnIfMissing("manual_closed_records", "return_rate", "REAL")
	// 类型口径变更：hold（持仓）拆成 stock（股票）/ fund（基金），历史 hold 一律归为股票。
	// 幂等：第二次启动时已无 kind='hold' 的行。
	DB.Exec(`UPDATE manual_closed_records SET kind='stock' WHERE kind='hold'`)
	return nil
}

// ListManualClosed 返回某用户全部手动已平仓记录，按清仓时间倒序（无时间排最后）。
func ListManualClosed(uid int64) ([]ManualClosed, error) {
	rows, err := DB.Query(`SELECT id,user_id,kind,code,name,amount,note,holding_days,source,realized_at,created_at,principal,return_rate
		FROM manual_closed_records WHERE user_id=?
		ORDER BY CASE WHEN realized_at='' THEN 1 ELSE 0 END, realized_at DESC, id DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManualClosed
	for rows.Next() {
		var m ManualClosed
		var principal, rate sql.NullFloat64
		if err := rows.Scan(&m.ID, &m.UserID, &m.Kind, &m.Code, &m.Name, &m.Amount, &m.Note, &m.HoldingDays, &m.Source, &m.RealizedAt, &m.CreatedAt, &principal, &rate); err != nil {
			return nil, err
		}
		if principal.Valid {
			v := principal.Float64
			m.Principal = &v
		}
		if rate.Valid {
			v := rate.Float64
			m.ReturnRate = &v
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// nullFloat 把可空金额写成 SQL NULL（nil → NULL），避免「未填」被当成 0。
func nullFloat(p *float64) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

// CreateManualClosed 新增一条手动已平仓记录，返回新 id。
func CreateManualClosed(m *ManualClosed) (int64, error) {
	res, err := DB.Exec(`INSERT INTO manual_closed_records(user_id,kind,code,name,amount,note,holding_days,source,realized_at,created_at,principal,return_rate)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		m.UserID, normKind(m.Kind), m.Code, m.Name, m.Amount, m.Note, m.HoldingDays, m.Source, m.RealizedAt, nowStr(),
		nullFloat(m.Principal), nullFloat(m.ReturnRate))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, nil
}

// UpdateManualClosed 修改手动记录（金额/本金/收益率/天数/名称/代码/来源/类型/清仓时间）。
// 备注（note）字段已在界面上下线，UPDATE 不再写入它 —— 否则前端提交时缺该键会把老备注清空。
func UpdateManualClosed(m *ManualClosed) error {
	_, err := DB.Exec(`UPDATE manual_closed_records
		SET kind=?,code=?,name=?,amount=?,principal=?,return_rate=?,holding_days=?,source=?,realized_at=?
		WHERE id=? AND user_id=?`,
		normKind(m.Kind), m.Code, m.Name, m.Amount, nullFloat(m.Principal), nullFloat(m.ReturnRate),
		m.HoldingDays, m.Source, m.RealizedAt, m.ID, m.UserID)
	return err
}

// DeleteManualClosed 删除手动记录（仅本人）。
func DeleteManualClosed(uid, id int64) error {
	_, err := DB.Exec(`DELETE FROM manual_closed_records WHERE id=? AND user_id=?`, id, uid)
	return err
}

// ReopenHolding 撤销清仓/重开持仓：用清仓前快照（last_quantity/last_cost_price）还原份额与成本，
// 并取消 closed 标记。仅当该持仓当前确为 closed 且快照份额 > 0 时生效（幂等：已重开的不会再动）。
// 与 AdjustHolding 的清仓逻辑可逆——清仓时保留快照、份额归零；此处据此还原。
func ReopenHolding(id int64) (*Holding, error) {
	cur, err := Get(id)
	if err != nil {
		return nil, err
	}
	if !cur.Closed {
		return cur, nil // 已重开，幂等返回
	}
	if cur.LastQuantity <= 0 {
		return nil, sql.ErrNoRows // 无快照可还原（异常清仓），不上演
	}
	cur.Quantity = cur.LastQuantity
	cur.CostPrice = cur.LastCostPrice
	cur.Closed = false
	cur.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
	if err := reopenHoldingExec(cur); err != nil {
		return nil, err
	}
	return cur, nil
}

func reopenHoldingExec(cur *Holding) error {
	_, err := DB.Exec(`UPDATE holdings SET quantity=?,cost_price=?,closed=0,updated_at=? WHERE id=?`,
		cur.Quantity, cur.CostPrice, cur.UpdatedAt, cur.ID)
	return err
}

// normKind 规整类型取值：stock（股票）/ fund（基金）/ wealth（理财），未知与历史 hold 一律按股票。
func normKind(k string) string {
	switch k {
	case "fund":
		return "fund"
	case "wealth":
		return "wealth"
	}
	return "stock"
}

func nowStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}
