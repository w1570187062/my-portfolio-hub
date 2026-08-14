package db

import (
	"database/sql"
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
//  3. 重建需要复合主键的表（pnl_daily / calc_inputs / ai_settings）以支持按用户隔离；
//  4. 若 users 表为空，创建默认用户"默认"，并把所有现存数据归属到该用户。
func EnsureUsers() error {
	if err := initUsers(); err != nil {
		return err
	}
	// 1) 为子表补充 user_id 列
	for _, t := range []string{
		"holdings", "asset_sources", "wealth_products", "liabilities",
		"cash_accounts", "consumptions", "ai_summary_history", "operation_guides",
	} {
		addColumnIfMissing(t, "user_id", "INTEGER NOT NULL DEFAULT 0")
	}
	// 2) 重建需要按用户隔离主键的表
	if err := rebuildPnlDaily(); err != nil {
		return err
	}
	if err := rebuildCalcInputs(); err != nil {
		return err
	}
	if err := rebuildAISettings(); err != nil {
		return err
	}
	// 3) 默认用户 + 回填
	users, err := ListUsers()
	if err != nil {
		return err
	}
	if len(users) == 0 {
		if _, e := CreateUser("默认"); e != nil {
			return e
		}
		users, _ = ListUsers()
	}
	if len(users) > 0 {
		def := users[0].ID
		backfillUser(def)
	}
	return nil
}

// backfillUser 把所有 user_id 为 0/NULL 的现存行归属到指定默认用户。
func backfillUser(def int64) {
	tables := []string{
		"holdings", "asset_sources", "wealth_products", "liabilities",
		"cash_accounts", "consumptions", "ai_summary_history", "operation_guides",
		"pnl_daily", "calc_inputs", "ai_settings",
	}
	for _, t := range tables {
		// 忽略不存在的列（安全）
		_, _ = DB.Exec(fmt.Sprintf("UPDATE %s SET user_id=? WHERE COALESCE(user_id,0)=0", t), def)
	}
}

// rebuildPnlDaily 将 pnl_daily(date) 改为 (date, user_id)，并保留既有数据（归属默认用户）。
func rebuildPnlDaily() error {
	has, _ := columnExists("pnl_daily", "user_id")
	if has {
		return nil
	}
	_, err := DB.Exec(`ALTER TABLE pnl_daily RENAME TO pnl_daily_old`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`CREATE TABLE pnl_daily (
		date TEXT NOT NULL,
		user_id INTEGER NOT NULL DEFAULT 0,
		total_cny REAL NOT NULL DEFAULT 0,
		total_usd REAL NOT NULL DEFAULT 0,
		rate REAL NOT NULL DEFAULT 0,
		detail TEXT NOT NULL DEFAULT '{}',
		PRIMARY KEY (date, user_id)
	)`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`INSERT INTO pnl_daily(date,user_id,total_cny,total_usd,rate,detail)
		SELECT date, 0, total_cny, total_usd, rate, detail FROM pnl_daily_old`)
	if err != nil {
		return err
	}
	_, _ = DB.Exec(`DROP TABLE pnl_daily_old`)
	return nil
}

// rebuildCalcInputs 将 calc_inputs(kind) 改为 (kind, user_id)。
func rebuildCalcInputs() error {
	has, _ := columnExists("calc_inputs", "user_id")
	if has {
		return nil
	}
	_, err := DB.Exec(`ALTER TABLE calc_inputs RENAME TO calc_inputs_old`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`CREATE TABLE calc_inputs (
		kind TEXT NOT NULL,
		user_id INTEGER NOT NULL DEFAULT 0,
		payload TEXT NOT NULL DEFAULT '[]',
		updated_at TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (kind, user_id)
	)`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`INSERT INTO calc_inputs(kind,user_id,payload,updated_at)
		SELECT kind, 0, payload, updated_at FROM calc_inputs_old`)
	if err != nil {
		return err
	}
	_, _ = DB.Exec(`DROP TABLE calc_inputs_old`)
	return nil
}

// rebuildAISettings 将 ai_settings(id=1) 改为以 user_id 为主键。
func rebuildAISettings() error {
	has, _ := columnExists("ai_settings", "user_id")
	if has {
		return nil
	}
	_, err := DB.Exec(`ALTER TABLE ai_settings RENAME TO ai_settings_old`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`CREATE TABLE ai_settings (
		user_id INTEGER NOT NULL DEFAULT 0,
		cfg TEXT NOT NULL DEFAULT '{}',
		PRIMARY KEY (user_id)
	)`)
	if err != nil {
		return err
	}
	_, err = DB.Exec(`INSERT INTO ai_settings(user_id,cfg) SELECT 0, cfg FROM ai_settings_old`)
	if err != nil {
		return err
	}
	_, _ = DB.Exec(`DROP TABLE ai_settings_old`)
	return nil
}

func columnExists(table, col string) (bool, error) {
	rows, err := DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err == nil && name == col {
			return true, nil
		}
	}
	return false, rows.Err()
}

// ---- users CRUD ----

func CreateUser(name string) (int64, error) {
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

func GetUser(id int64) (User, bool, error) {
	var u User
	err := DB.QueryRow(`SELECT id,name,created_at FROM users WHERE id=?`, id).Scan(&u.ID, &u.Name, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return u, false, nil
	}
	if err != nil {
		return u, false, err
	}
	return u, true, nil
}

// CountUserData 统计某用户名下各维度的数据条数，用于设置面板展示。
func CountUserData(userID int64) (map[string]int, error) {
	out := map[string]int{}
	tables := []string{
		"holdings", "asset_sources", "wealth_products", "liabilities",
		"cash_accounts", "consumptions", "operation_guides", "ai_summary_history",
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
	// 合计条数（不含 ai 历史这类偏配置性的）
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
	if _, err := DB.Exec(`DELETE FROM ai_summary_history WHERE user_id=?`, userID); err != nil {
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
	_, err = DB.Exec(`DELETE FROM users WHERE id=?`, userID)
	return err
}
