package db

import (
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// ---- 止盈止损 / 价格提醒事件（站内通知中心的数据源）----
//
// 一张表承担三件事：消息中心列表、去重（dedupe_key 唯一）、推送状态回执。
// 之所以不塞进 notify_settings：通知是流式流水（可能上千条），配置是单条 JSON，
// 混在一起会让「已读」变成整块 JSON 重写，且无法用 SQL 分页。

type AlertEvent struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	HoldingID int64   `json:"holding_id"`
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`   // take_profit | stop_loss | trailing | psych | fee_window
	Level     int     `json:"level"`  // 止盈档位 1/2/3；其它类型固定 1
	Price     float64 `json:"price"`  // 触发时价格
	Target    float64 `json:"target"` // 触发阈值（止盈价 / 止损价 / 心理价）
	Cost      float64 `json:"cost"`
	PnlPct    float64 `json:"pnl_pct"`    // 相对成本涨跌 %
	FeePct    float64 `json:"fee_pct"`    // 当前赎回费率 %
	NetAmount float64 `json:"net_amount"` // 扣费后净到手金额（持仓币种）
	// IsFund 是否有赎回费概念（场外基金）。列表接口按 holdings 现算，不冗余存列：
	// 持仓的 category / linked_symbol 改过后，历史事件也能立刻跟着变对。
	IsFund    bool   `json:"is_fund"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	DedupeKey string `json:"dedupe_key"`
	PushState string `json:"push_state"` // none | sent | failed
	CreatedAt string `json:"created_at"`
	ReadAt    string `json:"read_at"`
}

func initAlertEvents() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS alert_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL DEFAULT 0,
		holding_id INTEGER NOT NULL DEFAULT 0,
		symbol TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL DEFAULT '',
		level INTEGER NOT NULL DEFAULT 1,
		price REAL NOT NULL DEFAULT 0,
		target REAL NOT NULL DEFAULT 0,
		cost REAL NOT NULL DEFAULT 0,
		pnl_pct REAL NOT NULL DEFAULT 0,
		fee_pct REAL NOT NULL DEFAULT 0,
		net_amount REAL NOT NULL DEFAULT 0,
		title TEXT NOT NULL DEFAULT '',
		body TEXT NOT NULL DEFAULT '',
		dedupe_key TEXT NOT NULL DEFAULT '',
		push_state TEXT NOT NULL DEFAULT 'none',
		created_at TEXT NOT NULL DEFAULT '',
		read_at TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return err
	}
	// 去重靠唯一索引保证（并发扫描时也不会重复落库）
	if _, err := DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_alert_dedupe ON alert_events(dedupe_key)`); err != nil {
		return err
	}
	_, err = DB.Exec(`CREATE INDEX IF NOT EXISTS ix_alert_user ON alert_events(user_id, id DESC)`)
	return err
}

// InsertAlert 落一条提醒事件。dedupe_key 冲突时静默忽略，返回 inserted=false。
func InsertAlert(a *AlertEvent) (bool, error) {
	if a.CreatedAt == "" {
		a.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	}
	if a.PushState == "" {
		a.PushState = "none"
	}
	res, err := DB.Exec(`INSERT OR IGNORE INTO alert_events
		(user_id,holding_id,symbol,name,kind,level,price,target,cost,pnl_pct,fee_pct,net_amount,title,body,dedupe_key,push_state,created_at,read_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'')`,
		a.UserID, a.HoldingID, a.Symbol, a.Name, a.Kind, a.Level, a.Price, a.Target, a.Cost,
		a.PnlPct, a.FeePct, a.NetAmount, a.Title, a.Body, a.DedupeKey, a.PushState, a.CreatedAt)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return false, nil
	}
	a.ID, _ = res.LastInsertId()
	return true, nil
}

func scanAlerts(rows *sql.Rows) ([]AlertEvent, error) {
	defer rows.Close()
	out := []AlertEvent{}
	for rows.Next() {
		var a AlertEvent
		if err := rows.Scan(&a.ID, &a.UserID, &a.HoldingID, &a.Symbol, &a.Name, &a.Kind, &a.Level,
			&a.Price, &a.Target, &a.Cost, &a.PnlPct, &a.FeePct, &a.NetAmount,
			&a.Title, &a.Body, &a.DedupeKey, &a.PushState, &a.CreatedAt, &a.ReadAt, &a.IsFund); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListAlerts 按时间倒序取提醒；unreadOnly 只取未读。
func ListAlerts(uid int64, limit int, unreadOnly bool) ([]AlertEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	// is_fund 由持仓现算（category=fund 或挂了场内代码的场外基金），
	// 事件表里不存这份判定：持仓改过类别后，历史提醒也不该继续骗人。
	q := `SELECT a.id,a.user_id,a.holding_id,a.symbol,a.name,a.kind,a.level,a.price,a.target,a.cost,
		a.pnl_pct,a.fee_pct,a.net_amount,a.title,a.body,a.dedupe_key,a.push_state,a.created_at,a.read_at,
		CASE WHEN IFNULL(h.category,'')='fund' OR TRIM(IFNULL(h.linked_symbol,''))<>'' THEN 1 ELSE 0 END
		FROM alert_events a LEFT JOIN holdings h ON h.id = a.holding_id
		WHERE a.user_id=?`
	if unreadOnly {
		q += " AND a.read_at=''"
	}
	q += " ORDER BY a.id DESC LIMIT ?"
	rows, err := DB.Query(q, uid, limit)
	if err != nil {
		return nil, err
	}
	return scanAlerts(rows)
}

// CountUnreadAlerts 铃铛角标用。
func CountUnreadAlerts(uid int64) (int, error) {
	var n int
	err := DB.QueryRow(`SELECT COUNT(1) FROM alert_events WHERE user_id=? AND read_at=''`, uid).Scan(&n)
	return n, err
}

// MarkAlertsRead 标记已读；ids 为空则全部标记（前端「全部已读」）。
func MarkAlertsRead(uid int64, ids []int64) error {
	stamp := time.Now().Format("2006-01-02 15:04:05")
	if len(ids) == 0 {
		_, err := DB.Exec(`UPDATE alert_events SET read_at=? WHERE user_id=? AND read_at=''`, stamp, uid)
		return err
	}
	for _, id := range ids {
		if _, err := DB.Exec(`UPDATE alert_events SET read_at=? WHERE id=? AND user_id=? AND read_at=''`, stamp, id, uid); err != nil {
			return err
		}
	}
	return nil
}

// SetAlertPushState 记录外部渠道投递结果（inbox 之外的钉钉/邮件回执）。
func SetAlertPushState(id int64, state string) error {
	_, err := DB.Exec(`UPDATE alert_events SET push_state=? WHERE id=?`, state, id)
	return err
}

// DeleteAlert 删除单条提醒（仅限本人）；返回实际删除行数。
func DeleteAlert(id, uid int64) (int64, error) {
	res, err := DB.Exec(`DELETE FROM alert_events WHERE id=? AND user_id=?`, id, uid)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteAlertsByUser 删账本时级联清理。
func DeleteAlertsByUser(uid int64) error {
	_, err := DB.Exec(`DELETE FROM alert_events WHERE user_id=?`, uid)
	return err
}

// DeleteAlertsByHolding 删持仓时清理（持仓已不存在，提醒点击无处可跳）。
func DeleteAlertsByHolding(hid int64) error {
	_, err := DB.Exec(`DELETE FROM alert_events WHERE holding_id=?`, hid)
	return err
}

// LastAlertAt 返回某持仓某类型的最近触发时间（冷却判定），无记录返回零值。
func LastAlertAt(uid, hid int64, kind string) time.Time {
	var s string
	_ = DB.QueryRow(`SELECT created_at FROM alert_events WHERE user_id=? AND holding_id=? AND kind=? ORDER BY id DESC LIMIT 1`,
		uid, hid, kind).Scan(&s)
	t, err := time.ParseInLocation("2006-01-02 15:04:05", s, time.Local)
	if err != nil {
		return time.Time{}
	}
	return t
}

// ---- 历史数据修复：清掉事件正文里固化的「赎回费率」 ----
//
// body 是入库时拼好的字符串，改生成逻辑不会追溯已有行；fee_pct 也是旧值。
// 两种脏数据：① 股票 / 场内 ETF 被写了「赎回费率 0.00%」（压根不存在这成本）；
// ② 基金费率为 0 时也照样写（「0.00%」是纯噪音）。
// 每次启动跑一遍，命中条件很窄，几毫秒，天然幂等（改完就不再命中）。
var alertFeeClause = regexp.MustCompile(`赎回费率\s*[\d.]+%，?`)

func RepairAlertFeeText() error {
	q := `SELECT a.id, a.title, a.body, a.price, a.target, a.cost, a.pnl_pct, a.fee_pct,
		CASE WHEN IFNULL(h.category,'')='fund' OR TRIM(IFNULL(h.linked_symbol,''))<>'' THEN 1 ELSE 0 END
		FROM alert_events a LEFT JOIN holdings h ON h.id = a.holding_id
		WHERE a.body LIKE '%赎回费率%' OR a.title LIKE '%赎回费%' OR a.fee_pct > 0`
	rows, err := DB.Query(q)
	if err != nil {
		return err
	}
	type fix struct {
		id          int64
		title, body string
		price       float64
		target      float64
		cost        float64
		pnl         float64
		fee         float64
		isFund      bool
	}
	var fixes []fix
	for rows.Next() {
		var f fix
		if err := rows.Scan(&f.id, &f.title, &f.body, &f.price, &f.target, &f.cost, &f.pnl, &f.fee, &f.isFund); err != nil {
			rows.Close()
			return err
		}
		fixes = append(fixes, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, f := range fixes {
		// 真基金 + 真有费：正文是对的，别动
		if f.isFund && f.fee > 0 {
			continue
		}
		title, body := f.title, f.body
		// 「止损被赎回费拖累」整段都是费率叙事，删掉片段会剩下病句，直接改写成普通止损
		if strings.Contains(title, "赎回费") || strings.Contains(body, "扣费后仍是") {
			title = strings.ReplaceAll(title, "止损被赎回费拖累", "止损触发")
			body = fmt.Sprintf("现价 %.4f 跌破止损线 %.4f。成本 %.4f，相对成本 %+.2f%%。",
				f.price, f.target, f.cost, f.pnl)
		} else {
			body = alertFeeClause.ReplaceAllString(body, "")
		}
		if _, err := DB.Exec(`UPDATE alert_events SET title=?, body=?, fee_pct=0 WHERE id=?`,
			title, body, f.id); err != nil {
			return err
		}
	}
	return nil
}
