package db

import (
	"database/sql"
	"time"
)

// RebalanceLog 再平衡快照（2026-10-27）。
// 每次点「记录本次再平衡」写一条：保存当日总市值、目标配置、实际配置与当时勾选的
// 调整动作。目的是能回看「上次是什么时候、按什么目标、做了哪些动作」，
// 而不是让再平衡变成一次性计算。
type RebalanceLog struct {
	ID      int64   `json:"id"`
	UserID  int64   `json:"user_id"`
	Date    string  `json:"date"`     // 再平衡日期（北京时区 YYYY-MM-DD）
	TotalCNY float64 `json:"total_cny"` // 当时组合总市值（折 CNY）
	// TargetsJSON / ActualJSON 均为 [{"key":"stock","pct":20.0}] 结构：
	// 存当时的百分比快照而非引用当前配置，否则回看历史会被新目标污染。
	TargetsJSON string  `json:"targets_json"`
	ActualJSON  string  `json:"actual_json"`
	// ActionsJSON 为当时勾选的调整动作 [{"key":"stock","action":"sell","amount":1234.5}]
	ActionsJSON string  `json:"actions_json"`
	MaxDrift    float64 `json:"max_drift"` // 当时最大偏离（百分点，带符号）
	// 收益快照（2026-10-27 追加）：再平衡的核心不只是比例，还有「按目标配能得到多少收益」。
	// 必须落库而不是用当前假设反推 —— 假设会随用户调整而变，历史一旦被污染就失去回看价值。
	RetTarget float64 `json:"ret_target"` // 目标配置的加权预期年化 %
	RetActual float64 `json:"ret_actual"` // 实际配置的加权预期年化 %
	VolTarget float64 `json:"vol_target"` // 目标配置波动率（简单加权）%
	VolActual float64 `json:"vol_actual"` // 实际配置波动率（简单加权）%
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

// initRebalance 建表 + 索引（幂等）。与 initDeposits 同批在 Init 末尾调用。
func initRebalance() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS rebalance_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL DEFAULT 0,
		date TEXT NOT NULL DEFAULT '',
		total_cny REAL NOT NULL DEFAULT 0,
		targets_json TEXT NOT NULL DEFAULT '[]',
		actual_json TEXT NOT NULL DEFAULT '[]',
		actions_json TEXT NOT NULL DEFAULT '[]',
		max_drift REAL NOT NULL DEFAULT 0,
		ret_target REAL NOT NULL DEFAULT 0,
		ret_actual REAL NOT NULL DEFAULT 0,
		vol_target REAL NOT NULL DEFAULT 0,
		vol_actual REAL NOT NULL DEFAULT 0,
		note TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return err
	}
	// 列表按 user_id + date 倒序取最近 N 条，复合索引避免全表扫。
	// 存量库补列（本表 2026-10-27 才第一次上线，这里仍然走幂等迁移，避免测试库/旧备份升级时炸）
	addColumnIfMissing("rebalance_log", "ret_target", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("rebalance_log", "ret_actual", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("rebalance_log", "vol_target", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("rebalance_log", "vol_actual", "REAL NOT NULL DEFAULT 0")
	_, err = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_rebalance_log_user_date ON rebalance_log(user_id, date DESC, id DESC)`)
	return err
}

// CreateRebalanceLog 追加一条再平衡记录，返回自增 ID。
func CreateRebalanceLog(l *RebalanceLog) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	if l.CreatedAt == "" {
		l.CreatedAt = now
	}
	res, err := DB.Exec(`INSERT INTO rebalance_log(user_id,date,total_cny,targets_json,actual_json,actions_json,max_drift,ret_target,ret_actual,vol_target,vol_actual,note,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		l.UserID, l.Date, l.TotalCNY, l.TargetsJSON, l.ActualJSON, l.ActionsJSON, l.MaxDrift,
		l.RetTarget, l.RetActual, l.VolTarget, l.VolActual, l.Note, l.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListRebalanceLogs 返回该用户最近 limit 条记录（按日期倒序，同日按 ID 倒序）。
func ListRebalanceLogs(userID int64, limit int) ([]RebalanceLog, error) {
	if limit <= 0 || limit > 100 {
		limit = 24
	}
	rows, err := DB.Query(`SELECT id,user_id,date,total_cny,targets_json,actual_json,actions_json,max_drift,
		ret_target,ret_actual,vol_target,vol_actual,note,created_at
		FROM rebalance_log WHERE user_id=? ORDER BY date DESC, id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RebalanceLog, 0, limit)
	for rows.Next() {
		var l RebalanceLog
		if err := rows.Scan(&l.ID, &l.UserID, &l.Date, &l.TotalCNY, &l.TargetsJSON, &l.ActualJSON,
			&l.ActionsJSON, &l.MaxDrift, &l.RetTarget, &l.RetActual, &l.VolTarget, &l.VolActual,
			&l.Note, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// LastRebalanceLog 取最近一次记录；无记录时 ok=false（不报错，调用方按「从未再平衡」处理）。
func LastRebalanceLog(userID int64) (*RebalanceLog, bool, error) {
	var l RebalanceLog
	err := DB.QueryRow(`SELECT id,user_id,date,total_cny,targets_json,actual_json,actions_json,max_drift,
		ret_target,ret_actual,vol_target,vol_actual,note,created_at
		FROM rebalance_log WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 1`, userID).
		Scan(&l.ID, &l.UserID, &l.Date, &l.TotalCNY, &l.TargetsJSON, &l.ActualJSON,
			&l.ActionsJSON, &l.MaxDrift, &l.RetTarget, &l.RetActual, &l.VolTarget, &l.VolActual,
			&l.Note, &l.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &l, true, nil
}

// DeleteRebalanceLog 删除一条记录（仅本人）。
func DeleteRebalanceLog(id, userID int64) error {
	_, err := DB.Exec(`DELETE FROM rebalance_log WHERE id=? AND user_id=?`, id, userID)
	return err
}
