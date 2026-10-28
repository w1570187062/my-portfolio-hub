package db

import (
	"fmt"
	"time"
)

// User 表示一个独立的账户（多用户体系）。账户数据通过 user_id 与各类数据表关联。
// 移除原 auth 登录逻辑后，当前用户由前端在请求头 X-User-Id 中携带，后端按此隔离数据。
type User struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// ---- users 表 ----

func initUsers() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

// EnsureUsers 在启动时保证多用户体系就绪：
//  1. 创建 users 表；
//  2. 为所有现存数据表补充 user_id 列（幂等）；
//  3. 若 users 表为空，创建默认用户"默认"。
//
// 注：pnl_daily / price_daily / calc_inputs / ai_settings 的表结构已由 db.Init 按最新
// 多用户复合主键直接创建，无需再执行重建迁移。
func EnsureUsers() error {
	if err := initUsers(); err != nil {
		return err
	}
	// 认证层：设备会话 / 授权账本 / 配对码 / PIN（表结构与业务表解耦，幂等）
	if err := EnsureSessions(); err != nil {
		return err
	}
	// 为子表补充 user_id 列（幂等，新库 Init 已包含 user_id 列时自动跳过）
	for _, t := range []string{
		"holdings", "asset_sources", "wealth_products", "liabilities",
		"cash_accounts", "consumptions", "operation_guides", "dca_plans",
	} {
		addColumnIfMissing(t, "user_id", "INTEGER NOT NULL DEFAULT 0")
	}
	// pnl_daily 兼容旧库：新增 base_cny（新库 Init 已包含此列）
	addColumnIfMissing("pnl_daily", "base_cny", "REAL NOT NULL DEFAULT 0")
	// 默认用户：若 users 表为空，创建"默认"
	if _, err := ListUsers(); err != nil {
		return err
	}
	users, _ := ListUsers()
	if len(users) == 0 {
		if _, e := CreateUser("默认"); e != nil {
			return e
		}
	}
	return nil
}

// ---- users CRUD ----

func CreateUser(name string) (int64, error) {
	// 用户总数上限：右上角可切换的用户最多 MaxUsers 个。
	var n int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, err
	}
	if n >= MaxUsers {
		return 0, ErrUserLimit
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO users(name,created_at) VALUES(?,?)`, name, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func ListUsers() ([]User, error) {
	rows, err := DB.Query(`SELECT id,name,created_at FROM users ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// GetUser 按 id 查询单个用户；不存在返回 sql.ErrNoRows。
func GetUser(id int64) (*User, error) {
	var u User
	err := DB.QueryRow(`SELECT id,name,created_at FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Name, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByName 按用户名（精确匹配）查询单个用户；不存在返回 sql.ErrNoRows。
func GetUserByName(name string) (*User, error) {
	var u User
	err := DB.QueryRow(`SELECT id,name,created_at FROM users WHERE name=?`, name).
		Scan(&u.ID, &u.Name, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// CountUserData 统计某用户名下各维度的数据条数，用于设置面板展示。
func CountUserData(userID int64) (map[string]int, error) {
	out := map[string]int{}
	tables := []string{
		"holdings", "asset_sources", "wealth_products", "liabilities",
		"cash_accounts", "consumptions", "operation_guides", "dca_plans",
	}
	for _, t := range tables {
		var n int
		if err := DB.QueryRow(fmt.Sprintf("SELECT COUNT(1) FROM %s WHERE user_id=?", t), userID).Scan(&n); err != nil {
			return nil, err
		}
		out[t] = n
	}
	// 加减仓交易（通过 holding 关联）
	var txn int
	if err := DB.QueryRow(`SELECT COUNT(1) FROM position_tx WHERE holding_id IN (SELECT id FROM holdings WHERE user_id=?)`, userID).Scan(&txn); err != nil {
		return nil, err
	}
	out["position_tx"] = txn
	// 合计条数（不含 AI 设置这类偏配置性的）
	total := out["holdings"] + out["asset_sources"] + out["wealth_products"] + out["liabilities"] +
		out["cash_accounts"] + out["consumptions"] + out["operation_guides"] + out["position_tx"]
	out["total"] = total
	return out, nil
}

// ClearUserData 清空某用户的全部账户数据（不删除用户本身）。
// 级联删除：holdings 及其 position_tx / buy_plan_executed / operation_guides / price_daily / pnl_daily，
// 以及资产全景（sources/wealth/现金/负债/消费）。
func ClearUserData(userID int64) error {
	// 持仓关联明细
	if _, err := DB.Exec(`DELETE FROM position_tx WHERE holding_id IN (SELECT id FROM holdings WHERE user_id=?)`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM buy_plan_executed WHERE holding_id IN (SELECT id FROM holdings WHERE user_id=?)`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM operation_guides WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM price_daily WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM pnl_daily WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM dca_records WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM dca_plans WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM holdings WHERE user_id=?`, userID); err != nil {
		return err
	}
	// 资产全景
	if _, err := DB.Exec(`DELETE FROM consumptions WHERE user_id=?`, userID); err != nil {
		return err
	}
	// wealth / cash / liabilities 经 source 级联
	srcs, _ := ListSources(userID)
	for _, s := range srcs {
		if s.UserID != userID {
			continue
		}
		ws, _ := ListWealthBySource(s.ID)
		for _, w := range ws {
			_, _ = DB.Exec(`DELETE FROM wealth_snapshots WHERE wealth_id=?`, w.ID)
		}
		_, _ = DB.Exec(`DELETE FROM wealth_products WHERE source_id=?`, s.ID)
		_, _ = DB.Exec(`DELETE FROM liabilities WHERE source_id=?`, s.ID)
		_, _ = DB.Exec(`DELETE FROM cash_accounts WHERE source_id=?`, s.ID)
	}
	if _, err := DB.Exec(`DELETE FROM asset_sources WHERE user_id=?`, userID); err != nil {
		return err
	}
	// 计算器 / AI
	if _, err := DB.Exec(`DELETE FROM calc_inputs WHERE user_id=?`, userID); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM ai_settings WHERE user_id=?`, userID); err != nil {
		return err
	}
	// AI 助手会话（ai_chats + ai_chat_messages）
	if err := DeleteAIChatsByUser(userID); err != nil {
		return err
	}
	return nil
}

// DeleteUser 删除用户及其全部账户数据。要求至少保留一个用户（不允许删光）。
func DeleteUser(userID int64) error {
	users, err := ListUsers()
	if err != nil {
		return err
	}
	if len(users) <= 1 {
		return fmt.Errorf("至少需保留一个用户，无法删除最后一个用户")
	}
	if err := ClearUserData(userID); err != nil {
		return err
	}
	// 会话授权：删用户后必须清理，否则残留的 user_id 会在新用户复用同一 id 时继承旧授权
	if _, err := DB.Exec(`DELETE FROM session_users WHERE user_id=?`, userID); err != nil {
		return err
	}
	_, err = DB.Exec(`DELETE FROM users WHERE id=?`, userID)
	return err
}
