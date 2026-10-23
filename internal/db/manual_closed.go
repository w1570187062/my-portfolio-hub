package db

import (
	"database/sql"
	"time"
)

// ManualClosed 是「已平仓记录」里用户纯手动补录的一类：只记录名称/盈亏金额/备注/类型，
// 与持仓、现金完全隔离（不入账），用于补登系统之外发生的平仓（如线下清仓、朋友代持了结）。
// 系统自动归集的已平仓（持仓 quantity<=0 或理财 archived=1）不在此表，单独在已平仓视图合并展示。
type ManualClosed struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"user_id"`
	Kind        string  `json:"kind"`         // hold（持仓类）| wealth（理财类）
	Name        string  `json:"name"`         // 名称
	Amount      float64 `json:"amount"`       // 盈亏金额（正=赚，负=亏）
	Note        string  `json:"note"`         // 备注
	HoldingDays int     `json:"holding_days"` // 持仓天数
	Source      string  `json:"source"`       // 来源/账户名（纯文本，不关联 asset_sources）
	RealizedAt  string  `json:"realized_at"`  // 清仓时间 YYYY-MM-DD
	CreatedAt   string  `json:"created_at"`
}

func initManualClosed() error {
	if _, err := DB.Exec(`CREATE TABLE IF NOT EXISTS manual_closed_records (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id       INTEGER NOT NULL DEFAULT 0,
		kind          TEXT NOT NULL DEFAULT 'hold',
		name          TEXT NOT NULL DEFAULT '',
		amount        REAL NOT NULL DEFAULT 0,
		note          TEXT NOT NULL DEFAULT '',
		holding_days  INTEGER NOT NULL DEFAULT 0,
		source        TEXT NOT NULL DEFAULT '',
		realized_at   TEXT NOT NULL DEFAULT '',
		created_at    TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		return err
	}
	addColumnIfMissing("manual_closed_records", "realized_at", "TEXT NOT NULL DEFAULT ''")
	return nil
}

// ListManualClosed 返回某用户全部手动已平仓记录，按清仓时间倒序（无时间排最后）。
func ListManualClosed(uid int64) ([]ManualClosed, error) {
	rows, err := DB.Query(`SELECT id,user_id,kind,name,amount,note,holding_days,source,realized_at,created_at
		FROM manual_closed_records WHERE user_id=?
		ORDER BY CASE WHEN realized_at='' THEN 1 ELSE 0 END, realized_at DESC, id DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManualClosed
	for rows.Next() {
		var m ManualClosed
		if err := rows.Scan(&m.ID, &m.UserID, &m.Kind, &m.Name, &m.Amount, &m.Note, &m.HoldingDays, &m.Source, &m.RealizedAt, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateManualClosed 新增一条手动已平仓记录，返回新 id。
func CreateManualClosed(m *ManualClosed) (int64, error) {
	res, err := DB.Exec(`INSERT INTO manual_closed_records(user_id,kind,name,amount,note,holding_days,source,realized_at,created_at)
		VALUES(?,?,?,?,?,?,?,?,?)`,
		m.UserID, normKind(m.Kind), m.Name, m.Amount, m.Note, m.HoldingDays, m.Source, m.RealizedAt, nowStr())
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, nil
}

// UpdateManualClosed 修改手动记录（金额/天数/名称/备注/来源/类型/清仓时间）。
func UpdateManualClosed(m *ManualClosed) error {
	_, err := DB.Exec(`UPDATE manual_closed_records
		SET kind=?,name=?,amount=?,note=?,holding_days=?,source=?,realized_at=?
		WHERE id=? AND user_id=?`,
		normKind(m.Kind), m.Name, m.Amount, m.Note, m.HoldingDays, m.Source, m.RealizedAt, m.ID, m.UserID)
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

// normKind 规整类型取值，未知默认 hold。
func normKind(k string) string {
	if k == "wealth" {
		return "wealth"
	}
	return "hold"
}

func nowStr() string {
	return time.Now().Format("2006-01-02 15:04:05")
}
