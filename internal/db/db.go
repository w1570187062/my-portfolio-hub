package db

import (
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

type Holding struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Symbol       string  `json:"symbol"`
	Category     string  `json:"category"` // stock | fund
	Market       string  `json:"market"`   // stock: 沪深|美股|港股 ; fund: QDII|债券|股票
	Currency     string  `json:"currency"` // CNY | USD
	SourceID     int64   `json:"source_id"` // 所属平台/来源（asset_sources）
	Quantity     float64 `json:"quantity"`
	CostPrice    float64 `json:"cost_price"`
	CurrentPrice float64 `json:"current_price"`
	PrevClose    float64 `json:"prev_close"`
	Note         string  `json:"note"`
	LinkedSymbol string  `json:"linked_symbol"` // 基金关联的股票代码，非空时点击基金可做技术分析
	BuyDate      string  `json:"buy_date"`       // 买入日期（交易日期），YYYY-MM-DD，为空则不计持有天数
	AssetType    string  `json:"asset_type"`     // 资产类型标签（红利价值/成长科技/消费/医药等，来自设置）
	TransactionCost float64 `json:"transaction_cost"` // 交易成本/手续费，按持仓币种计，可选
	BuyPlan       string  `json:"buy_plan"`       // 基金补仓计划 JSON（净值刷新时计算，不写 note 列）
	Closed        bool    `json:"closed"`          // 是否已清仓（份额已归零）
	LastQuantity  float64 `json:"last_quantity"`   // 清仓前最后份额（供历史盈亏重算基准）
	LastCostPrice float64 `json:"last_cost_price"` // 清仓前最后成本价（供历史盈亏重算基准）
	AnalysisSignal string `json:"analysis_signal"`  // 自动技术分析信号：buy/sell/hold（刷新时计算）
	AnalysisUpPct  float64 `json:"analysis_up_pct"` // 自动分析看涨概率 up_pct（刷新时计算）
	AnalysisAt     string `json:"analysis_at"`      // 自动分析生成时间（本地时区）
	UserID        int64   `json:"user_id"`
	UpdatedAt     string  `json:"updated_at"`
}

func Init(path string) error {
	if dir := filepath.Dir(path); dir != "" && dir != "." && dir != "/" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("mkdir data dir: %w", err)
		}
	}
	var err error
	DB, err = sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	DB.SetMaxOpenConns(1)
	_, err = DB.Exec(`CREATE TABLE IF NOT EXISTS holdings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL DEFAULT '',
		symbol TEXT NOT NULL DEFAULT '',
		category TEXT NOT NULL DEFAULT 'stock',
		market TEXT NOT NULL DEFAULT '',
		currency TEXT NOT NULL DEFAULT 'cny',
		quantity REAL NOT NULL DEFAULT 0,
		cost_price REAL NOT NULL DEFAULT 0,
		current_price REAL NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return fmt.Errorf("create table: %w", err)
	}
	// 兼容旧库：新增 prev_close 列（方案A：用行情源真实昨收算当日盈亏）
	var pc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='prev_close'`).Scan(&pc); e == nil && pc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN prev_close REAL NOT NULL DEFAULT 0`)
	}
	// 兼容旧库：新增 note 列
	var nc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='note'`).Scan(&nc); e == nil && nc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN note TEXT NOT NULL DEFAULT ''`)
	}
	// 兼容旧库：新增 linked_symbol 列（基金关联股票代码，用于技术分析）
	var lsc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='linked_symbol'`).Scan(&lsc); e == nil && lsc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN linked_symbol TEXT NOT NULL DEFAULT ''`)
	}
	// 兼容旧库：新增 buy_date 列（买入日期，YYYY-MM-DD，用于计算持有天数）
	var bdc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='buy_date'`).Scan(&bdc); e == nil && bdc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN buy_date TEXT NOT NULL DEFAULT ''`)
	}
	// 兼容旧库：新增 buy_plan 列（基金补仓计划 JSON，由净值刷新时计算，不写入 note 列）
	var bpc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='buy_plan'`).Scan(&bpc); e == nil && bpc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN buy_plan TEXT NOT NULL DEFAULT ''`)
	}
	// 兼容旧库：新增 source_id 列（所属平台/来源，关联 asset_sources）
	var scid int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='source_id'`).Scan(&scid); e == nil && scid == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN source_id INTEGER NOT NULL DEFAULT 0`)
	}
	// 兼容旧库：新增 closed / last_quantity / last_cost_price（清仓后保留快照，供历史盈亏重算）
	var clc, lqc, lcc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='closed'`).Scan(&clc); e == nil && clc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN closed INTEGER NOT NULL DEFAULT 0`)
	}
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='last_quantity'`).Scan(&lqc); e == nil && lqc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN last_quantity REAL NOT NULL DEFAULT 0`)
	}
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='last_cost_price'`).Scan(&lcc); e == nil && lcc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN last_cost_price REAL NOT NULL DEFAULT 0`)
	}
	// 兼容旧库：新增 自动技术分析结果（买/卖/持信号 + 看涨概率 + 生成时间），由刷新时计算、前端角标读取
	var ansig, anup, anat int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='analysis_signal'`).Scan(&ansig); e == nil && ansig == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN analysis_signal TEXT NOT NULL DEFAULT ''`)
	}
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='analysis_up_pct'`).Scan(&anup); e == nil && anup == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN analysis_up_pct REAL NOT NULL DEFAULT 0`)
	}
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='analysis_at'`).Scan(&anat); e == nil && anat == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN analysis_at TEXT NOT NULL DEFAULT ''`)
	}
	// 兼容旧库：新增 transaction_cost 列（交易成本/手续费，按持仓币种计，可选）
	var tcc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='transaction_cost'`).Scan(&tcc); e == nil && tcc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN transaction_cost REAL NOT NULL DEFAULT 0`)
	}
		// 兼容旧库：新增 asset_type 列（资产类型标签：红利价值/成长科技/消费/医药等，来自设置）
	var atc int
	if e := DB.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('holdings') WHERE name='asset_type'`).Scan(&atc); e == nil && atc == 0 {
		_, _ = DB.Exec(`ALTER TABLE holdings ADD COLUMN asset_type TEXT NOT NULL DEFAULT ''`)
	}
_, err = DB.Exec(`CREATE TABLE IF NOT EXISTS price_daily (
		date    TEXT NOT NULL,
		symbol  TEXT NOT NULL,
		close   REAL NOT NULL,
		user_id INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (date, symbol, user_id)
	)`)
	if err != nil {
		return fmt.Errorf("create price_daily: %w", err)
	}
	_, err = DB.Exec(`CREATE TABLE IF NOT EXISTS pnl_daily (
		date      TEXT PRIMARY KEY,
		total_cny REAL NOT NULL DEFAULT 0,
		total_usd REAL NOT NULL DEFAULT 0,
		rate      REAL NOT NULL DEFAULT 0,
		detail    TEXT NOT NULL DEFAULT '{}'
	)`)
	if err != nil {
		return fmt.Errorf("create pnl_daily: %w", err)
	}
	if err := initRealizedPnl(); err != nil {
		return fmt.Errorf("init realized_pnl_daily: %w", err)
	}
	if err := initAISettings(); err != nil {
		return fmt.Errorf("init ai_settings: %w", err)
	}
	if err := initAIChats(); err != nil {
		return fmt.Errorf("init ai_chats: %w", err)
	}
	if err := initAssetTables(); err != nil {
		return fmt.Errorf("init asset tables: %w", err)
	}
	if err := initFXCache(); err != nil {
		return fmt.Errorf("init fx_cache: %w", err)
	}
	if err := initMeta(); err != nil {
		return fmt.Errorf("init meta: %w", err)
	}
	if err := initCalcInputs(); err != nil {
		return fmt.Errorf("init calc_inputs: %w", err)
	}
	if err := initPositionTx(); err != nil {
		return fmt.Errorf("init position_tx: %w", err)
	}
	if err := initOperationGuides(); err != nil {
		return fmt.Errorf("init operation_guides: %w", err)
	}
	if err := initPortfolioSettings(); err != nil {
		return fmt.Errorf("init portfolio_settings: %w", err)
	}
	if err := initNotifySettings(); err != nil {
		return fmt.Errorf("init notify_settings: %w", err)
	}
	if err := initBuyPlanExecuted(); err != nil {
		return fmt.Errorf("init buy_plan_executed: %w", err)
	}
	if err := initDCATables(); err != nil {
		return fmt.Errorf("init dca tables: %w", err)
	}
	if err := initAnalysisCache(); err != nil {
		return fmt.Errorf("init analysis_cache: %w", err)
	}
	return nil
}

// ---- 技术分析结果缓存（analysis_cache）----
// 按 (symbol, date) 主键缓存当日 K线+指标+概率 JSON。
// 同一交易日内多次打开分析弹框直接命中缓存，避免重复抓取 K线（新浪/腾讯接口较慢）。
// 跨日自然失效：新一天产生新行，旧行可保留作历史快照（定期清理可选）。

func initAnalysisCache() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS analysis_cache (
		symbol            TEXT NOT NULL,
		date              TEXT NOT NULL,
		bars_json         TEXT NOT NULL DEFAULT '[]',
		indicators_json   TEXT NOT NULL DEFAULT '{}',
		probability_json  TEXT NOT NULL DEFAULT '{}',
		daily_signals_json TEXT NOT NULL DEFAULT '[]',
		valuation_json    TEXT NOT NULL DEFAULT '{}',
		generated_at      TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (symbol, date)
	)`)
	if err != nil {
		return err
	}
	// 存量库补列（SQLite 无 ADD COLUMN IF NOT EXISTS）：查 PRAGMA 判断是否存在
	if err := addAnalysisCacheColumn("valuation_json", "TEXT NOT NULL DEFAULT '{}'"); err != nil {
		return err
	}
	// 索引：按 symbol 查最新缓存行
	_, err = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_analysis_cache_symbol ON analysis_cache(symbol)`)
	return err
}

// addAnalysisCacheColumn adds a column to analysis_cache if it does not already exist.
func addAnalysisCacheColumn(col, def string) error {
	rows, err := DB.Query(`PRAGMA table_info(analysis_cache)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	has := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt, pk interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == col {
			has = true
			break
		}
	}
	if has {
		return nil
	}
	_, err = DB.Exec(`ALTER TABLE analysis_cache ADD COLUMN ` + col + ` ` + def)
	return err
}

// AnalysisCacheRow is one cached analysis result for a symbol on a date.
type AnalysisCacheRow struct {
	Symbol             string
	Date               string
	BarsJSON           string
	IndicatorsJSON     string
	ProbabilityJSON   string
	DailySignalsJSON   string
	ValuationJSON      string
	GeneratedAt        string
}

// GetAnalysisCache returns the cached row for a symbol on a date, if any.
func GetAnalysisCache(symbol, date string) (*AnalysisCacheRow, error) {
	var r AnalysisCacheRow
	err := DB.QueryRow(`SELECT symbol,date,bars_json,indicators_json,probability_json,daily_signals_json,valuation_json,generated_at
		FROM analysis_cache WHERE symbol=? AND date=?`, symbol, date).
		Scan(&r.Symbol, &r.Date, &r.BarsJSON, &r.IndicatorsJSON, &r.ProbabilityJSON, &r.DailySignalsJSON, &r.ValuationJSON, &r.GeneratedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SaveAnalysisCache upserts a cache row. JSON strings are stored as-is.
func SaveAnalysisCache(symbol, date, barsJSON, indicatorsJSON, probabilityJSON, dailySignalsJSON, valuationJSON, generatedAt string) error {
	_, err := DB.Exec(`INSERT INTO analysis_cache(symbol,date,bars_json,indicators_json,probability_json,daily_signals_json,valuation_json,generated_at)
		VALUES(?,?,?,?,?,?,?,?)
		ON CONFLICT(symbol,date) DO UPDATE SET
			bars_json=excluded.bars_json,
			indicators_json=excluded.indicators_json,
			probability_json=excluded.probability_json,
			daily_signals_json=excluded.daily_signals_json,
			valuation_json=excluded.valuation_json,
			generated_at=excluded.generated_at`,
		symbol, date, barsJSON, indicatorsJSON, probabilityJSON, dailySignalsJSON, valuationJSON, generatedAt)
	return err
}

// buy_plan_executed 表为历史遗留（调仓计划功能已删），保留表结构以兼容旧库，新代码不再读写。
func initBuyPlanExecuted() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS buy_plan_executed (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		holding_id INTEGER NOT NULL,
		tier_index INTEGER NOT NULL DEFAULT 0,
		tier_label TEXT NOT NULL DEFAULT '',
		action TEXT NOT NULL DEFAULT 'buy',
		price REAL NOT NULL DEFAULT 0,
		amount REAL NOT NULL DEFAULT 0,
		note TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`)
	if err == nil {
		addColumnIfMissing("buy_plan_executed", "action", "TEXT NOT NULL DEFAULT 'buy'")
	}
	return err
}

// ---- 通知渠道配置（单条 JSON 配置，id=1，与 ai_settings 同模式） ----
func initNotifySettings() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS notify_settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		cfg TEXT NOT NULL DEFAULT '{}'
	)`)
	return err
}

// GetNotifyConfig returns the raw JSON config ("{}" if none stored).
func GetNotifyConfig() (string, error) {
	var cfg string
	err := DB.QueryRow("SELECT cfg FROM notify_settings WHERE id=1").Scan(&cfg)
	if err == sql.ErrNoRows {
		return "{}", nil
	}
	if err != nil {
		return "", err
	}
	return cfg, nil
}

// SaveNotifyConfig upserts the notify config JSON.
func SaveNotifyConfig(cfg string) error {
	_, err := DB.Exec(`INSERT INTO notify_settings(id,cfg) VALUES(1,?)
		ON CONFLICT(id) DO UPDATE SET cfg=excluded.cfg`, cfg)
	return err
}

// GetPnlLatest returns the most recent daily P&L record for a user (for notification summaries).
func GetPnlLatest(userID int64) (*PnlDay, error) {
	var p PnlDay
	err := DB.QueryRow(`SELECT date,user_id,total_cny,total_usd,rate,detail FROM pnl_daily WHERE user_id=? ORDER BY date DESC LIMIT 1`, userID).
		Scan(&p.Date, &p.UserID, &p.TotalCNY, &p.TotalUSD, &p.Rate, &p.Detail)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ============================================================================
// 加减仓交易记录（position_tx）与持仓成本基数调整
// ============================================================================

// PositionTx is one 加仓/减仓 transaction against a holding.
type PositionTx struct {
	ID            int64   `json:"id"`
	HoldingID     int64   `json:"holding_id"`
	TxType        string  `json:"tx_type"` // BUY (加仓) | SELL (减仓) | DIV (分红)
	Quantity      float64 `json:"quantity"`
	Price         float64 `json:"price"`
	Amount        float64 `json:"amount"` // 成交金额 = quantity * price；DIV 为分红总额
	Fee           float64 `json:"fee"`    // 买入/卖出成本（手续费/佣金）；DIV 为代扣费用
	RealizedPnl   float64 `json:"realized_pnl"`
	Note          string  `json:"note"`
	CreatedAt     string  `json:"created_at"`
	CashAccountID int64   `json:"cash_account_id"` // 联动的资金账户（回退时冲正到该账户，0=回落默认）
	Reverted      int     `json:"reverted"`        // 1=已回退（审计保留，原记录不删）
}

func initPositionTx() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS position_tx (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		holding_id INTEGER NOT NULL,
		tx_type TEXT NOT NULL,
		quantity REAL NOT NULL,
		price REAL NOT NULL,
		amount REAL NOT NULL,
		fee REAL NOT NULL DEFAULT 0,
		realized_pnl REAL NOT NULL DEFAULT 0,
		note TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}
	addColumnIfMissing("position_tx", "cash_account_id", "INTEGER NOT NULL DEFAULT 0")
	addColumnIfMissing("position_tx", "reverted", "INTEGER NOT NULL DEFAULT 0")
	return nil
}

// initRealizedPnl creates the daily realized-P&L ledger (减仓落库).
func initRealizedPnl() error {
	if _, err := DB.Exec(`CREATE TABLE IF NOT EXISTS realized_pnl_daily (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		date TEXT NOT NULL,
		holding_id INTEGER NOT NULL,
		symbol TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL DEFAULT '',
		currency TEXT NOT NULL DEFAULT '',
		amount REAL NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		return err
	}
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_realized_pnl_user_date ON realized_pnl_daily(user_id, date)`)
	addColumnIfMissing("realized_pnl_daily", "tx_id", "INTEGER NOT NULL DEFAULT 0")
	return nil
}

// InsertPositionTx records one 加仓/减仓/分红 transaction. Returns the new row id.
func InsertPositionTx(tx *PositionTx) (int64, error) {
	res, err := DB.Exec(`INSERT INTO position_tx(holding_id,tx_type,quantity,price,amount,fee,realized_pnl,note,created_at,cash_account_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		tx.HoldingID, tx.TxType, tx.Quantity, tx.Price, tx.Amount, tx.Fee, tx.RealizedPnl, tx.Note, tx.CreatedAt, tx.CashAccountID)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	return id, nil
}

// SetTxCashAccount backfills the linked cash account onto a transaction (set right
// after the cash side-effect is applied, so a later revert can reverse to the same account).
func SetTxCashAccount(txID, cashAccountID int64) error {
	_, err := DB.Exec(`UPDATE position_tx SET cash_account_id=? WHERE id=?`, cashAccountID, txID)
	return err
}

// ListPositionTx returns all transactions for a holding, newest first.
func ListPositionTx(holdingID int64) ([]PositionTx, error) {
	rows, err := DB.Query(`SELECT id,holding_id,tx_type,quantity,price,amount,fee,realized_pnl,note,created_at,cash_account_id,reverted FROM position_tx WHERE holding_id=? ORDER BY id DESC`, holdingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PositionTx
	for rows.Next() {
		var t PositionTx
		if err := rows.Scan(&t.ID, &t.HoldingID, &t.TxType, &t.Quantity, &t.Price, &t.Amount, &t.Fee, &t.RealizedPnl, &t.Note, &t.CreatedAt, &t.CashAccountID, &t.Reverted); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SumRealizedPnl returns the cumulative realized P&L (SELL gains minus losses)
// across all transactions of a holding.
func SumRealizedPnl(holdingID int64) (float64, error) {
	var s float64
	err := DB.QueryRow(`SELECT COALESCE(SUM(realized_pnl),0) FROM position_tx WHERE holding_id=?`, holdingID).Scan(&s)
	return s, err
}

// RealizedPnl is one recorded realized gain/loss from a 减仓 (SELL) on a given day.
// It is stored separately from pnl_daily so the daily snapshot (which recomputes
// price-based P&L) can merge it idempotently without being overwritten.
type RealizedPnl struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	Date      string  `json:"date"`
	HoldingID int64   `json:"holding_id"`
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Currency  string  `json:"currency"`
	Amount    float64 `json:"amount"`
	CreatedAt string  `json:"created_at"`
}

// RecordRealizedPnl persists one 减仓's realized P&L into the daily ledger.
// txID ties the ledger row back to the position_tx so a revert can delete it precisely.
func RecordRealizedPnl(uid int64, date string, holdingID int64, symbol, name, currency string, amount float64, txID int64) error {
	_, err := DB.Exec(`INSERT INTO realized_pnl_daily(user_id,date,holding_id,symbol,name,currency,amount,tx_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		uid, date, holdingID, symbol, name, currency, amount, txID, time.Now().Format("2006-01-02 15:04:05"))
	return err
}

// ListRealizedPnl returns all realized-P&L entries for a user on a given date.
func ListRealizedPnl(uid int64, date string) ([]RealizedPnl, error) {
	rows, err := DB.Query(`SELECT id,user_id,date,holding_id,symbol,name,currency,amount,created_at FROM realized_pnl_daily WHERE user_id=? AND date=? ORDER BY id`, uid, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RealizedPnl
	for rows.Next() {
		var r RealizedPnl
		if err := rows.Scan(&r.ID, &r.UserID, &r.Date, &r.HoldingID, &r.Symbol, &r.Name, &r.Currency, &r.Amount, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// txCreatedAt returns the position_tx created_at timestamp for a transaction.
// An empty date defaults to now; a back-dated YYYY-MM-DD uses that day at 00:00:00
// so historical entries ledger by their real occurrence date.
func txCreatedAt(date string) string {
	if strings.TrimSpace(date) == "" {
		return time.Now().Format("2006-01-02 15:04:05")
	}
	if _, e := time.Parse("2006-01-02", strings.TrimSpace(date)); e == nil {
		return strings.TrimSpace(date) + " 00:00:00"
	}
	return time.Now().Format("2006-01-02 15:04:05")
}

// AdjustHolding applies a 加仓/减仓 transaction to a holding: it updates the
// holding's quantity & average cost basis and records the transaction. The optional
// `date` (YYYY-MM-DD) back-dates the transaction's created_at and (for SELL) the
// realized-P&L ledger entry.
//   - BUY:  new_qty = qty + quantity;
//           new_cost = (qty*cost + quantity*price + fee) / new_qty   (摊薄后的平均成本)
//   - SELL: realized = (price - cost)*quantity - fee;
//           remaining cost basis unchanged; if qty hits 0 the cost basis resets to 0.
// Returns the updated holding and the realized P&L of THIS transaction.
func AdjustHolding(id int64, txType string, quantity, price, fee float64, note, date string) (h *Holding, realizedPnl float64, err error) {
	cur, err := Get(id)
	if err != nil {
		return nil, 0, err
	}
	txType = strings.ToUpper(strings.TrimSpace(txType))
	if txType != "BUY" && txType != "SELL" {
		return nil, 0, fmt.Errorf("类型必须为 BUY 或 SELL")
	}
	if quantity <= 0 {
		return nil, 0, fmt.Errorf("数量必须大于 0")
	}
	if price < 0 {
		return nil, 0, fmt.Errorf("价格不能为负")
	}
	if fee < 0 {
		return nil, 0, fmt.Errorf("成本不能为负")
	}
	newQty := cur.Quantity
	newCost := cur.CostPrice
	realized := 0.0
	switch txType {
	case "BUY":
		newQty = cur.Quantity + quantity
		if newQty <= 0 {
			return nil, 0, fmt.Errorf("加仓后份额必须大于 0")
		}
		// 成交金额(含手续费)并入成本，得到摊薄后的平均成本；按类别规整小数位（根因：早期未截断导致如 138.45769393791218 的超长尾数）
		newCost = roundByCategory(cur.Category, (cur.Quantity*cur.CostPrice+quantity*price+fee)/newQty)
	case "SELL":
		if quantity > cur.Quantity {
			return nil, 0, fmt.Errorf("减仓数量不能超过当前份额")
		}
		realized = (price - cur.CostPrice) * quantity - fee
		newQty = cur.Quantity - quantity
		if newQty <= 0 {
			// 清仓：保留清仓前的份额与成本快照，供历史盈亏重算；持仓行标记 closed 且份额归零（列表显示为空仓）
			cur.LastQuantity = cur.Quantity
			cur.LastCostPrice = roundByCategory(cur.Category, cur.CostPrice)
			cur.Closed = true
			newQty = 0
			newCost = 0
		}
	}
	cur.Quantity = newQty
	cur.CostPrice = newCost
	if err := Update(cur); err != nil {
		return nil, 0, err
	}
	tx := PositionTx{
		HoldingID:   id,
		TxType:      txType,
		Quantity:    quantity,
		Price:       price,
		Amount:      quantity * price,
		Fee:         fee,
		RealizedPnl: realized,
		Note:        note,
		CreatedAt:   txCreatedAt(date),
	}
	if _, err := InsertPositionTx(&tx); err != nil {
		return nil, 0, err
	}
	return cur, realized, nil
}

// AdjustDividend 处理一次分红。method="cash"（默认）：份额不变、成本价按每股分红下调
// （除息摊薄口径），并以 tx_type=DIV 在 position_tx 留痕；现金入账由 handler 层完成。
// method="reinvest"：红利再投——以当前净值（NAV）把分红金额买入更多份额，份额增加、
// 平均成本按加权口径重算，不出现金、不产生 DIV 现金流水（落账为 tx_type=REINVEST）。
// 两种方式的 fee 仅留痕/不参与摊薄（现金分红按税前口径）。
func AdjustDividend(id int64, perShare, fee float64, note, date, method string) (h *Holding, dividendTotal float64, err error) {
	cur, err := Get(id)
	if err != nil {
		return nil, 0, err
	}
	if cur.Closed || cur.Quantity <= 0 {
		return nil, 0, fmt.Errorf("空仓/观察仓（份额为 0）没有分红，请先建仓")
	}
	if perShare <= 0 {
		return nil, 0, fmt.Errorf("每股分红必须大于 0")
	}
	if fee < 0 {
		fee = 0
	}
	if strings.TrimSpace(method) == "reinvest" {
		return adjustDividendReinvest(cur, perShare, note, date)
	}
	newCost := roundByCategory(cur.Category, cur.CostPrice-perShare)
	if newCost < 0 {
		return nil, 0, fmt.Errorf("每股分红(%g)超过当前成本价(%g)，成本价不能为负", perShare, cur.CostPrice)
	}
	dividendTotal = perShare * cur.Quantity
	cur.CostPrice = newCost
	if err := Update(cur); err != nil {
		return nil, 0, err
	}
	tx := PositionTx{
		HoldingID:   id,
		TxType:      "DIV",
		Quantity:    cur.Quantity,
		Price:       perShare,
		Amount:      dividendTotal,
		Fee:         math.Round(fee*100) / 100,
		RealizedPnl: 0,
		Note:        note,
		CreatedAt:   txCreatedAt(date),
	}
	if _, err := InsertPositionTx(&tx); err != nil {
		return nil, 0, err
	}
	return cur, dividendTotal, nil
}

// adjustDividendReinvest 红利再投：分红金额按当前净值（NAV）买入更多份额。
// 新份额 = 分红总额 ÷ NAV；新均价 =（旧份额×旧成本 + 分红总额）÷ 新总份额（加权口径）。
// 落账为 tx_type=REINVEST（quantity=新增份额、price=NAV、amount=分红总额），不出现金。
func adjustDividendReinvest(cur *Holding, perShare float64, note, date string) (*Holding, float64, error) {
	nav := cur.CurrentPrice
	if nav <= 0 {
		return nil, 0, fmt.Errorf("红利再投需要最新净值（NAV），当前无行情价，请先刷新净值")
	}
	total := perShare * cur.Quantity
	if total <= 0 {
		return nil, 0, fmt.Errorf("每股分红必须大于 0")
	}
	newShares := total / nav
	newQty := cur.Quantity + newShares
	newCost := roundByCategory(cur.Category, (cur.Quantity*cur.CostPrice+total)/newQty)
	cur.Quantity = newQty
	cur.CostPrice = newCost
	if err := Update(cur); err != nil {
		return nil, 0, err
	}
	tx := PositionTx{
		HoldingID:   cur.ID,
		TxType:      "REINVEST",
		Quantity:    newShares,
		Price:       nav,
		Amount:      total,
		Fee:         0,
		RealizedPnl: 0,
		Note:        strings.TrimSpace(note) + " · 红利再投",
		CreatedAt:   txCreatedAt(date),
	}
	if _, err := InsertPositionTx(&tx); err != nil {
		return nil, 0, err
	}
	return cur, total, nil
}

// ---- FX rate cache (persisted last-good USD->CNY / USD->HKD rates) ----
func initFXCache() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS fx_cache (
		id INTEGER PRIMARY KEY CHECK(id=1),
		cny REAL NOT NULL DEFAULT 0,
		hkd REAL NOT NULL DEFAULT 0,
		updated TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return err
	}
	// 兼容旧库：补充昨日汇率列（幂等）
	addColumnIfMissing("fx_cache", "yesterday_cny", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("fx_cache", "yesterday_hkd", "REAL NOT NULL DEFAULT 0")
	return nil
}

// SaveFXRate persists the latest FX rates, plus yesterday's close when day changes.
func SaveFXRate(cny, hkd, yesterdayCny, yesterdayHkd float64) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := DB.Exec(`INSERT OR REPLACE INTO fx_cache(id, cny, hkd, updated, yesterday_cny, yesterday_hkd)
		VALUES(1, ?, ?, ?, ?, ?)`, cny, hkd, now, yesterdayCny, yesterdayHkd)
	return err
}

// ---- Meta key/value store (used to make scheduled jobs idempotent, e.g. the
// daily midnight reset records last_day_reset so it runs at most once per day) ----

func initMeta() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS meta (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

// GetMeta returns the stored value for a key. ok is false when no row exists.
func GetMeta(key string) (value string, ok bool, err error) {
	var v string
	e := DB.QueryRow(`SELECT value FROM meta WHERE key=?`, key).Scan(&v)
	if e == sql.ErrNoRows {
		return "", false, nil
	}
	if e != nil {
		return "", false, e
	}
	return v, true, nil
}

// SetMeta upserts a meta key/value.
func SetMeta(key, value string) error {
	_, err := DB.Exec(`INSERT INTO meta(key,value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// LoadFXRate returns the last persisted rates, yesterday close, and update timestamp, if any.
func LoadFXRate() (cny, hkd, yesterdayCny, yesterdayHkd float64, updated string, ok bool) {
	if err := DB.QueryRow(`SELECT cny, hkd, updated, COALESCE(yesterday_cny,0), COALESCE(yesterday_hkd,0) FROM fx_cache WHERE id=1`).Scan(&cny, &hkd, &updated, &yesterdayCny, &yesterdayHkd); err != nil {
		return 0, 0, 0, 0, "", false
	}
	return cny, hkd, yesterdayCny, yesterdayHkd, updated, true
}

// ---- Market value migration (one-time, idempotent) ----
//
// Legacy market codes (A_SH/A_SZ/FUND_ETF/FUND_OPEN/US/OTHER) are remapped to the
// two-level scheme: fund -> {QDII, 债券, 股票}; stock -> {沪深, 美股, 港股}.

func classifyFundMarket(name string) string {
	if strings.Contains(name, "债") {
		return "债券"
	}
	qdiiKeys := []string{"QDII", "全球", "纳指", "标普", "道琼斯", "道琼", "日本", "美国", "德国", "法国", "亚太", "海外", "互联", "中概", "普尔", "纳斯达克"}
	for _, k := range qdiiKeys {
		if strings.Contains(name, k) {
			return "QDII"
		}
	}
	return "股票"
}

// migrateMarkets remaps any legacy market codes to the new two-level scheme.
// Safe to call on every startup: once migrated there are no legacy values left.
func migrateMarkets() error {
	// 全局一次性迁移：遍历所有用户的持仓（List(0) 返回全部），按主键更新 market。
	hs, err := List(0)
	if err != nil {
		return err
	}
	for _, h := range hs {
		var nm string
		switch {
		case h.Market == "US":
			nm = "美股"
		case h.Market == "A_SH", h.Market == "A_SZ", h.Market == "FUND_ETF":
			nm = "沪深"
		case h.Market == "FUND_OPEN":
			nm = classifyFundMarket(h.Name)
		case h.Market == "OTHER":
			nm = "沪深"
		case h.Market == "A股":
			nm = "沪深"
		default:
			continue // already a new value
		}
		if nm != h.Market {
			if _, e := DB.Exec("UPDATE holdings SET market=? WHERE id=?", nm, h.ID); e != nil {
				return e
			}
		}
	}
	return nil
}

// migrateRoundHoldingPrices 一次性把存量持仓的价格字段按类别规整到标准小数位
// （股票 2 位、基金 4 位），清理早期浮点运算产生的超长尾数（如 PEP 成本价 138.45769393791218）。
func migrateRoundHoldingPrices() error {
	hs, err := List(0)
	if err != nil {
		return err
	}
	for _, h := range hs {
		nc := roundByCategory(h.Category, h.CostPrice)
		np := roundByCategory(h.Category, h.CurrentPrice)
		npc := roundByCategory(h.Category, h.PrevClose)
		if nc == h.CostPrice && np == h.CurrentPrice && npc == h.PrevClose {
			continue
		}
		if _, e := DB.Exec("UPDATE holdings SET cost_price=?,current_price=?,prev_close=? WHERE id=?", nc, np, npc, h.ID); e != nil {
			return e
		}
	}
	return nil
}

// migrateCurrencyCNY 一次性把存量币种标识统一为小写 cny/usd/hkd（2026-10-16）：
// 人民币的 rmb/CNY/RMB 混写归一为 cny，美元/港币统一小写；asset_sources.currencies
// 逗号串里的 rmb 替换为 cny。幂等：迁移后再次执行为 0 行更新，随每次启动安全检查。
func migrateCurrencyCNY() error {
	stmts := []string{
		// 持仓：历史上写入口是大写归一，存量以 CNY/USD/HKD 为主
		`UPDATE holdings SET currency='cny' WHERE UPPER(TRIM(currency)) IN ('CNY','RMB')`,
		`UPDATE holdings SET currency='usd' WHERE UPPER(TRIM(currency))='USD'`,
		`UPDATE holdings SET currency='hkd' WHERE UPPER(TRIM(currency))='HKD'`,
		`UPDATE holdings SET currency='cny' WHERE TRIM(currency)=''`,
		// 理财 / 现金 / 收支计划：历史上为小写 rmb
		`UPDATE wealth_products SET currency='cny' WHERE UPPER(TRIM(currency)) IN ('CNY','RMB')`,
		`UPDATE wealth_products SET currency='usd' WHERE UPPER(TRIM(currency))='USD'`,
		`UPDATE wealth_products SET currency='hkd' WHERE UPPER(TRIM(currency))='HKD'`,
		`UPDATE wealth_products SET currency='cny' WHERE TRIM(currency)=''`,
		`UPDATE cash_accounts SET currency='cny' WHERE UPPER(TRIM(currency)) IN ('CNY','RMB')`,
		`UPDATE cash_accounts SET currency='usd' WHERE UPPER(TRIM(currency))='USD'`,
		`UPDATE cash_accounts SET currency='hkd' WHERE UPPER(TRIM(currency))='HKD'`,
		`UPDATE cash_accounts SET currency='cny' WHERE TRIM(currency)=''`,
		`UPDATE liabilities SET currency='cny' WHERE UPPER(TRIM(currency)) IN ('CNY','RMB')`,
		`UPDATE liabilities SET currency='usd' WHERE UPPER(TRIM(currency))='USD'`,
		`UPDATE liabilities SET currency='hkd' WHERE UPPER(TRIM(currency))='HKD'`,
		`UPDATE liabilities SET currency='cny' WHERE TRIM(currency)=''`,
		`UPDATE cashflow_plans SET currency='cny' WHERE UPPER(TRIM(currency)) IN ('CNY','RMB')`,
		`UPDATE cashflow_plans SET currency='usd' WHERE UPPER(TRIM(currency))='USD'`,
		`UPDATE cashflow_plans SET currency='hkd' WHERE UPPER(TRIM(currency))='HKD'`,
		`UPDATE cashflow_plans SET currency='cny' WHERE TRIM(currency)=''`,
		// 账户币种集合逗号串
		`UPDATE asset_sources SET currencies=REPLACE(currencies,'rmb','cny') WHERE INSTR(currencies,'rmb')>0`,
	}
	for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

// List returns holdings for a user (userID). Pass 0 to get all (used by scheduled jobs).
func List(userID int64) ([]Holding, error) {
	q := "SELECT id,name,symbol,category,market,currency,source_id,quantity,cost_price,current_price,prev_close,note,linked_symbol,buy_date,buy_plan,user_id,updated_at,analysis_signal,analysis_up_pct,analysis_at,transaction_cost,asset_type FROM holdings"
	var args []interface{}
	if userID > 0 {
		q += " WHERE user_id=?"
		args = append(args, userID)
	}
	q += " ORDER BY id DESC"
	rows, err := DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Holding
	for rows.Next() {
		var h Holding
		if err := rows.Scan(&h.ID, &h.Name, &h.Symbol, &h.Category, &h.Market, &h.Currency, &h.SourceID, &h.Quantity, &h.CostPrice, &h.CurrentPrice, &h.PrevClose, &h.Note, &h.LinkedSymbol, &h.BuyDate, &h.BuyPlan, &h.UserID, &h.UpdatedAt, &h.AnalysisSignal, &h.AnalysisUpPct, &h.AnalysisAt, &h.TransactionCost, &h.AssetType); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func Get(id int64) (*Holding, error) {
	var h Holding
	err := DB.QueryRow("SELECT id,name,symbol,category,market,currency,source_id,quantity,cost_price,current_price,prev_close,note,linked_symbol,buy_date,buy_plan,user_id,updated_at,closed,last_quantity,last_cost_price,analysis_signal,analysis_up_pct,analysis_at,transaction_cost,asset_type FROM holdings WHERE id=?", id).
		Scan(&h.ID, &h.Name, &h.Symbol, &h.Category, &h.Market, &h.Currency, &h.SourceID, &h.Quantity, &h.CostPrice, &h.CurrentPrice, &h.PrevClose, &h.Note, &h.LinkedSymbol, &h.BuyDate, &h.BuyPlan, &h.UserID, &h.UpdatedAt, &h.Closed, &h.LastQuantity, &h.LastCostPrice, &h.AnalysisSignal, &h.AnalysisUpPct, &h.AnalysisAt, &h.TransactionCost, &h.AssetType)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// normCurrency 币种标识归一（2026-10-16 全站统一 cny/usd/hkd）：
// 统一小写；人民币兼容存量 rmb/CNY 写法，一律归一为 cny。空串原样返回（由调用方兜底）。
func normCurrency(s string) string {
	c := strings.ToLower(strings.TrimSpace(s))
	if c == "rmb" {
		return "cny"
	}
	return c
}

// NormCurrency 币种标识归一的导出门面（小写 + rmb→cny 兼容，空串原样返回），供 api/mcp 包使用。
func NormCurrency(s string) string { return normCurrency(s) }

// NormRegion 规范账户地域：小写；兼容存量 domestic→cn、overseas→hk；合法值 cn/hk/us，空/未知回退 cn。
func NormRegion(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "hk", "overseas":
		return "hk"
	case "us":
		return "us"
	default: // cn / domestic / 空 / 其它
		return "cn"
	}
}

func Create(h *Holding) (int64, error) {
	if err := checkEntityLimit(h.UserID, "holdings"); err != nil {
		return 0, err
	}
	h.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
	h.Currency = normCurrency(h.Currency) // 币种统一小写（人民币归一 cny），防 'usd'/'USD' 混写导致前端漏折算
	res, err := DB.Exec("INSERT INTO holdings(name,symbol,market,category,currency,source_id,quantity,cost_price,current_price,prev_close,note,linked_symbol,buy_date,buy_plan,user_id,updated_at,transaction_cost,asset_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		h.Name, h.Symbol, h.Market, h.Category, h.Currency, h.SourceID, h.Quantity, h.CostPrice, h.CurrentPrice, h.PrevClose, h.Note, h.LinkedSymbol, h.BuyDate, h.BuyPlan, h.UserID, h.UpdatedAt, h.TransactionCost, h.AssetType)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// roundByCategory 按类别约束价格小数位：股票 / 基金保留 4 位（美股/部分基金现价与成本价需 4 位精度），其余保留 2 位。
// 采用四舍五入（与前端口径一致），清理浮点运算产生的超长尾数，避免摊薄成本 / 计算器展示爆位数。
func roundByCategory(cat string, v float64) float64 {
	prec := 2
	if cat == "fund" || cat == "stock" {
		prec = 4
	}
	scale := math.Pow(10, float64(prec))
	return math.Round(v*scale) / scale
}

func Update(h *Holding) error {
	h.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
	h.Currency = normCurrency(h.Currency) // 币种统一小写（人民币归一 cny），防 'usd'/'USD' 混写导致前端漏折算
	// 类别由持久化的 category 决定（来自前端自动识别 / normalize 兜底），价格精度按此推导
	cat := h.Category
	if cat == "" {
		if h.LinkedSymbol != "" {
			cat = "fund"
		} else {
			cat = "stock"
		}
	}
	h.CostPrice = roundByCategory(cat, h.CostPrice)
	h.CurrentPrice = roundByCategory(cat, h.CurrentPrice)
	h.PrevClose = roundByCategory(cat, h.PrevClose)
	h.TransactionCost = roundByCategory(cat, h.TransactionCost)
	_, err := DB.Exec("UPDATE holdings SET name=?,symbol=?,market=?,category=?,currency=?,source_id=?,quantity=?,cost_price=?,current_price=?,prev_close=?,note=?,linked_symbol=?,buy_date=?,buy_plan=?,user_id=?,updated_at=?,closed=?,last_quantity=?,last_cost_price=?,transaction_cost=?,asset_type=? WHERE id=?",
		h.Name, h.Symbol, h.Market, h.Category, h.Currency, h.SourceID, h.Quantity, h.CostPrice, h.CurrentPrice, h.PrevClose, h.Note, h.LinkedSymbol, h.BuyDate, h.BuyPlan, h.UserID, h.UpdatedAt, h.Closed, h.LastQuantity, h.LastCostPrice, h.TransactionCost, h.AssetType, h.ID)
	return err
}

func UpdatePrice(id int64, price, prevClose float64) error {
	// 行情刷新写入的价格按 4 位小数规整（股票/基金行情本身不超过 4 位，此处仅作防御性截断）。
	price = math.Round(price*1e4) / 1e4
	prevClose = math.Round(prevClose*1e4) / 1e4
	_, err := DB.Exec("UPDATE holdings SET current_price=?, prev_close=?, updated_at=? WHERE id=?",
		price, prevClose, time.Now().Format("2006-01-02 15:04:05"), id)
	return err
}

// UpdateAnalysis persists the latest auto-computed technical-analysis signal
// (buy/sell/hold) and the up_pct for a holding. Computed during quote refresh
// (see api.autoAnalyzeAndStore) so the frontend can render a 买/卖 badge without
// re-running analysis. These columns are only ever written here, so db.Update's
// narrower column list never clobbers them.
func UpdateAnalysis(id int64, signal string, upPct float64, at string) error {
	_, err := DB.Exec("UPDATE holdings SET analysis_signal=?, analysis_up_pct=?, analysis_at=? WHERE id=?",
		signal, upPct, at, id)
	return err
}

// UpdateName refreshes the holding's display name from the upstream API.
func UpdateName(id int64, name string) error {
	_, err := DB.Exec("UPDATE holdings SET name=? WHERE id=?", name, id)
	return err
}

func Delete(id int64) error {
	_, err := DB.Exec("DELETE FROM holdings WHERE id=?", id)
	return err
}

// ExistsBySymbol reports whether another holding already uses the given symbol.
// excludeID is used on updates to ignore the row being saved (pass 0 when creating).
func ExistsBySymbol(symbol string, excludeID, userID int64) (bool, error) {
	var n int
	err := DB.QueryRow("SELECT COUNT(1) FROM holdings WHERE symbol=? AND id<>? AND user_id=?", symbol, excludeID, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// ---- Daily price snapshots & P&L history ----

// SavePriceDaily upserts the closing price for a symbol on a given date (YYYY-MM-DD).
func SavePriceDaily(date, symbol string, close float64, userID int64) error {
	_, err := DB.Exec(`INSERT INTO price_daily(date,symbol,close,user_id) VALUES(?,?,?,?)
		ON CONFLICT(date,symbol,user_id) DO UPDATE SET close=excluded.close`, date, symbol, close, userID)
	return err
}

// GetPriceDailyByDate returns a symbol->close map for all symbols recorded on a date.
// Used by the midnight settlement to backfill a missed daily P&L from stored closes.
func GetPriceDailyByDate(date string, userID int64) (map[string]float64, error) {
	rows, err := DB.Query(`SELECT symbol, close FROM price_daily WHERE date=? AND user_id=?`, date, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var s string
		var c float64
		if err := rows.Scan(&s, &c); err != nil {
			return nil, err
		}
		out[s] = c
	}
	return out, rows.Err()
}

// RebasePrevCloseAll resets a user's holdings' prev_close to current_price. This is
// the "daily P&L reset to zero" step for that user.
func RebasePrevCloseAll(userID int64) error {
	_, err := DB.Exec(`UPDATE holdings SET prev_close = current_price WHERE user_id=?`, userID)
	return err
}

// GetPrevClose returns the most recent close for a symbol strictly before the given date.
func GetPrevClose(symbol, date string, userID int64) (float64, bool, error) {
	var close float64
	err := DB.QueryRow(`SELECT close FROM price_daily WHERE symbol=? AND date<? AND user_id=? ORDER BY date DESC LIMIT 1`, symbol, date, userID).Scan(&close)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return close, true, nil
}

// PriceDay is one day's closing price for a symbol.
type PriceDay struct {
	Date  string  `json:"date"`
	Close float64 `json:"close"`
}

// GetPriceSeries returns all recorded daily closing prices for a symbol, ascending by date.
func GetPriceSeries(symbol string, userID int64) ([]PriceDay, error) {
	rows, err := DB.Query(`SELECT date, close FROM price_daily WHERE symbol=? AND user_id=? ORDER BY date ASC`, symbol, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PriceDay
	for rows.Next() {
		var p PriceDay
		if err := rows.Scan(&p.Date, &p.Close); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetSymbolCashDividends returns the per-share cash dividend (ex-dividend amount) for a
// symbol, keyed by ex-dividend date (YYYY-MM-DD). Used to build a back-adjusted
// (后复权) net-value series so the in-table sparkline and P&L curve don't show a false
// crash on ex-dividend days. Only cash dividends (tx_type='DIV', not reverted) are
// included; reinvested dividends (tx_type='REINVEST') are excluded because the cash
// stays in the position as extra shares and the market value is already continuous.
func GetSymbolCashDividends(uid int64, symbol string) (map[string]float64, error) {
	rows, err := DB.Query(`SELECT substr(t.created_at,1,10), t.price
		FROM position_tx t JOIN holdings h ON h.id=t.holding_id
		WHERE h.user_id=? AND h.symbol=? AND t.tx_type='DIV' AND t.reverted=0`, uid, symbol)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var d string
		var per float64
		if err := rows.Scan(&d, &per); err != nil {
			return nil, err
		}
		if per > 0 {
			out[d] = per // 同一基金同一除息日每股分红唯一，直接覆盖
		}
	}
	return out, rows.Err()
}

// SavePnlDaily upserts the daily P&L summary for a date and user.
func SavePnlDaily(date string, totalCNY, totalUSD, rate, baseCNY float64, detail string, userID int64) error {
	_, err := DB.Exec(`INSERT INTO pnl_daily(date,user_id,total_cny,total_usd,rate,base_cny,detail) VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(date,user_id) DO UPDATE SET total_cny=excluded.total_cny, total_usd=excluded.total_usd, rate=excluded.rate, base_cny=excluded.base_cny, detail=excluded.detail`,
		date, userID, totalCNY, totalUSD, rate, baseCNY, detail)
	return err
}

// PnlDay is one day's P&L record.
type PnlDay struct {
	Date     string  `json:"date"`
	UserID   int64   `json:"user_id"`
	TotalCNY float64 `json:"total_cny"`
	TotalUSD float64 `json:"total_usd"`
	Rate     float64 `json:"rate"`     // 汇率快照（CNY→USD），非收益率
	BaseCNY  float64 `json:"base_cny"` // 当日净资产基数（CNY），用于真实日收益率 = 当日盈亏 / base_cny
	Detail   string  `json:"detail"`
}

// BackfillPnlBase 将历史 pnl_daily 中 base_cny 仍为 0/空 的行补齐为指定基数（幂等：仅更新 0 值行）。
func BackfillPnlBase(userID int64, baseCNY float64) error {
	_, err := DB.Exec(`UPDATE pnl_daily SET base_cny=? WHERE user_id=? AND (base_cny IS NULL OR base_cny=0)`, baseCNY, userID)
	return err
}

// GetPnlHistory returns a user's daily P&L records ordered by date ascending.
func GetPnlHistory(userID int64) ([]PnlDay, error) {
	rows, err := DB.Query(`SELECT date,user_id,total_cny,total_usd,rate,base_cny,detail FROM pnl_daily WHERE user_id=? ORDER BY date ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PnlDay
	for rows.Next() {
		var p PnlDay
		if err := rows.Scan(&p.Date, &p.UserID, &p.TotalCNY, &p.TotalUSD, &p.Rate, &p.BaseCNY, &p.Detail); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// HasPnlDate reports whether a daily P&L record already exists for the date.
func HasPnlDate(date string, userID int64) (bool, error) {
	var n int
	err := DB.QueryRow(`SELECT COUNT(1) FROM pnl_daily WHERE date=? AND user_id=?`, date, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// ---- AI settings (single row, id=1, raw JSON config) ----

func initAISettings() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS ai_settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		cfg TEXT NOT NULL DEFAULT '{}'
	)`)
	return err
}

// GetAIConfig returns the raw JSON config for a user (always non-empty; "{}" if none stored).
func GetAIConfig(userID int64) (string, error) {
	var cfg string
	err := DB.QueryRow("SELECT cfg FROM ai_settings WHERE user_id=?", userID).Scan(&cfg)
	if err == sql.ErrNoRows {
		return "{}", nil
	}
	if err != nil {
		return "", err
	}
	return cfg, nil
}

// SaveAIConfig upserts the AI config JSON for a user.
func SaveAIConfig(userID int64, cfg string) error {
	_, err := DB.Exec(`INSERT INTO ai_settings(user_id,cfg) VALUES(?,?)
		ON CONFLICT(user_id) DO UPDATE SET cfg=excluded.cfg`, userID, cfg)
	return err
}

// ============================================================================
// 资产全景模块：资产来源 / 理财 / 负债 / 消费
// ============================================================================

// addColumnIfMissing adds a column to an existing table only if it is not
// already present. Safe to call on every startup (idempotent).
func addColumnIfMissing(table, col, def string) {
	rows, err := DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err == nil && name == col {
			found = true
		}
	}
	if !found {
		//nolint:errcheck
		DB.Exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def)
	}
}

func initAssetTables() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS asset_sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT 'bank',
			region TEXT NOT NULL DEFAULT 'cn',
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS wealth_products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL DEFAULT '',
			code TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT 'cny',
			cum_pnl REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			archived INTEGER NOT NULL DEFAULT 0,
			nav REAL NOT NULL DEFAULT 0,
			nav_updated_at TEXT NOT NULL DEFAULT '',
			shares REAL NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS wealth_snapshots (
			wealth_id INTEGER NOT NULL,
			date TEXT NOT NULL,
			amount REAL NOT NULL DEFAULT 0,
			cashflow REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (wealth_id, date)
		)`,
		// 理财快照审计：每次 upsert/delete 记录改前/改后值，支持一键撤销（补救误改/误删）。
		`CREATE TABLE IF NOT EXISTS wealth_snapshot_audit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			wealth_id INTEGER NOT NULL,
			date TEXT NOT NULL,
			action TEXT NOT NULL,
			field TEXT NOT NULL DEFAULT 'row',
			old_amount REAL NOT NULL DEFAULT 0,
			old_cashflow REAL NOT NULL DEFAULT 0,
			new_amount REAL NOT NULL DEFAULT 0,
			new_cashflow REAL NOT NULL DEFAULT 0,
			old_exists INTEGER NOT NULL DEFAULT 0,
			cash_account_id INTEGER NOT NULL DEFAULT 0,
			user_id INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS liabilities (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			rate REAL NOT NULL DEFAULT 0,
			monthly_payment REAL NOT NULL DEFAULT 0,
			currency TEXT NOT NULL DEFAULT 'cny',
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		// 负债流水：余额每次变动（新增=增加贷款 / 调低=还款）记一条，type: loan=增加贷款 / repay=还款
		`CREATE TABLE IF NOT EXISTS liability_flows (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0,
			liability_id INTEGER NOT NULL DEFAULT 0,
			date TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			balance REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS consumptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date TEXT NOT NULL DEFAULT '',
			source_id INTEGER NOT NULL DEFAULT 0,
			category TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS cash_accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT 'cny',
			type TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		// 现金流水：记录每个现金账户的余额变动（加仓付款 / 减仓回款 / 手工调整），
		// 供资产全景现金表格「历史」按钮展示。
		`CREATE TABLE IF NOT EXISTS cash_flow (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0,
			cash_id INTEGER NOT NULL,
			date TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			amount REAL NOT NULL DEFAULT 0,
			balance REAL NOT NULL DEFAULT 0,
			ref_type TEXT NOT NULL DEFAULT '',
			ref_id INTEGER NOT NULL DEFAULT 0,
			ref_name TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
			)`,
			// 月度待入账/待还款计划：每月固定某日发生的收支（工资待入账 / 房贷待还款 等）。
			// type: income=待入账(入账) / expense=待还款(出账)；account_id 关联已有现金账户系统；
			// liability_id 仅 expense 有意义，关联某笔负债，完成时同步记一笔负债还款流水。
			`CREATE TABLE IF NOT EXISTS cashflow_plans (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL DEFAULT 0,
				type TEXT NOT NULL DEFAULT 'income',
				title TEXT NOT NULL DEFAULT '',
				day_of_month INTEGER NOT NULL DEFAULT 1,
				amount REAL NOT NULL DEFAULT 0,
				currency TEXT NOT NULL DEFAULT 'cny',
				account_id INTEGER NOT NULL DEFAULT 0,
				liability_id INTEGER NOT NULL DEFAULT 0,
				note TEXT NOT NULL DEFAULT '',
				end_date TEXT NOT NULL DEFAULT '',
				pattern TEXT NOT NULL DEFAULT 'recurring_fixed',
				one_time_date TEXT NOT NULL DEFAULT '',
				liability_mode TEXT NOT NULL DEFAULT 'repay',
				created_at TEXT NOT NULL DEFAULT ''
			)`,
			// 完成记录：某计划在某一月份(ym)被勾选完成后落库一条，保证幂等（同 plan+ym 唯一）。
			// ref_type/ref_id 指向完成时所记的真实资金流水（cash_flow.id / liability_flows.id），供撤销时反向记账。
			`CREATE TABLE IF NOT EXISTS cashflow_plan_done (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL DEFAULT 0,
				plan_id INTEGER NOT NULL DEFAULT 0,
				ym TEXT NOT NULL DEFAULT '',
				actual_amount REAL NOT NULL DEFAULT 0,
				ref_type TEXT NOT NULL DEFAULT '',
				ref_id INTEGER NOT NULL DEFAULT 0,
				note TEXT NOT NULL DEFAULT '',
				done_at TEXT NOT NULL DEFAULT ''
			)`,
			// 待还款提醒发送日志：每个计划每个月(ym)只提醒一次，避免重复推送。
			`CREATE TABLE IF NOT EXISTS cashflow_reminder_log (
				plan_id INTEGER NOT NULL DEFAULT 0,
				user_id INTEGER NOT NULL DEFAULT 0,
				ym TEXT NOT NULL DEFAULT '',
				sent_at TEXT NOT NULL DEFAULT '',
				PRIMARY KEY (plan_id, ym)
			)`,
			}
			for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			return err
		}
	}
	// Migrations for columns added after first release.
	addColumnIfMissing("wealth_products", "currency", "TEXT NOT NULL DEFAULT 'cny'")
	addColumnIfMissing("wealth_products", "cum_pnl", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("wealth_products", "nav", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("wealth_products", "nav_updated_at", "TEXT NOT NULL DEFAULT ''")
	addColumnIfMissing("wealth_products", "shares", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("asset_sources", "region", "TEXT NOT NULL DEFAULT 'cn'")
	// account_no：账户唯一标识（CN=银行卡号，HK/US=账户/券商账号）；可选、不强制唯一
	addColumnIfMissing("asset_sources", "account_no", "TEXT NOT NULL DEFAULT ''")
	// currencies：账户支持的币种集合（逗号分隔，如 "cny,hkd,usd"）；子账户币种只能取自该集合
	// （新建/改币种时由 SyncSourceCurrency 反向补全，只补不删）。
	addColumnIfMissing("asset_sources", "currencies", "TEXT NOT NULL DEFAULT ''")
	addColumnIfMissing("cash_accounts", "user_id", "INTEGER NOT NULL DEFAULT 0")
	// is_default：已废弃的「默认子账户」标记（2026-10-16 移除该概念）。列保留兼容存量数据，
	// 新代码不再读写；如无历史包袱可择机 DROP。
	addColumnIfMissing("cash_accounts", "is_default", "INTEGER NOT NULL DEFAULT 0")
	addColumnIfMissing("cash_accounts", "type", "TEXT NOT NULL DEFAULT ''")
	// currency：负债支持多币种（与现金/持仓一致），默认 cny
	addColumnIfMissing("liabilities", "currency", "TEXT NOT NULL DEFAULT 'cny'")
	// end_date：收支计划截止日期（YYYY-MM-DD，空=长期有效）
	addColumnIfMissing("cashflow_plans", "end_date", "TEXT NOT NULL DEFAULT ''")
	// pattern：发生模式 recurring_fixed(固定月供/工资) | recurring_variable(浮动月还) | one_time(一次性)
	addColumnIfMissing("cashflow_plans", "pattern", "TEXT NOT NULL DEFAULT 'recurring_fixed'")
	// one_time_date：一次性计划的归属具体日期（YYYY-MM-DD），仅 pattern=one_time 使用
	addColumnIfMissing("cashflow_plans", "one_time_date", "TEXT NOT NULL DEFAULT ''")
	// liability_mode：支出关联负债的方式 repay(还款已有负债) | incur(产生新负债)，仅 expense
	addColumnIfMissing("cashflow_plans", "liability_mode", "TEXT NOT NULL DEFAULT 'repay'")
	// 存量更名：「现金账户」统一改称「子账户」，自动创建的默认账户名一并更新。
	_, _ = DB.Exec(`UPDATE cash_accounts SET name='默认子账户' WHERE name='默认现金账户'`)
	// 清理冗余审计记录（一次性）：旧版整批保存会把未编辑的产品也 upsert 并写审计，两类冗余：
	//   a) old==new 无变化保存（old_exists=1，旧值与新值完全一致）；
	//   b) 当日首次录入但金额与更早某天快照相同、净存入 0（当日什么都没发生）。
	// created_at 上限限定只清理历史数据；修复后新产生的记录不受影响（前端只提交有变化的行 + 后端跳过无变化行）。
	_, _ = DB.Exec(`DELETE FROM wealth_snapshot_audit
		WHERE action='upsert' AND created_at < '2026-09-04 12:00:00'
		  AND (
		    (old_exists=1 AND abs(old_amount-new_amount)<0.005 AND abs(old_cashflow-new_cashflow)<0.005)
		    OR (old_exists=0 AND abs(new_cashflow)<0.005 AND EXISTS (
		        SELECT 1 FROM wealth_snapshots s
		        WHERE s.wealth_id = wealth_snapshot_audit.wealth_id
		          AND s.date < wealth_snapshot_audit.date
		          AND abs(s.amount - wealth_snapshot_audit.new_amount) < 0.005))
		  )`)
	// 索引：按账户查流水（历史弹框）
	_, _ = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_cash_flow_cash ON cash_flow(cash_id)`)
	// source：流水来源标记（''=应用内操作 / 'mcp'=通过 MCP 服务写入），供流水表格打标签区分。
	addColumnIfMissing("cash_flow", "source", "TEXT NOT NULL DEFAULT ''")
	// 审计记录现金落账子账户：撤销时优先冲正回原账户，避免同金额多笔流水匹配错账户。
	addColumnIfMissing("wealth_snapshot_audit", "cash_account_id", "INTEGER NOT NULL DEFAULT 0")
	// 理财产品停用标记：清仓后归档（保留产品与历史收益），可重新启用或永久删除。
	addColumnIfMissing("wealth_products", "archived", "INTEGER NOT NULL DEFAULT 0")
	// 理财每日快照：分红金额（现金分红；红利再投资因金额不变故恒为 0）。
	// 计入每日盈亏 = 当日持仓 − 前一日持仓 − 当日净存入 + 当日分红，避免分红导致净值跳降被误判为亏损。
	addColumnIfMissing("wealth_snapshots", "dividend", "REAL NOT NULL DEFAULT 0")
	// 审计记录分红：撤销时按旧/新分红值还原。
	addColumnIfMissing("wealth_snapshot_audit", "old_dividend", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("wealth_snapshot_audit", "new_dividend", "REAL NOT NULL DEFAULT 0")
	// 存量回填：早期 MCP 写入的流水未记录 source，其 type 以 'mcp_' 开头，一次性补齐来源标记。
	_, _ = DB.Exec(`UPDATE cash_flow SET source='mcp' WHERE COALESCE(source,'')='' AND substr(type,1,4)='mcp_'`)
	return nil
}

// ---- Asset sources (资产来源 / 账户) ----

type AssetSource struct {
	ID         int64  `json:"id"`
	UserID     int64  `json:"user_id"`
	Name       string `json:"name"`
	Type       string `json:"type"` // bank | securities | software | platform
	Region     string `json:"region"` // cn | hk | us，账户归属地域（账户内资产默认即该地域资产）
	Currencies string `json:"currencies"` // 币种集合（逗号分隔：cny/hkd/usd），为空时按存量推断回填
	AccountNo  string `json:"account_no"` // 账户唯一标识：CN=银行卡号，HK/US=账户/券商账号；可选、不强制唯一
	Note       string `json:"note"`
	CreatedAt  string `json:"created_at"`
}

func ListSources(userID int64) ([]AssetSource, error) {
	rows, err := DB.Query(`SELECT id,user_id,name,type,region,currencies,account_no,note,created_at FROM asset_sources WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssetSource
	for rows.Next() {
		var s AssetSource
		if err := rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Region, &s.Currencies, &s.AccountNo, &s.Note, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// 数量上限：可切换的用户总数 5 个；账户/子账户/持仓/理财/负债/消费等数据每用户 200 条。
const MaxUsers = 5
const MaxEntities = 200

var ErrUserLimit = fmt.Errorf("最多只能创建 %d 个用户", MaxUsers)
var ErrEntityLimit = fmt.Errorf("该类型数据最多只能添加 %d 条", MaxEntities)

// checkEntityLimit 统计某用户在指定表的记录数，达到 MaxEntities 时返回错误。
// table 仅由内部固定字符串调用，无注入风险。
func checkEntityLimit(userID int64, table string) error {
	var n int
	if err := DB.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE user_id=?", userID).Scan(&n); err != nil {
		return err
	}
	if n >= MaxEntities {
		return ErrEntityLimit
	}
	return nil
}

func CreateSource(s *AssetSource) (int64, error) {
	// 账户数量上限：新建入口（手工新增/导入）统一走 CreateSource，在此拦截。
	if err := checkEntityLimit(s.UserID, "asset_sources"); err != nil {
		return 0, err
	}
	s.Region = NormRegion(s.Region) // 地域归一（含存量 domestic/overseas 兼容），防非法值入库
	s.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO asset_sources(user_id,name,type,region,currencies,account_no,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		s.UserID, s.Name, s.Type, s.Region, s.Currencies, s.AccountNo, s.Note, s.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateSource(s *AssetSource) error {
	s.Region = NormRegion(s.Region) // 地域归一（含存量 domestic/overseas 兼容），防非法值入库
	_, err := DB.Exec(`UPDATE asset_sources SET user_id=?,name=?,type=?,region=?,currencies=?,account_no=?,note=? WHERE id=?`, s.UserID, s.Name, s.Type, s.Region, s.Currencies, s.AccountNo, s.Note, s.ID)
	return err
}

// UpdateSourceCurrencies 仅更新来源的币种集合（listSources 存量自愈回填用）。
func UpdateSourceCurrencies(userID, sourceID int64, currencies string) error {
	_, err := DB.Exec(`UPDATE asset_sources SET currencies=? WHERE id=? AND user_id=?`, currencies, sourceID, userID)
	return err
}

// DeleteSource cascades to its wealth products (with snapshots) and liabilities.
// Consumptions keep their row but are detached (source_id set to 0) to preserve history.
func DeleteSource(id int64) error {
	ws, _ := ListWealthBySource(id)
	for _, w := range ws {
		if _, e := DB.Exec(`DELETE FROM wealth_snapshots WHERE wealth_id=?`, w.ID); e != nil {
			return e
		}
	}
	if _, err := DB.Exec(`DELETE FROM wealth_products WHERE source_id=?`, id); err != nil {
		return err
	}
	// 负债流水随负债级联删除
	if _, err := DB.Exec(`DELETE FROM liability_flows WHERE liability_id IN (SELECT id FROM liabilities WHERE source_id=?)`, id); err != nil {
		return err
	}
	if _, err := DB.Exec(`DELETE FROM liabilities WHERE source_id=?`, id); err != nil {
		return err
	}
	// 现金账户随来源级联删除（含其流水）；默认现金账户不支持单独删除，只能走这里。
	if err := DeleteCashBySource(id); err != nil {
		return err
	}
	if _, err := DB.Exec(`UPDATE consumptions SET source_id=0 WHERE source_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM asset_sources WHERE id=?`, id)
	return err
}

// ---- Wealth products (理财) ----

type WealthProduct struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	SourceID  int64   `json:"source_id"`
	Name      string  `json:"name"`
	Code      string  `json:"code"`
	Currency  string  `json:"currency"`
	Note         string  `json:"note"`
	CumPnl       float64 `json:"cum_pnl"`       // 累计收益：手动编辑值优先；为 0 时由每日快照自动累计。
	Archived     bool    `json:"archived"`     // 已清仓停用：保留产品与历史收益，可重新启用或永久删除。
	Nav          float64 `json:"nav"`          // 最新净值（基金码产品自动抓取；银行理财由用户在 App 看一眼录入）。0 表示未录入/不适用。
	NavUpdatedAt string  `json:"nav_updated_at"` // 净值更新时间（YYYY-MM-DD HH:MM:SS）。
	Shares       float64 `json:"shares"`       // 持有份额：>0 时持仓金额 = 份额 × 净值，净值刷新即自动重算金额与每日盈亏。
	CreatedAt    string  `json:"created_at"`
}

func ListWealth(userID int64) ([]WealthProduct, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,code,currency,cum_pnl,note,archived,nav,nav_updated_at,shares,created_at FROM wealth_products WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthProduct
	for rows.Next() {
		var w WealthProduct
		var archived int
		if err := rows.Scan(&w.ID, &w.UserID, &w.SourceID, &w.Name, &w.Code, &w.Currency, &w.CumPnl, &w.Note, &archived, &w.Nav, &w.NavUpdatedAt, &w.Shares, &w.CreatedAt); err != nil {
			return nil, err
		}
		w.Archived = archived != 0
		out = append(out, w)
	}
	return out, rows.Err()
}

// SetWealthArchived 设置理财产品的停用/启用状态。
func SetWealthArchived(id int64, archived bool) error {
	_, err := DB.Exec(`UPDATE wealth_products SET archived=? WHERE id=?`, boolToInt(archived), id)
	return err
}

func ListWealthBySource(sourceID int64) ([]WealthProduct, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,code,currency,cum_pnl,note,nav,nav_updated_at,shares,created_at FROM wealth_products WHERE source_id=? ORDER BY id DESC`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthProduct
	for rows.Next() {
		var w WealthProduct
		if err := rows.Scan(&w.ID, &w.UserID, &w.SourceID, &w.Name, &w.Code, &w.Currency, &w.CumPnl, &w.Note, &w.Nav, &w.NavUpdatedAt, &w.Shares, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func CreateWealth(w *WealthProduct) (int64, error) {
	if err := checkEntityLimit(w.UserID, "wealth_products"); err != nil {
		return 0, err
	}
	if w.Currency == "" {
		w.Currency = "cny"
	}
	w.Currency = normCurrency(w.Currency)
	w.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO wealth_products(user_id,source_id,name,code,currency,cum_pnl,note,nav,nav_updated_at,shares,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		w.UserID, w.SourceID, w.Name, w.Code, w.Currency, w.CumPnl, w.Note, w.Nav, w.NavUpdatedAt, w.Shares, w.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateWealth(w *WealthProduct) error {
	if w.Currency == "" {
		w.Currency = "cny"
	}
	w.Currency = normCurrency(w.Currency)
	_, err := DB.Exec(`UPDATE wealth_products SET user_id=?,source_id=?,name=?,code=?,currency=?,cum_pnl=?,note=?,nav=?,nav_updated_at=?,shares=? WHERE id=?`,
		w.UserID, w.SourceID, w.Name, w.Code, w.Currency, w.CumPnl, w.Note, w.Nav, w.NavUpdatedAt, w.Shares, w.ID)
	return err
}

func DeleteWealth(id int64) error {
	if _, err := DB.Exec(`DELETE FROM wealth_snapshots WHERE wealth_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM wealth_products WHERE id=?`, id)
	return err
}

// ---- Cash accounts (现金) ----

type Cash struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	SourceID  int64   `json:"source_id"`
	Name      string  `json:"name"`
	Currency  string  `json:"currency"`
	Type      string  `json:"type"` // 子账户类型：活期/定期/零钱/保证金等，自由填写
	Amount    float64 `json:"amount"`
	Note      string  `json:"note"`
	// IsDefault：已废弃的「默认子账户」标记。2026-10-16 移除默认子账户概念（所有子账户
	// 均可单独删除、资金兜底改按余额最大选取），列与字段保留仅为兼容存量数据，不再读写、
	// 不输出到 API（json:"-"）。
	IsDefault bool `json:"-"`
	CreatedAt string  `json:"created_at"`
}

// ---- 现金流水（余额变动历史）----

type CashFlow struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	CashID    int64   `json:"cash_id"`
	Date      string  `json:"date"`     // YYYY-MM-DD
	Type      string  `json:"type"`     // adjust_buy 加仓付款 | adjust_sell 减仓回款 | manual 手工调整
	Amount    float64 `json:"amount"`   // 变动额：正=入账，负=出账
	Balance   float64 `json:"balance"`  // 变动后的账户余额
	RefType   string  `json:"ref_type"` // holding | wealth | ""
	RefID     int64   `json:"ref_id"`
	RefName   string  `json:"ref_name"`
	Note      string  `json:"note"`
	Source    string  `json:"source"` // 来源标记：''=应用内操作，'mcp'=通过 MCP 服务写入
	CreatedAt string  `json:"created_at"`
}

func ListCash(userID int64) ([]Cash, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,currency,type,amount,note,is_default,created_at FROM cash_accounts WHERE user_id=? ORDER BY amount DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cash
	for rows.Next() {
		var c Cash
		var def int
		if err := rows.Scan(&c.ID, &c.UserID, &c.SourceID, &c.Name, &c.Currency, &c.Type, &c.Amount, &c.Note, &def, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.IsDefault = def == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListCashBySource 返回某来源下的全部现金账户（默认账户排最前）。
func ListCashBySource(userID, sourceID int64) ([]Cash, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,currency,type,amount,note,is_default,created_at FROM cash_accounts WHERE user_id=? AND source_id=? ORDER BY amount DESC, id DESC`, userID, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cash
	for rows.Next() {
		var c Cash
		var def int
		if err := rows.Scan(&c.ID, &c.UserID, &c.SourceID, &c.Name, &c.Currency, &c.Type, &c.Amount, &c.Note, &def, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.IsDefault = def == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCash 按 ID 取单个现金账户；不存在返回 (nil, nil)。
func GetCash(id int64) (*Cash, error) {
	var c Cash
	var def int
	err := DB.QueryRow(`SELECT id,user_id,source_id,name,currency,type,amount,note,is_default,created_at FROM cash_accounts WHERE id=?`, id).
		Scan(&c.ID, &c.UserID, &c.SourceID, &c.Name, &c.Currency, &c.Type, &c.Amount, &c.Note, &def, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

func CreateCash(c *Cash) (int64, error) {
	if err := checkEntityLimit(c.UserID, "cash_accounts"); err != nil {
		return 0, err
	}
	if c.Currency == "" {
		c.Currency = "cny"
	}
	c.Currency = normCurrency(c.Currency)
	c.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	// is_default 列不再写入（默认子账户概念已移除），由 schema 默认值 0 兜底
	res, err := DB.Exec(`INSERT INTO cash_accounts(user_id,source_id,name,currency,type,amount,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		c.UserID, c.SourceID, c.Name, c.Currency, c.Type, c.Amount, c.Note, c.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateCash(c *Cash) error {
	if c.Currency == "" {
		c.Currency = "cny"
	}
	c.Currency = normCurrency(c.Currency)
	// is_default 列不再写入（默认子账户概念已移除）
	_, err := DB.Exec(`UPDATE cash_accounts SET user_id=?,source_id=?,name=?,currency=?,type=?,amount=?,note=? WHERE id=?`,
		c.UserID, c.SourceID, c.Name, c.Currency, c.Type, c.Amount, c.Note, c.ID)
	return err
}

// DeleteCash 删除现金账户及其流水。2026-10-16 起移除「默认子账户」概念：
// 所有子账户均可单独删除（删除所属来源时仍会级联清理，见 DeleteCashBySource）。
func DeleteCash(id int64) error {
	if _, err := DB.Exec(`DELETE FROM cash_flow WHERE cash_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM cash_accounts WHERE id=?`, id)
	return err
}

// DeleteCashBySource 删除来源时级联清理其现金账户及流水（与理财/负债同级处理）。
func DeleteCashBySource(sourceID int64) error {
	if _, err := DB.Exec(`DELETE FROM cash_flow WHERE cash_id IN (SELECT id FROM cash_accounts WHERE source_id=?)`, sourceID); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM cash_accounts WHERE source_id=?`, sourceID)
	return err
}

// PickCashAccount 返回资金联动的兜底账户（2026-10-16 移除「默认子账户」概念后的新口径）：
// sourceID>0 时取该来源下、否则取该用户全部（收支计划不挂来源）同币种中**余额最大**的
// 子账户，并列取较新创建。不存在返回 (nil, nil)。
func PickCashAccount(userID, sourceID int64, currency string) (*Cash, error) {
	q := `SELECT id,user_id,source_id,name,currency,type,amount,note,is_default,created_at FROM cash_accounts WHERE user_id=? AND currency=?`
	args := []interface{}{userID, normCurrency(currency)}
	if sourceID > 0 {
		q += ` AND source_id=?`
		args = append(args, sourceID)
	}
	q += ` ORDER BY amount DESC, id DESC LIMIT 1`
	var c Cash
	var def int
	err := DB.QueryRow(q, args...).
		Scan(&c.ID, &c.UserID, &c.SourceID, &c.Name, &c.Currency, &c.Type, &c.Amount, &c.Note, &def, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.IsDefault = def == 1
	return &c, nil
}

// ParseSourceCurrencies 解析账户币种集合（逗号分隔串，如 "cny,hkd"），
// 仅保留合法币种（cny/hkd/usd）、小写、按传入顺序去重；为空或全非法时回退 ["cny"]。
// 兼容存量写法：rmb/CNY 归一为 cny。
func ParseSourceCurrencies(s string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, 3)
	for _, p := range strings.Split(s, ",") {
		p = normCurrency(strings.TrimSpace(p))
		if (p != "cny" && p != "hkd" && p != "usd") || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	if len(out) == 0 {
		out = append(out, "cny")
	}
	return out
}

// NormalizeCurrencies 把币种集合规范化为逗号分隔串（去非法/去重/小写），空回退 "cny"。
func NormalizeCurrencies(s string) string {
	return strings.Join(ParseSourceCurrencies(s), ",")
}

// InferSourceCurrencies 为存量来源（currencies 列为空）推断币种集合：
// 取该来源全部子账户币种并集；无任何子账户时回退 cny。
// 由 listSources 兜底一次性回填入库，之后不再触发。
func InferSourceCurrencies(userID, sourceID int64) string {
	existing, err := ListCashBySource(userID, sourceID)
	if err != nil || len(existing) == 0 {
		return "cny"
	}
	all := ""
	for _, c := range existing {
		all += c.Currency + ","
	}
	return NormalizeCurrencies(all)
}

// EnsureCashForCurrency 保证该来源下存在该币种的子账户：一个都没有时现场补建一个
// 「{来源名} {CUR} 子账户」作为资金联动的落点（2026-10-16 起无默认标记）。
// 已有任一同币种子账户则直接返回 0（不新建）。资金联动兜底（resolveCashAccount）走此函数。
func EnsureCashForCurrency(userID, sourceID int64, sourceName, currency string) (int64, error) {
	cur := normCurrency(currency)
	if cur == "" {
		cur = "cny"
	}
	existing, err := ListCashBySource(userID, sourceID)
	if err != nil {
		return 0, err
	}
	for _, c := range existing {
		if c.Currency == cur {
			return 0, nil
		}
	}
	name := strings.TrimSpace(sourceName)
	display := strings.ToUpper(cur) + " 子账户"
	if name != "" {
		display = name + " " + strings.ToUpper(cur) + " 子账户"
	}
	return CreateCash(&Cash{
		UserID:    userID,
		SourceID:  sourceID,
		Name:      display,
		Currency:  cur,
		Amount:    0,
		Note:      "按需自动创建（资金联动落点）",
	})
}

// SyncSourceCurrency 把子账户实际用到的币种补进来源的 currencies 集合（只补不删）：
// 子账户币种只能取自「账户已勾选币种」，新建/改币种时反向同步，保证元数据与事实一致。
func SyncSourceCurrency(userID, sourceID int64, currency string) error {
	if sourceID <= 0 {
		return nil
	}
	cur := normCurrency(currency)
	if cur == "" {
		return nil
	}
	srcs, err := ListSources(userID)
	if err != nil {
		return err
	}
	for _, s := range srcs {
		if s.ID != sourceID {
			continue
		}
		set := ParseSourceCurrencies(s.Currencies)
		for _, c := range set {
			if c == cur {
				return nil
			}
		}
		set = append(set, cur)
		return UpdateSourceCurrencies(userID, sourceID, strings.Join(set, ","))
	}
	return nil
}

// ---- 现金流水 ----

func AddCashFlow(f *CashFlow) error {
	f.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	_, err := DB.Exec(`INSERT INTO cash_flow(user_id,cash_id,date,type,amount,balance,ref_type,ref_id,ref_name,note,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		f.UserID, f.CashID, f.Date, f.Type, f.Amount, f.Balance, f.RefType, f.RefID, f.RefName, f.Note, f.Source, f.CreatedAt)
	return err
}

func ListCashFlows(cashID int64, limit int) ([]CashFlow, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := DB.Query(`SELECT id,user_id,cash_id,date,type,amount,balance,ref_type,ref_id,ref_name,note,COALESCE(source,''),created_at FROM cash_flow WHERE cash_id=? ORDER BY id DESC LIMIT ?`, cashID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CashFlow
	for rows.Next() {
		var f CashFlow
		if err := rows.Scan(&f.ID, &f.UserID, &f.CashID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.RefType, &f.RefID, &f.RefName, &f.Note, &f.Source, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// AggFlow 是资金流水聚合记录：合并现金流水(cash_flow)与负债流水(liability_flows)，
// 统一带出账户/负债名称与币种，供资产全景「流水」tab 展示。
type AggFlow struct {
	ID        int64   `json:"id"`
	Date      string  `json:"date"`
	Kind      string  `json:"kind"`     // "cash" | "liability"
	Type      string  `json:"type"`     // 流水类型
	Name      string  `json:"name"`     // 账户/负债名称
	RefName   string  `json:"ref_name"` // 关联标的（持仓/理财）
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Balance   float64 `json:"balance"`
	Direction string  `json:"direction"` // "in" | "out"
	Note      string  `json:"note"`
	Source    string  `json:"source"` // 来源标记：''=应用内操作，'mcp'=通过 MCP 服务写入
}

// ListFlows 返回某用户在 [start,end] 日期区间内的全部资金流水（现金+负债），按日期倒序。
func ListFlows(userID int64, start, end string) ([]AggFlow, error) {
	out := []AggFlow{}
	// 现金流水：持仓调仓/理财调仓/转账/手工调整，关联 cash_accounts 取币种与名称。
	// 来源(source)：优先取显式落库的 source 列；兼容存量数据——早期 MCP 流水 type 以 'mcp_' 开头。
	q1 := `SELECT f.id, f.date, f.type, f.amount, f.balance, f.ref_name, f.note, COALESCE(c.name,''), COALESCE(c.currency,'cny'),
	              CASE WHEN COALESCE(f.source,'')<>'' THEN f.source
	                   WHEN substr(f.type,1,4)='mcp_' THEN 'mcp'
	                   ELSE '' END
	       FROM cash_flow f LEFT JOIN cash_accounts c ON c.id=f.cash_id
	       WHERE f.user_id=? AND f.date>=? AND f.date<=?`
	rows, err := DB.Query(q1, userID, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var f AggFlow
		var amt float64
		if e := rows.Scan(&f.ID, &f.Date, &f.Type, &amt, &f.Balance, &f.RefName, &f.Note, &f.Name, &f.Currency, &f.Source); e != nil {
			rows.Close()
			return nil, e
		}
		f.Kind = "cash"
		f.Amount = amt
		f.Direction = dirOf(amt)
		out = append(out, f)
	}
	rows.Close()
	// 负债流水：贷款/还款，关联 liabilities 取币种与名称
	q2 := `SELECT f.id, f.date, f.type, f.amount, f.balance, f.note, COALESCE(l.name,''), COALESCE(l.currency,'cny')
	       FROM liability_flows f LEFT JOIN liabilities l ON l.id=f.liability_id
	       WHERE f.user_id=? AND f.date>=? AND f.date<=?`
	rows2, err := DB.Query(q2, userID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var f AggFlow
		var amt float64
		if e := rows2.Scan(&f.ID, &f.Date, &f.Type, &amt, &f.Balance, &f.Note, &f.Name, &f.Currency); e != nil {
			return nil, e
		}
		f.Kind = "liability"
		f.Amount = amt
		f.Direction = dirOf(amt)
		out = append(out, f)
	}
	// 按日期倒序，日期相同按 id 倒序
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date > out[j].Date
		}
		return out[i].ID > out[j].ID
	})
	return out, nil
}

func dirOf(amt float64) string {
	if amt >= 0 {
		return "in"
	}
	return "out"
}

// FlowYears 返回有流水数据的年份（去重，降序），供年份下拉使用。
func FlowYears(userID int64) ([]int, error) {
	rows, err := DB.Query(`SELECT DISTINCT substr(date,1,4) FROM cash_flow WHERE user_id=? AND date<>''
	                       UNION SELECT DISTINCT substr(date,1,4) FROM liability_flows WHERE user_id=? AND date<>''
	                       ORDER BY 1 DESC`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var y string
		if e := rows.Scan(&y); e != nil {
			return nil, e
		}
		if n, e := strconv.Atoi(y); e == nil {
			out = append(out, n)
		}
	}
	return out, nil
}

// AddCashAmount 调整现金账户余额（delta 正=入账 / 负=出账）并写入一条流水，
// 保证账户余额与流水始终成对一致。调用方需保证 cashID 属于当前用户。
func AddCashAmount(cashID int64, delta float64, typ, refType string, refID int64, refName, note string) error {
	return AddCashAmountFrom("", cashID, delta, typ, refType, refID, refName, note)
}

// AddCashAmountFrom 同 AddCashAmount，但额外记录流水来源（source），
// 例如 source="mcp" 表示该流水由 MCP 服务写入，前端流水表格据此打标签突出显示。
func AddCashAmountFrom(source string, cashID int64, delta float64, typ, refType string, refID int64, refName, note string) error {
	c, err := GetCash(cashID)
	if err != nil {
		return err
	}
	if c == nil {
		return fmt.Errorf("子账户不存在（id=%d）", cashID)
	}
	bal := math.Round((c.Amount+delta)*100) / 100
	if _, err := DB.Exec(`UPDATE cash_accounts SET amount=? WHERE id=?`, bal, cashID); err != nil {
		return err
	}
	return AddCashFlow(&CashFlow{
		UserID:  c.UserID,
		CashID:  cashID,
		Date:    time.Now().Format("2006-01-02"),
		Type:    typ,
		Amount:  math.Round(delta*100) / 100,
		Balance: bal,
		RefType: refType,
		RefID:   refID,
		RefName: refName,
		Note:    note,
		Source:  source,
	})
}

// FindCashFlowByRef 查找某引用对象（ref_type+ref_id）最近一条金额匹配的现金流水，
// 用于理财快照删除/撤销时定位当初落账的资金账户。无匹配返回 (nil, nil)。
func FindCashFlowByRef(refType string, refID int64, amount float64) (*CashFlow, error) {
	var f CashFlow
	err := DB.QueryRow(`SELECT id,user_id,cash_id,date,type,amount,balance,ref_type,ref_id,ref_name,note,created_at
		FROM cash_flow WHERE ref_type=? AND ref_id=? AND ABS(amount-?)<0.01 ORDER BY id DESC LIMIT 1`,
		refType, refID, amount).
		Scan(&f.ID, &f.UserID, &f.CashID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.RefType, &f.RefID, &f.RefName, &f.Note, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// AddCashTransfer 在同币种现金账户间转账：源账户扣 amount、目标账户加 amount，
// 并成对写入 transfer_out / transfer_in 流水。amount 必须 > 0，源账户余额充足。
// 失败时尝试回滚已扣款项（写入 transfer_rollback 流水）以避免出现"扣了没入"的不一致。
// 暂未启用 SQL 事务（保持现有代码风格），并发场景下极少数失败可能需手工对账。
func AddCashTransfer(fromID, toID int64, amount float64, note string) error {
	if amount <= 0 {
		return fmt.Errorf("转账金额必须大于 0")
	}
	if fromID == toID {
		return fmt.Errorf("源账户与目标账户不能相同")
	}
	src, err := GetCash(fromID)
	if err != nil {
		return fmt.Errorf("读取源账户失败：%w", err)
	}
	if src == nil {
		return fmt.Errorf("源子账户不存在（id=%d）", fromID)
	}
	dst, err := GetCash(toID)
	if err != nil {
		return fmt.Errorf("读取目标账户失败：%w", err)
	}
	if dst == nil {
		return fmt.Errorf("目标子账户不存在（id=%d）", toID)
	}
	if src.Currency != dst.Currency {
		return fmt.Errorf("币种不一致（%s → %s），请手动换汇后转账", strings.ToUpper(src.Currency), strings.ToUpper(dst.Currency))
	}
	if src.UserID != dst.UserID {
		return fmt.Errorf("跨用户转账不被允许")
	}
	// 余额不足拦截（精度容差 0.005）
	if math.Round((src.Amount-amount)*100)/100 < -0.005 {
		return fmt.Errorf("源账户余额不足（余额 %.2f，转出 %.2f）", src.Amount, amount)
	}
	// 先扣源账户
	if err := AddCashAmount(fromID, -amount, "transfer_out", "cash", toID, dst.Name, note); err != nil {
		return fmt.Errorf("扣减源账户失败：%w", err)
	}
	// 入账目标账户；失败则回滚源账户
	if err := AddCashAmount(toID, amount, "transfer_in", "cash", fromID, src.Name, note); err != nil {
		_ = AddCashAmount(fromID, amount, "transfer_rollback", "", 0, "", "转账失败回滚")
		return fmt.Errorf("入账目标账户失败：%w", err)
	}
	return nil
}

// ---- Wealth daily snapshots (每日持仓金额) ----

type WealthSnapshot struct {
	WealthID int64   `json:"wealth_id"`
	Date     string  `json:"date"`
	Amount   float64 `json:"amount"`
	Cashflow float64 `json:"cashflow"`
	Dividend float64 `json:"dividend"`
}

// GetWealthSnapshot returns the snapshot for a wealth product on a specific date.
func GetWealthSnapshot(wealthID int64, date string) (amount, cashflow, dividend float64, ok bool, err error) {
	err = DB.QueryRow(`SELECT amount, cashflow, dividend FROM wealth_snapshots WHERE wealth_id=? AND date=?`, wealthID, date).
		Scan(&amount, &cashflow, &dividend)
	if err == sql.ErrNoRows {
		return 0, 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, 0, false, err
	}
	return amount, cashflow, dividend, true, nil
}

// GetWealthLatest returns the most recent snapshot (highest date) for a product.
func GetWealthLatest(wealthID int64) (date string, amount float64, ok bool, err error) {
	err = DB.QueryRow(`SELECT date, amount FROM wealth_snapshots WHERE wealth_id=? ORDER BY date DESC LIMIT 1`, wealthID).
		Scan(&date, &amount)
	if err == sql.ErrNoRows {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	return date, amount, true, nil
}

// GetWealthFirst returns the earliest snapshot date of a wealth product (ok=false if none).
// 用于计算理财持有天数（从首次录入快照起算）。
func GetWealthFirst(wealthID int64) (date string, ok bool, err error) {
	err = DB.QueryRow(`SELECT date FROM wealth_snapshots WHERE wealth_id=? ORDER BY date ASC LIMIT 1`, wealthID).
		Scan(&date)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return date, true, nil
}

// GetWealthPrevSnapshot returns the latest snapshot strictly before the given date.
func GetWealthPrevSnapshot(wealthID int64, date string) (dateStr string, amount float64, ok bool, err error) {
	err = DB.QueryRow(`SELECT date, amount FROM wealth_snapshots WHERE wealth_id=? AND date<? ORDER BY date DESC LIMIT 1`, wealthID, date).
		Scan(&dateStr, &amount)
	if err == sql.ErrNoRows {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	return dateStr, amount, true, nil
}

func UpsertWealthSnapshot(wealthID int64, date string, amount, cashflow, dividend float64) error {
	_, err := DB.Exec(`INSERT INTO wealth_snapshots(wealth_id,date,amount,cashflow,dividend) VALUES(?,?,?,?,?)
		ON CONFLICT(wealth_id,date) DO UPDATE SET amount=excluded.amount, cashflow=excluded.cashflow, dividend=excluded.dividend`,
		wealthID, date, amount, cashflow, dividend)
	return err
}

func ListWealthSnapshots(wealthID int64) ([]WealthSnapshot, error) {
	rows, err := DB.Query(`SELECT wealth_id,date,amount,cashflow,dividend FROM wealth_snapshots WHERE wealth_id=? ORDER BY date ASC`, wealthID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthSnapshot
	for rows.Next() {
		var s WealthSnapshot
		if err := rows.Scan(&s.WealthID, &s.Date, &s.Amount, &s.Cashflow, &s.Dividend); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func CountWealthSnapshots(wealthID int64) (int, error) {
	var n int
	err := DB.QueryRow(`SELECT COUNT(1) FROM wealth_snapshots WHERE wealth_id=?`, wealthID).Scan(&n)
	return n, err
}

// WealthAudit 记录一次理财快照变更（upsert/delete），用于撤销误改/误删。
type WealthAudit struct {
	ID            int64   `json:"id"`
	WealthID      int64   `json:"wealth_id"`
	Date          string  `json:"date"`
	Action        string  `json:"action"` // 'upsert' | 'delete' | 'undo'
	Field         string  `json:"field"`
	OldAmount     float64 `json:"old_amount"`
	OldCash       float64 `json:"old_cashflow"`
	NewAmount     float64 `json:"new_amount"`
	NewCash       float64 `json:"new_cashflow"`
	OldDividend   float64 `json:"old_dividend"`
	NewDividend   float64 `json:"new_dividend"`
	OldExists     bool    `json:"old_exists"`
	CashAccountID int64   `json:"cash_account_id"` // 本次操作现金落账实际使用的子账户（撤销时优先冲正回该账户，0=未落账/未知）
	UserID        int64   `json:"user_id"`
	CreatedAt     string  `json:"created_at"`
}

// WealthProductOwner 返回该产品归属的用户 ID（用于越权校验）。
func WealthProductOwner(wealthID int64) (int64, error) {
	var uid int64
	err := DB.QueryRow(`SELECT user_id FROM wealth_products WHERE id=?`, wealthID).Scan(&uid)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return uid, err
}

// GetWealthProduct 按 ID 取单个理财产品；不存在返回 (nil, nil)。
func GetWealthProduct(id int64) (*WealthProduct, error) {
	var w WealthProduct
	err := DB.QueryRow(`SELECT id,user_id,source_id,name,code,currency,cum_pnl,note,created_at FROM wealth_products WHERE id=?`, id).
		Scan(&w.ID, &w.UserID, &w.SourceID, &w.Name, &w.Code, &w.Currency, &w.CumPnl, &w.Note, &w.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// DeleteWealthSnapshot 删除某产品某天的快照行。
func DeleteWealthSnapshot(wealthID int64, date string) error {
	_, err := DB.Exec(`DELETE FROM wealth_snapshots WHERE wealth_id=? AND date=?`, wealthID, date)
	return err
}

// InsertWealthAudit 写入一条审计记录。
func InsertWealthAudit(a WealthAudit) error {
	_, err := DB.Exec(`INSERT INTO wealth_snapshot_audit(wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_dividend,new_dividend,old_exists,cash_account_id,user_id,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		a.WealthID, a.Date, a.Action, a.Field, a.OldAmount, a.OldCash, a.NewAmount, a.NewCash, a.OldDividend, a.NewDividend, boolToInt(a.OldExists), a.CashAccountID, a.UserID, a.CreatedAt)
	return err
}

// ListWealthAudit 返回某产品的审计记录（新→旧）。
func ListWealthAudit(wealthID int64) ([]WealthAudit, error) {
	rows, err := DB.Query(`SELECT id,wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_dividend,new_dividend,old_exists,cash_account_id,user_id,created_at
		FROM wealth_snapshot_audit WHERE wealth_id=? ORDER BY id DESC`, wealthID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthAudit
	for rows.Next() {
		var a WealthAudit
		var oldExists int
		if err := rows.Scan(&a.ID, &a.WealthID, &a.Date, &a.Action, &a.Field, &a.OldAmount, &a.OldCash, &a.NewAmount, &a.NewCash, &a.OldDividend, &a.NewDividend, &oldExists, &a.CashAccountID, &a.UserID, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.OldExists = oldExists != 0
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetWealthAudit 按 ID 读取一条审计记录。
func GetWealthAudit(id int64) (WealthAudit, error) {
	var a WealthAudit
	var oldExists int
	err := DB.QueryRow(`SELECT id,wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_dividend,new_dividend,old_exists,cash_account_id,user_id,created_at
		FROM wealth_snapshot_audit WHERE id=?`, id).
		Scan(&a.ID, &a.WealthID, &a.Date, &a.Action, &a.Field, &a.OldAmount, &a.OldCash, &a.NewAmount, &a.NewCash, &a.OldDividend, &a.NewDividend, &oldExists, &a.CashAccountID, &a.UserID, &a.CreatedAt)
	if err != nil {
		return a, err
	}
	a.OldExists = oldExists != 0
	return a, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ---- Liabilities (负债) ----

// 注意：liabilities 表仍保留 rate / monthly_payment 两个历史列（SQLite 掉列需重建表，
// 风险不值得），但已不再读写——统一表单后负债只关心「名称/类型/欠款余额/币种/备注」。
type Liability struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	SourceID  int64   `json:"source_id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"` // cny | usd | hkd，负债支持多币种（默认 cny）
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

func ListLiabilities(userID int64) ([]Liability, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,type,amount,currency,note,created_at FROM liabilities WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Liability
	for rows.Next() {
		var l Liability
		if err := rows.Scan(&l.ID, &l.UserID, &l.SourceID, &l.Name, &l.Type, &l.Amount, &l.Currency, &l.Note, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func CreateLiability(l *Liability) (int64, error) {
	if err := checkEntityLimit(l.UserID, "liabilities"); err != nil {
		return 0, err
	}
	l.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO liabilities(user_id,source_id,name,type,amount,currency,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		l.UserID, l.SourceID, l.Name, l.Type, l.Amount, l.Currency, l.Note, l.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateLiability(l *Liability) error {
	_, err := DB.Exec(`UPDATE liabilities SET user_id=?,source_id=?,name=?,type=?,amount=?,currency=?,note=? WHERE id=?`,
		l.UserID, l.SourceID, l.Name, l.Type, l.Amount, l.Currency, l.Note, l.ID)
	return err
}

func DeleteLiability(id int64) error {
	if _, err := DB.Exec(`DELETE FROM liability_flows WHERE liability_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM liabilities WHERE id=?`, id)
	return err
}

// ---- 负债流水（余额变动历史：增加贷款 / 还款） ----

type LiabilityFlow struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"user_id"`
	LiabilityID int64   `json:"liability_id"`
	Date        string  `json:"date"`
	Type        string  `json:"type"` // loan=增加贷款 / repay=还款
	Amount      float64 `json:"amount"`
	Balance     float64 `json:"balance"` // 变动后余额
	Note        string  `json:"note"`
	CreatedAt   string  `json:"created_at"`
}

func GetLiability(id int64) (*Liability, error) {
	var l Liability
	err := DB.QueryRow(`SELECT id,user_id,source_id,name,type,amount,currency,note,created_at FROM liabilities WHERE id=?`, id).
		Scan(&l.ID, &l.UserID, &l.SourceID, &l.Name, &l.Type, &l.Amount, &l.Currency, &l.Note, &l.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func InsertLiabilityFlow(f *LiabilityFlow) (int64, error) {
	if f.Date == "" {
		f.Date = time.Now().Format("2006-01-02")
	}
	f.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO liability_flows(user_id,liability_id,date,type,amount,balance,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		f.UserID, f.LiabilityID, f.Date, f.Type, f.Amount, f.Balance, f.Note, f.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func ListLiabilityFlows(userID, liabilityID int64) ([]LiabilityFlow, error) {
	rows, err := DB.Query(`SELECT id,user_id,liability_id,date,type,amount,balance,note,created_at FROM liability_flows WHERE user_id=? AND liability_id=? ORDER BY id DESC`, userID, liabilityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LiabilityFlow
	for rows.Next() {
		var f LiabilityFlow
		if err := rows.Scan(&f.ID, &f.UserID, &f.LiabilityID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.Note, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ---- Cashflow plans (月度待入账 / 待还款计划) ----

type CashflowPlan struct {
	ID           int64   `json:"id"`
	UserID       int64   `json:"user_id"`
	Type         string  `json:"type"`         // income 待入账 | expense 待还款
	Title        string  `json:"title"`
	DayOfMonth   int     `json:"day_of_month"` // 每月几号（1-31），recurring_* 模式使用
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	AccountID    int64   `json:"account_id"`    // 关联子账户（入账/还款账户；incur 模式必填）
	LiabilityID  int64   `json:"liability_id"`  // 关联负债（仅 expense）
	Note         string  `json:"note"`
	EndDate      string  `json:"end_date"`      // 截止日期 YYYY-MM-DD，空=长期有效
	Pattern      string  `json:"pattern"`       // recurring_fixed | recurring_variable | one_time
	OneTimeDate  string  `json:"one_time_date"` // 一次性计划归属具体日期 YYYY-MM-DD
	LiabilityMode string `json:"liability_mode"` // repay(还款已有) | incur(产生新负债)，仅 expense
	CreatedAt    string  `json:"created_at"`
}

type CashflowDone struct {
	ID           int64   `json:"id"`
	UserID       int64   `json:"user_id"`
	PlanID       int64   `json:"plan_id"`
	YM           string  `json:"ym"`
	ActualAmount float64 `json:"actual_amount"`
	RefType      string  `json:"ref_type"` // cash | liability（完成时所记真实流水的类型）
	RefID        int64   `json:"ref_id"`   // cash_flow.id / liability_flows.id
	Note         string  `json:"note"`
	DoneAt       string  `json:"done_at"`
}

func ListCashflowPlans(uid int64) ([]CashflowPlan, error) {
	rows, err := DB.Query(`SELECT id,user_id,type,title,day_of_month,amount,currency,account_id,liability_id,note,end_date,pattern,one_time_date,liability_mode,created_at FROM cashflow_plans WHERE user_id=? ORDER BY (CASE WHEN pattern='one_time' THEN 1 ELSE 0 END), day_of_month ASC, id ASC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CashflowPlan
	for rows.Next() {
		var p CashflowPlan
		var typ, title, cur, note, pat, otd, lmode string
		if err := rows.Scan(&p.ID, &p.UserID, &typ, &title, &p.DayOfMonth, &p.Amount, &cur, &p.AccountID, &p.LiabilityID, &note, &p.EndDate, &pat, &otd, &lmode, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.Type, p.Title, p.Currency, p.Note, p.Pattern, p.OneTimeDate, p.LiabilityMode = typ, title, cur, note, pat, otd, lmode
		out = append(out, p)
	}
	return out, rows.Err()
}

func GetCashflowPlan(id int64) (*CashflowPlan, error) {
	var p CashflowPlan
	var typ, title, cur, note, pat, otd, lmode string
	err := DB.QueryRow(`SELECT id,user_id,type,title,day_of_month,amount,currency,account_id,liability_id,note,end_date,pattern,one_time_date,liability_mode,created_at FROM cashflow_plans WHERE id=?`, id).
		Scan(&p.ID, &p.UserID, &typ, &title, &p.DayOfMonth, &p.Amount, &cur, &p.AccountID, &p.LiabilityID, &note, &p.EndDate, &pat, &otd, &lmode, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Type, p.Title, p.Currency, p.Note, p.Pattern, p.OneTimeDate, p.LiabilityMode = typ, title, cur, note, pat, otd, lmode
	return &p, nil
}

func CreateCashflowPlan(p *CashflowPlan) (int64, error) {
	if err := checkEntityLimit(p.UserID, "cashflow_plans"); err != nil {
		return 0, err
	}
	if p.Currency == "" {
		p.Currency = "cny"
	}
	p.Currency = normCurrency(p.Currency)
	if p.Pattern == "" {
		p.Pattern = "recurring_fixed"
	}
	if p.LiabilityMode == "" {
		p.LiabilityMode = "repay"
	}
	p.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO cashflow_plans(user_id,type,title,day_of_month,amount,currency,account_id,liability_id,note,end_date,pattern,one_time_date,liability_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.UserID, p.Type, p.Title, p.DayOfMonth, p.Amount, p.Currency, p.AccountID, p.LiabilityID, p.Note, p.EndDate, p.Pattern, p.OneTimeDate, p.LiabilityMode, p.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateCashflowPlan(p *CashflowPlan) error {
	if p.Currency == "" {
		p.Currency = "cny"
	}
	p.Currency = normCurrency(p.Currency)
	if p.Pattern == "" {
		p.Pattern = "recurring_fixed"
	}
	if p.LiabilityMode == "" {
		p.LiabilityMode = "repay"
	}
	_, err := DB.Exec(`UPDATE cashflow_plans SET type=?,title=?,day_of_month=?,amount=?,currency=?,account_id=?,liability_id=?,note=?,end_date=?,pattern=?,one_time_date=?,liability_mode=? WHERE id=? AND user_id=?`,
		p.Type, p.Title, p.DayOfMonth, p.Amount, p.Currency, p.AccountID, p.LiabilityID, p.Note, p.EndDate, p.Pattern, p.OneTimeDate, p.LiabilityMode, p.ID, p.UserID)
	return err
}

func DeleteCashflowPlan(id, uid int64) error {
	// 连带清除完成记录（避免孤儿数据）
	_, _ = DB.Exec(`DELETE FROM cashflow_plan_done WHERE plan_id=? AND user_id=?`, id, uid)
	_, err := DB.Exec(`DELETE FROM cashflow_plans WHERE id=? AND user_id=?`, id, uid)
	return err
}

func GetCashflowDone(uid, planID int64, ym string) (*CashflowDone, error) {
	var d CashflowDone
	var note, refType, doneAt string
	err := DB.QueryRow(`SELECT id,plan_id,ym,actual_amount,ref_type,ref_id,note,done_at FROM cashflow_plan_done WHERE user_id=? AND plan_id=? AND ym=?`, uid, planID, ym).
		Scan(&d.ID, &d.PlanID, &d.YM, &d.ActualAmount, &refType, &d.RefID, &note, &doneAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Note, d.RefType, d.DoneAt = note, refType, doneAt
	d.UserID, d.YM = uid, ym
	return &d, nil
}

func UpsertCashflowDone(d *CashflowDone) error {
	d.DoneAt = time.Now().Format("2006-01-02 15:04:05")
	if existing, _ := GetCashflowDone(d.UserID, d.PlanID, d.YM); existing != nil {
		d.ID = existing.ID
		_, err := DB.Exec(`UPDATE cashflow_plan_done SET actual_amount=?,ref_type=?,ref_id=?,note=?,done_at=? WHERE id=?`,
			d.ActualAmount, d.RefType, d.RefID, d.Note, d.DoneAt, existing.ID)
		return err
	}
	res, err := DB.Exec(`INSERT INTO cashflow_plan_done(user_id,plan_id,ym,actual_amount,ref_type,ref_id,note,done_at) VALUES(?,?,?,?,?,?,?,?)`,
		d.UserID, d.PlanID, d.YM, d.ActualAmount, d.RefType, d.RefID, d.Note, d.DoneAt)
	if err != nil {
		return err
	}
	d.ID, _ = res.LastInsertId()
	return nil
}

func DeleteCashflowDone(uid, planID int64, ym string) error {
	_, err := DB.Exec(`DELETE FROM cashflow_plan_done WHERE user_id=? AND plan_id=? AND ym=?`, uid, planID, ym)
	return err
}

// HasCashRollback 判断某条现金流水是否已被回退（存在 ref_type='rollback' 且 ref_id=该流水ID 的反向流水）。
// 用于回退接口的幂等保护，避免同一笔被重复回退导致余额反冲两次。
func HasCashRollback(uid, flowID int64) (bool, error) {
	var n int
	err := DB.QueryRow(`SELECT COUNT(1) FROM cash_flow WHERE user_id=? AND ref_type='rollback' AND ref_id=?`, uid, flowID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// DeleteCashflowDoneByFlowRef 按「完成记录引用了这条流水」删除（纯账户扣款/入账类计划：完成记录 ref_type='cash' 且 ref_id=流水ID）。
func DeleteCashflowDoneByFlowRef(uid, flowID int64) error {
	_, err := DB.Exec(`DELETE FROM cashflow_plan_done WHERE user_id=? AND ref_type='cash' AND ref_id=?`, uid, flowID)
	return err
}

// DeleteCashflowDoneByPlanYM 按「计划+月份」删除完成记录。用于负债类计划：其完成记录的 ref_id 是负债ID
// （无法用流水ID定位），只能退化为按 计划ID + 流水月份 定位。
func DeleteCashflowDoneByPlanYM(uid, planID int64, ym string) error {
	_, err := DB.Exec(`DELETE FROM cashflow_plan_done WHERE user_id=? AND plan_id=? AND ym=?`, uid, planID, ym)
	return err
}

// ListCashflowDoneMonth 返回某用户某月份的全部完成记录，key 为 plan_id，便于前端一次性渲染勾选态。
func ListCashflowDoneMonth(uid int64, ym string) (map[int64]*CashflowDone, error) {
	rows, err := DB.Query(`SELECT plan_id,id,actual_amount,ref_type,ref_id,note,done_at FROM cashflow_plan_done WHERE user_id=? AND ym=?`, uid, ym)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]*CashflowDone{}
	for rows.Next() {
		var d CashflowDone
		var note, refType, doneAt string
		if err := rows.Scan(&d.PlanID, &d.ID, &d.ActualAmount, &refType, &d.RefID, &note, &doneAt); err != nil {
			return nil, err
		}
		d.Note, d.RefType, d.DoneAt = note, refType, doneAt
		d.UserID, d.YM = uid, ym
		out[d.PlanID] = &d
	}
	return out, rows.Err()
}

// HasReminderLog 判断某计划在某月份是否已发送过提醒，避免重复推送。
func HasReminderLog(planID, uid int64, ym string) (bool, error) {
	var n int
	err := DB.QueryRow(`SELECT COUNT(1) FROM cashflow_reminder_log WHERE plan_id=? AND user_id=? AND ym=?`, planID, uid, ym).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// InsertReminderLog 记录一次提醒发送（同 plan_id+ym 覆盖写入）。
func InsertReminderLog(planID, uid int64, ym, sentAt string) error {
	_, err := DB.Exec(`INSERT OR REPLACE INTO cashflow_reminder_log(plan_id,user_id,ym,sent_at) VALUES(?,?,?,?)`, planID, uid, ym, sentAt)
	return err
}

// SetLiabilityAmount 直接更新负债当前余额（还款/撤销还款时同步），不写流水。
func SetLiabilityAmount(id int64, amount float64) error {
	_, err := DB.Exec(`UPDATE liabilities SET amount=? WHERE id=?`, math.Round(amount*100)/100, id)
	return err
}

// GetCashFlow 按 id 取单条现金流水（撤销待还款入账时定位当初落账的流水）。
func GetCashFlow(id int64) (*CashFlow, error) {
	var f CashFlow
	var refName, note string
	err := DB.QueryRow(`SELECT id,user_id,cash_id,date,type,amount,balance,ref_type,ref_id,ref_name,note,created_at FROM cash_flow WHERE id=?`, id).
		Scan(&f.ID, &f.UserID, &f.CashID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.RefType, &f.RefID, &refName, &note, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	f.RefName, f.Note = refName, note
	return &f, nil
}

// GetLatestCashFlowByRef 取某引用（ref_type+ref_id）最近一条现金流水，用于定位待还款完成所记的真实流水。
func GetLatestCashFlowByRef(refType string, refID int64) (*CashFlow, error) {
	var f CashFlow
	var refName, note string
	err := DB.QueryRow(`SELECT id,user_id,cash_id,date,type,amount,balance,ref_type,ref_id,ref_name,note,created_at FROM cash_flow WHERE ref_type=? AND ref_id=? ORDER BY id DESC LIMIT 1`, refType, refID).
		Scan(&f.ID, &f.UserID, &f.CashID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.RefType, &f.RefID, &refName, &note, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	f.RefName, f.Note = refName, note
	return &f, nil
}

// GetLiabilityFlow 按 id 取单条负债流水。
func GetLiabilityFlow(id int64) (*LiabilityFlow, error) {
	var f LiabilityFlow
	err := DB.QueryRow(`SELECT id,user_id,liability_id,date,type,amount,balance,note,created_at FROM liability_flows WHERE id=?`, id).
		Scan(&f.ID, &f.UserID, &f.LiabilityID, &f.Date, &f.Type, &f.Amount, &f.Balance, &f.Note, &f.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// ---- 资金流水的修改 / 删除 ----
// 资金流水（cash_flow）与账户余额是一对镜像：任何对历史流水的改动都必须同步调整
// 对应账户的当前余额，否则账户余额会与流水明细对不上。负债流水（liability_flows）
// 同理需要同步 liabilities.amount。以下函数只做余额搬运，不额外写新流水。

// AdjustCashBalance 直接对现金账户余额做增减（delta 正=加、负=减），返回调整后余额。
func AdjustCashBalance(cashID int64, delta float64) (float64, error) {
	var amt float64
	if err := DB.QueryRow(`SELECT amount FROM cash_accounts WHERE id=?`, cashID).Scan(&amt); err != nil {
		return 0, err
	}
	bal := math.Round((amt+delta)*100) / 100
	if _, err := DB.Exec(`UPDATE cash_accounts SET amount=? WHERE id=?`, bal, cashID); err != nil {
		return 0, err
	}
	return bal, nil
}

// UpdateCashFlowRecord 修改一条现金流水的归属账户 / 金额 / 备注，并同步两个账户余额
// （旧账户冲销原金额、新账户应用新金额）。返回更新后的流水。
func UpdateCashFlowRecord(id, newCashID int64, newAmount float64, newNote string) (*CashFlow, error) {
	old, err := GetCashFlow(id)
	if err != nil {
		return nil, err
	}
	if old == nil {
		return nil, fmt.Errorf("流水不存在")
	}
	newAmount = math.Round(newAmount*100) / 100
	// 先冲销旧流水对旧账户的影响
	if _, err := AdjustCashBalance(old.CashID, -old.Amount); err != nil {
		return nil, err
	}
	// 再应用新流水到新账户
	bal, err := AdjustCashBalance(newCashID, newAmount)
	if err != nil {
		return nil, err
	}
	if _, err := DB.Exec(`UPDATE cash_flow SET cash_id=?, amount=?, balance=?, note=? WHERE id=?`,
		newCashID, newAmount, bal, strings.TrimSpace(newNote), id); err != nil {
		return nil, err
	}
	return GetCashFlow(id)
}

// DeleteCashFlowRecord 删除一条现金流水，并把其金额从对应账户余额中冲销。
func DeleteCashFlowRecord(id int64) error {
	old, err := GetCashFlow(id)
	if err != nil {
		return err
	}
	if old == nil {
		return nil
	}
	if _, err := AdjustCashBalance(old.CashID, -old.Amount); err != nil {
		return err
	}
	_, err = DB.Exec(`DELETE FROM cash_flow WHERE id=?`, id)
	return err
}

// liabilityEffect 返回一条负债流水对债务余额的影响：借入=+金额，还款=-金额。
func liabilityEffect(typ string, amount float64) float64 {
	if typ == "loan" {
		return amount
	}
	return -amount
}

// UpdateLiabilityFlowRecord 修改一条负债流水的类型 / 金额 / 备注，并同步负债当前余额。
func UpdateLiabilityFlowRecord(id int64, newType string, newAmount float64, newNote string) (*LiabilityFlow, error) {
	old, err := GetLiabilityFlow(id)
	if err != nil {
		return nil, err
	}
	if old == nil {
		return nil, fmt.Errorf("流水不存在")
	}
	if newType != "loan" && newType != "repay" {
		newType = old.Type
	}
	newAmount = math.Round(math.Abs(newAmount)*100) / 100
	l, err := GetLiability(old.LiabilityID)
	if err != nil {
		return nil, err
	}
	if l == nil {
		return nil, fmt.Errorf("关联负债不存在")
	}
	newBal := math.Round((l.Amount-liabilityEffect(old.Type, old.Amount)+liabilityEffect(newType, newAmount))*100) / 100
	if _, err := DB.Exec(`UPDATE liability_flows SET type=?, amount=?, balance=?, note=? WHERE id=?`,
		newType, newAmount, newBal, strings.TrimSpace(newNote), id); err != nil {
		return nil, err
	}
	if err := SetLiabilityAmount(old.LiabilityID, newBal); err != nil {
		return nil, err
	}
	return GetLiabilityFlow(id)
}

// DeleteLiabilityFlowRecord 删除一条负债流水，并反向冲销其对负债余额的影响。
func DeleteLiabilityFlowRecord(id int64) error {
	old, err := GetLiabilityFlow(id)
	if err != nil {
		return err
	}
	if old == nil {
		return nil
	}
	l, err := GetLiability(old.LiabilityID)
	if err != nil {
		return err
	}
	if l == nil {
		return nil
	}
	newBal := math.Round((l.Amount-liabilityEffect(old.Type, old.Amount))*100) / 100
	if _, err := DB.Exec(`DELETE FROM liability_flows WHERE id=?`, id); err != nil {
		return err
	}
	return SetLiabilityAmount(old.LiabilityID, newBal)
}

// ---- Consumptions（消费）已下线（2026-10-19）：consumptions 表保留兼容旧库，CRUD/汇总函数随之删除 ----

// ============================================================================
// 小工具计算器录入持久化（全局单份：equity=权益盈亏，usd=美元资产盈亏）
// ============================================================================

// initCalcInputs creates the keyed JSON store for calculator inputs.
func initCalcInputs() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS calc_inputs (
		kind      TEXT PRIMARY KEY,
		payload   TEXT NOT NULL DEFAULT '[]',
		updated_at TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

// SaveCalcInput upserts the payload JSON for a kind+user.
func SaveCalcInput(kind, payload string, userID int64) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := DB.Exec(`INSERT INTO calc_inputs(kind,user_id,payload,updated_at) VALUES(?,?,?,?)
		ON CONFLICT(kind,user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
		kind, userID, payload, now)
	return err
}

// CalcHoldingDays returns holding days from buy_date to today. Returns 0 if buy_date is empty or in the future.
func CalcHoldingDays(buyDate string) int {
	if buyDate == "" {
		return 0
	}
	t, err := time.Parse("2006-01-02", buyDate)
	if err != nil {
		return 0
	}
	now := time.Now()
	days := int(now.Sub(t).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

// ============================================================================
// 设置（风险偏好 / 资产类型标签等 JSON 配置）—— portfolio_settings
// ============================================================================

// initPortfolioSettings 建表：按 (kind, user_id) 隔离的 JSON 配置存储。
func initPortfolioSettings() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS portfolio_settings (
		kind       TEXT NOT NULL,
		user_id    INTEGER NOT NULL DEFAULT 0,
		payload    TEXT NOT NULL DEFAULT '{}',
		updated_at TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (kind, user_id)
	)`)
	return err
}

// GetSetting 读取某类设置的 JSON payload；不存在时返回 ok=false（调用方回退默认）。
func GetSetting(kind string, userID int64) (payload string, ok bool, err error) {
	var s string
	e := DB.QueryRow(`SELECT payload FROM portfolio_settings WHERE kind=? AND user_id=?`, kind, userID).Scan(&s)
	if e == sql.ErrNoRows {
		return "", false, nil
	}
	if e != nil {
		return "", false, e
	}
	if s == "" {
		s = "{}"
	}
	return s, true, nil
}

// SaveSetting 覆盖保存某类设置的 JSON payload（按 kind+user_id upsert）。
func SaveSetting(kind, payload string, userID int64) error {
	now := time.Now().Format("2006-01-02T15:04:05Z07:00")
	_, err := DB.Exec(`INSERT INTO portfolio_settings(kind,user_id,payload,updated_at) VALUES(?,?,?,?)
		ON CONFLICT(kind,user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
		kind, userID, payload, now)
	return err
}

// DeleteSetting 清空某类设置（下次读取回退到内置默认）。
func DeleteSetting(kind string, userID int64) error {
	_, err := DB.Exec(`DELETE FROM portfolio_settings WHERE kind=? AND user_id=?`, kind, userID)
	return err
}

// ============================================================================
// operation_guides 表为历史遗留（操作指南功能已删），保留表结构以兼容旧库，新代码不再读写。
// ============================================================================

func initOperationGuides() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS operation_guides (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL DEFAULT 0,
		holding_id INTEGER NOT NULL DEFAULT 0,
		title TEXT NOT NULL DEFAULT '',
		content TEXT NOT NULL DEFAULT '',
		tags TEXT NOT NULL DEFAULT '',
		side TEXT NOT NULL DEFAULT 'buy',
		created_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT ''
	)`)
	if err == nil {
		addColumnIfMissing("operation_guides", "side", "TEXT NOT NULL DEFAULT 'buy'")
	}
	return err
}
