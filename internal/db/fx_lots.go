package db

import "time"

// FXLot 是一档换汇批次：amount 为原币金额，rate 为该档换汇成本（1 原币 = rate 主货币）。
// 批次按「账本 + 账户 + 币种」组织，不挂单个现金子账户：持仓与理财只关联到账户，
// 无法拆回到某一只现金子账户，见 docs/资产页汇兑与币种改造方案.md。
type FXLot struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	SourceID  int64   `json:"source_id"`
	Currency  string  `json:"currency"`
	Amount    float64 `json:"amount"`
	Rate      float64 `json:"rate"`
	TradeDate string  `json:"trade_date"`
	Note      string  `json:"note"`
	Origin    string  `json:"origin"` // manual | migrated | demo
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

const fxLotCols = `id,user_id,source_id,currency,amount,rate,trade_date,note,origin,created_at,updated_at`

func scanFXLots(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
}) ([]FXLot, error) {
	var out []FXLot
	for rows.Next() {
		var l FXLot
		if err := rows.Scan(&l.ID, &l.UserID, &l.SourceID, &l.Currency, &l.Amount, &l.Rate,
			&l.TradeDate, &l.Note, &l.Origin, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListFXLots 取某个账户某币种的全部批次（按日期、id 升序，便于弹框稳定展示）。
func ListFXLots(userID, sourceID int64, currency string) ([]FXLot, error) {
	rows, err := DB.Query(`SELECT `+fxLotCols+` FROM cash_fx_lots
		WHERE user_id=? AND source_id=? AND currency=? ORDER BY trade_date ASC, id ASC`,
		userID, sourceID, normCurrency(currency))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanFXLots(rows)
}

// ListAllFXLots 取一个账本的全部批次，总览一次取全避免按组重复查询。
func ListAllFXLots(userID int64) ([]FXLot, error) {
	rows, err := DB.Query(`SELECT `+fxLotCols+` FROM cash_fx_lots
		WHERE user_id=? ORDER BY trade_date ASC, id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanFXLots(rows)
}

// ReplaceFXLots 整组替换：删掉该账户该币种的全部旧批次后按新顺序写入。
// 传空数组等于清空（用于「恢复未拆分」）。
func ReplaceFXLots(userID, sourceID int64, currency string, lots []FXLot) error {
	cur := normCurrency(currency)
	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM cash_fx_lots WHERE user_id=? AND source_id=? AND currency=?`,
		userID, sourceID, cur); err != nil {
		return err
	}
	for _, l := range lots {
		origin := l.Origin
		if origin == "" {
			origin = "manual"
		}
		if _, err := tx.Exec(`INSERT INTO cash_fx_lots
			(user_id,source_id,currency,amount,rate,trade_date,note,origin,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?)`,
			userID, sourceID, cur, l.Amount, l.Rate, l.TradeDate, l.Note, origin, now, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteFXLotsBySource 删账户时级联清掉它的换汇批次。
func DeleteFXLotsBySource(sourceID int64) error {
	_, err := DB.Exec(`DELETE FROM cash_fx_lots WHERE source_id=?`, sourceID)
	return err
}
