package db

import (
	"time"
)

// ---- 存款（定期存款 / 大额存单）----
// 与理财并列的独立资产类别：新增时从关联现金子账户扣款（落 invest 类流水），
// 到期「确认落袋」后才把本金 + 利息记入账户（利息落 invest_int，计入被动收入）。
// 利息不会自动入账——必须用户点击确认，弹框内可改实际利息。

type Deposit struct {
	ID             int64   `json:"id"`
	UserID         int64   `json:"user_id"`
	Name           string  `json:"name"`
	Amount         float64 `json:"amount"`          // 本金
	Currency       string  `json:"currency"`        // 与入账子账户同币种
	Rate           float64 `json:"rate"`            // 年利率（百分数，如 2.75 = 2.75%）
	CashAccountID  int64   `json:"cash_account_id"` // 扣款 / 落袋子账户
	SourceID       int64   `json:"source_id"`       // 子账户所属来源（展示用）
	SourceName     string  `json:"source_name"`     // 来源名（展示用，非落库列）
	AccountName    string  `json:"account_name"`    // 子账户名（展示用，非落库列）
	StartDate      string  `json:"start_date"`      // 起息日 YYYY-MM-DD
	EndDate        string  `json:"end_date"`        // 到期时间 YYYY-MM-DD
	Status         string  `json:"status"`          // active 存期中 | settled 已落袋
	ActualInterest float64 `json:"actual_interest"` // 落袋时确认的实际利息
	SettledAt      string  `json:"settled_at"`      // 落袋时间 YYYY-MM-DD HH:MM:SS
	Note           string  `json:"note"`
	CreatedAt      string  `json:"created_at"`
}

func initDeposits() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS deposits (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id         INTEGER NOT NULL DEFAULT 0,
		name            TEXT NOT NULL DEFAULT '',
		amount          REAL NOT NULL DEFAULT 0,
		currency        TEXT NOT NULL DEFAULT 'cny',
		rate            REAL NOT NULL DEFAULT 0,
		cash_account_id INTEGER NOT NULL DEFAULT 0,
		source_id       INTEGER NOT NULL DEFAULT 0,
		start_date      TEXT NOT NULL DEFAULT '',
		end_date        TEXT NOT NULL DEFAULT '',
		status          TEXT NOT NULL DEFAULT 'active',
		actual_interest REAL NOT NULL DEFAULT 0,
		settled_at      TEXT NOT NULL DEFAULT '',
		note            TEXT NOT NULL DEFAULT '',
		created_at      TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

// ListDeposits 返回某用户全部存款（含子账户/来源名，未落袋的排前面，再按到期日）。
func ListDeposits(uid int64) ([]Deposit, error) {
	rows, err := DB.Query(`SELECT d.id,d.user_id,d.name,d.amount,d.currency,d.rate,d.cash_account_id,d.source_id,
		d.start_date,d.end_date,d.status,d.actual_interest,d.settled_at,d.note,d.created_at,
		COALESCE(c.name,''),COALESCE(s.name,'')
		FROM deposits d
		LEFT JOIN cash_accounts c ON c.id=d.cash_account_id
		LEFT JOIN asset_sources s ON s.id=d.source_id
		WHERE d.user_id=?
		ORDER BY (CASE WHEN d.status='settled' THEN 1 ELSE 0 END),
		         CASE WHEN d.end_date='' THEN 1 ELSE 0 END, d.end_date ASC, d.id DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Deposit
	for rows.Next() {
		var d Deposit
		if e := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Amount, &d.Currency, &d.Rate, &d.CashAccountID, &d.SourceID,
			&d.StartDate, &d.EndDate, &d.Status, &d.ActualInterest, &d.SettledAt, &d.Note, &d.CreatedAt,
			&d.AccountName, &d.SourceName); e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func GetDeposit(id int64) (*Deposit, error) {
	var d Deposit
	var accName, srcName string
	err := DB.QueryRow(`SELECT d.id,d.user_id,d.name,d.amount,d.currency,d.rate,d.cash_account_id,d.source_id,
		d.start_date,d.end_date,d.status,d.actual_interest,d.settled_at,d.note,d.created_at,
		COALESCE(c.name,''),COALESCE(s.name,'')
		FROM deposits d
		LEFT JOIN cash_accounts c ON c.id=d.cash_account_id
		LEFT JOIN asset_sources s ON s.id=d.source_id
		WHERE d.id=?`, id).
		Scan(&d.ID, &d.UserID, &d.Name, &d.Amount, &d.Currency, &d.Rate, &d.CashAccountID, &d.SourceID,
			&d.StartDate, &d.EndDate, &d.Status, &d.ActualInterest, &d.SettledAt, &d.Note, &d.CreatedAt,
			&accName, &srcName)
	if err != nil {
		return nil, err
	}
	d.AccountName, d.SourceName = accName, srcName
	return &d, nil
}

func CreateDeposit(d *Deposit) (int64, error) {
	if err := checkEntityLimit(d.UserID, "deposits"); err != nil {
		return 0, err
	}
	d.Currency = normCurrency(d.Currency)
	if d.Status == "" {
		d.Status = "active"
	}
	d.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO deposits(user_id,name,amount,currency,rate,cash_account_id,source_id,start_date,end_date,status,actual_interest,settled_at,note,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		d.UserID, d.Name, d.Amount, d.Currency, d.Rate, d.CashAccountID, d.SourceID, d.StartDate, d.EndDate, d.Status, d.ActualInterest, d.SettledAt, d.Note, d.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateDeposit 修改存期中存款的基础信息（金额/账户变更由调用方先冲正旧扣款再重扣）。
func UpdateDeposit(d *Deposit) error {
	d.Currency = normCurrency(d.Currency)
	_, err := DB.Exec(`UPDATE deposits SET name=?,amount=?,currency=?,rate=?,cash_account_id=?,source_id=?,
		start_date=?,end_date=?,note=? WHERE id=? AND user_id=?`,
		d.Name, d.Amount, d.Currency, d.Rate, d.CashAccountID, d.SourceID,
		d.StartDate, d.EndDate, d.Note, d.ID, d.UserID)
	return err
}

// SettleDeposit 标记落袋：记录实际利息与落袋时间。
func SettleDeposit(id, uid int64, actualInterest float64) error {
	_, err := DB.Exec(`UPDATE deposits SET status='settled',actual_interest=?,settled_at=? WHERE id=? AND user_id=? AND status<>'settled'`,
		actualInterest, time.Now().Format("2006-01-02 15:04:05"), id, uid)
	return err
}

func DeleteDeposit(id, uid int64) error {
	_, err := DB.Exec(`DELETE FROM deposits WHERE id=? AND user_id=?`, id, uid)
	return err
}

// ---- 被动收入数据源：已落袋收益 / 理财派息（按月份聚合，币种带回供换算）----

// GainRow 是一条按月份聚合的收益行（YM=YYYY-MM）。
type GainRow struct {
	YM       string  `json:"ym"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Label    string  `json:"label"` // 来源说明：减仓落袋 / 手动平仓 / 理财派息
}

// ListGainRows 区间内已落袋投资收益：减仓实现盈亏（realized_pnl_daily）+ 手动补录平仓盈亏（manual_closed_records）。
func ListGainRows(uid int64, start, end string) ([]GainRow, error) {
	var out []GainRow
	rows, err := DB.Query(`SELECT substr(date,1,7),amount,currency FROM realized_pnl_daily
		WHERE user_id=? AND date>=? AND date<=?`, uid, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r GainRow
		if e := rows.Scan(&r.YM, &r.Amount, &r.Currency); e != nil {
			rows.Close()
			return nil, e
		}
		r.Label = "减仓落袋"
		out = append(out, r)
	}
	rows.Close()
	rows2, err := DB.Query(`SELECT substr(realized_at,1,7),amount,'cny' FROM manual_closed_records
		WHERE user_id=? AND realized_at<>'' AND realized_at>=? AND realized_at<=?`, uid, start, end)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var r GainRow
		if e := rows2.Scan(&r.YM, &r.Amount, &r.Currency); e != nil {
			return nil, e
		}
		r.Label = "手动平仓"
		out = append(out, r)
	}
	return out, nil
}

// ListWealthDividendRows 区间内理财产品派息（wealth_snapshots.dividend，按日汇总到月）。
func ListWealthDividendRows(uid int64, start, end string) ([]GainRow, error) {
	rows, err := DB.Query(`SELECT substr(s.date,1,7),SUM(s.dividend),COALESCE(w.currency,'cny')
		FROM wealth_snapshots s JOIN wealth_products w ON w.id=s.wealth_id
		WHERE w.user_id=? AND s.date>=? AND s.date<=? AND s.dividend<>0
		GROUP BY substr(s.date,1,7), w.currency`, uid, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GainRow
	for rows.Next() {
		var r GainRow
		if e := rows.Scan(&r.YM, &r.Amount, &r.Currency); e != nil {
			return nil, e
		}
		r.Label = "理财派息"
		out = append(out, r)
	}
	return out, nil
}
