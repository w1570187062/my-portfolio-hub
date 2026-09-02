package db

import (
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
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
	LinkedSymbol string  `json:"linked_symbol"` // 基金关��的股票代码，非空时点击基金可做技术分析
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
		currency TEXT NOT NULL DEFAULT 'CNY',
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
	if err := initAISummaryHistory(); err != nil {
		return fmt.Errorf("init ai_summary_history: %w", err)
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
	if err := initAnalysisCache(); err != nil {
		return fmt.Errorf("init analysis_cache: %w", err)
	}
	if err := initAnalysisScript(); err != nil {
		return fmt.Errorf("init analysis_script: %w", err)
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
		generated_at      TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (symbol, date)
	)`)
	if err != nil {
		return err
	}
	// 索引：按 symbol 查最新缓存行
	_, err = DB.Exec(`CREATE INDEX IF NOT EXISTS idx_analysis_cache_symbol ON analysis_cache(symbol)`)
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
	GeneratedAt        string
}

// GetAnalysisCache returns the cached row for a symbol on a date, if any.
func GetAnalysisCache(symbol, date string) (*AnalysisCacheRow, error) {
	var r AnalysisCacheRow
	err := DB.QueryRow(`SELECT symbol,date,bars_json,indicators_json,probability_json,daily_signals_json,generated_at
		FROM analysis_cache WHERE symbol=? AND date=?`, symbol, date).
		Scan(&r.Symbol, &r.Date, &r.BarsJSON, &r.IndicatorsJSON, &r.ProbabilityJSON, &r.DailySignalsJSON, &r.GeneratedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SaveAnalysisCache upserts a cache row. JSON strings are stored as-is.
func SaveAnalysisCache(symbol, date, barsJSON, indicatorsJSON, probabilityJSON, dailySignalsJSON, generatedAt string) error {
	_, err := DB.Exec(`INSERT INTO analysis_cache(symbol,date,bars_json,indicators_json,probability_json,daily_signals_json,generated_at)
		VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(symbol,date) DO UPDATE SET
			bars_json=excluded.bars_json,
			indicators_json=excluded.indicators_json,
			probability_json=excluded.probability_json,
			daily_signals_json=excluded.daily_signals_json,
			generated_at=excluded.generated_at`,
		symbol, date, barsJSON, indicatorsJSON, probabilityJSON, dailySignalsJSON, generatedAt)
	return err
}

// ---- 自定义评级脚本（analysis_script）----
// 全局单行表（id=1 恒定）：保存用户在「资产工具 → 评级逻辑」编写的 JS 脚本。
// enabled=0 时走内置默认评分；enabled=1 时后端用 goja 执行 evaluate(ind)。
// 脚本异常/超时时自动降级默认逻辑，不影响分析可用性。

func initAnalysisScript() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS analysis_script (
		id         INTEGER PRIMARY KEY CHECK (id=1),
		code       TEXT    NOT NULL DEFAULT '',
		enabled    INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT    NOT NULL DEFAULT ''
	)`)
	if err != nil {
		return err
	}
	// 确保单行存在（空脚本+未启用）
	_, err = DB.Exec(`INSERT OR IGNORE INTO analysis_script(id, code, enabled, updated_at) VALUES(1, '', 0, '')`)
	return err
}

// AnalysisScript is the single global custom rating script row.
type AnalysisScript struct {
	Code      string `json:"code"`
	Enabled   bool   `json:"enabled"`
	UpdatedAt string `json:"updated_at"`
}

// GetAnalysisScript returns the global script row (always exists).
func GetAnalysisScript() (*AnalysisScript, error) {
	var s AnalysisScript
	var en int
	err := DB.QueryRow(`SELECT code, enabled, updated_at FROM analysis_script WHERE id=1`).
		Scan(&s.Code, &en, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	s.Enabled = en != 0
	return &s, nil
}

// SaveAnalysisScript upserts the global script (id=1).
func SaveAnalysisScript(code string, enabled bool, updatedAt string) error {
	en := 0
	if enabled {
		en = 1
	}
	_, err := DB.Exec(`INSERT INTO analysis_script(id, code, enabled, updated_at) VALUES(1, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET code=excluded.code, enabled=excluded.enabled, updated_at=excluded.updated_at`,
		code, en, updatedAt)
	return err
}

// ClearAnalysisCacheByDate drops all cached analysis rows for a date. Called
// when the custom script changes so stale engine results are not served.
func ClearAnalysisCacheByDate(date string) error {
	_, err := DB.Exec(`DELETE FROM analysis_cache WHERE date=?`, date)
	return err
}

// ---- 补仓计划「已执行」标记（buy_plan_executed）----
// 用户在某档补仓计划点「标记已补」后落库，用于界面置灰✓并排除出待触发信号。
// 与 position_tx 区分：此处仅记录"计划档位已执行"，不改动持仓数量/成本。

type BuyPlanExec struct {
	ID         int64   `json:"id"`
	HoldingID  int64   `json:"holding_id"`
	TierIndex  int     `json:"tier_index"` // 补仓计划 Tiers 数组下标（档位稳定按序）
	TierLabel  string  `json:"tier_label"`
	Action     string  `json:"action"` // buy=标记已补, sell=标记已减
	Price      float64 `json:"price"`
	Amount     float64 `json:"amount"`
	Note       string  `json:"note"`
	CreatedAt  string  `json:"created_at"`
}

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

// SaveExecutedBuyPlan records that a buy-plan tier was executed ("标记已补").
func SaveExecutedBuyPlan(tx *BuyPlanExec) error {
	tx.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	if tx.Action == "" {
		tx.Action = "buy"
	}
	_, err := DB.Exec(`INSERT INTO buy_plan_executed(holding_id,tier_index,tier_label,action,price,amount,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		tx.HoldingID, tx.TierIndex, tx.TierLabel, tx.Action, tx.Price, tx.Amount, tx.Note, tx.CreatedAt)
	return err
}

// ListExecutedBuyPlans returns executed tiers for a holding, newest first.
func ListExecutedBuyPlans(holdingID int64) ([]BuyPlanExec, error) {
	rows, err := DB.Query(`SELECT id,holding_id,tier_index,tier_label,action,price,amount,note,created_at FROM buy_plan_executed WHERE holding_id=? ORDER BY id DESC`, holdingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BuyPlanExec
	for rows.Next() {
		var t BuyPlanExec
		if err := rows.Scan(&t.ID, &t.HoldingID, &t.TierIndex, &t.TierLabel, &t.Action, &t.Price, &t.Amount, &t.Note, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListExecutedBuyPlanKeys returns the set of executed tier keys as "holdingID:tierIndex".
// Used by the notify path to exclude executed tiers from pending "补仓信号".
func ListExecutedBuyPlanKeys() (map[string]bool, error) {
	rows, err := DB.Query(`SELECT holding_id, tier_index FROM buy_plan_executed`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]bool{}
	for rows.Next() {
		var hid int64
		var idx int
		if err := rows.Scan(&hid, &idx); err != nil {
			return nil, err
		}
		m[fmt.Sprintf("%d:%d", hid, idx)] = true
	}
	return m, rows.Err()
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
	ID          int64   `json:"id"`
	HoldingID   int64   `json:"holding_id"`
	TxType      string  `json:"tx_type"` // BUY (加仓) | SELL (减仓)
	Quantity    float64 `json:"quantity"`
	Price       float64 `json:"price"`
	Amount      float64 `json:"amount"` // 成交金额 = quantity * price
	Fee         float64 `json:"fee"`    // 买入/卖出成本（手续费/佣金）
	RealizedPnl float64 `json:"realized_pnl"`
	Note        string  `json:"note"`
	CreatedAt   string  `json:"created_at"`
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
	return err
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
	return nil
}

// InsertPositionTx records one 加仓/减仓 transaction.
func InsertPositionTx(tx *PositionTx) error {
	_, err := DB.Exec(`INSERT INTO position_tx(holding_id,tx_type,quantity,price,amount,fee,realized_pnl,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		tx.HoldingID, tx.TxType, tx.Quantity, tx.Price, tx.Amount, tx.Fee, tx.RealizedPnl, tx.Note, tx.CreatedAt)
	return err
}

// ListPositionTx returns all transactions for a holding, newest first.
func ListPositionTx(holdingID int64) ([]PositionTx, error) {
	rows, err := DB.Query(`SELECT id,holding_id,tx_type,quantity,price,amount,fee,realized_pnl,note,created_at FROM position_tx WHERE holding_id=? ORDER BY id DESC`, holdingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PositionTx
	for rows.Next() {
		var t PositionTx
		if err := rows.Scan(&t.ID, &t.HoldingID, &t.TxType, &t.Quantity, &t.Price, &t.Amount, &t.Fee, &t.RealizedPnl, &t.Note, &t.CreatedAt); err != nil {
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
func RecordRealizedPnl(uid int64, date string, holdingID int64, symbol, name, currency string, amount float64) error {
	_, err := DB.Exec(`INSERT INTO realized_pnl_daily(user_id,date,holding_id,symbol,name,currency,amount,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		uid, date, holdingID, symbol, name, currency, amount, time.Now().Format("2006-01-02 15:04:05"))
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

// AdjustHolding applies a 加仓/减仓 transaction to a holding: it updates the
// holding's quantity & average cost basis and records the transaction.
//   - BUY:  new_qty = qty + quantity;
//           new_cost = (qty*cost + quantity*price + fee) / new_qty   (摊薄后的平均成本)
//   - SELL: realized = (price - cost)*quantity - fee;
//           remaining cost basis unchanged; if qty hits 0 the cost basis resets to 0.
// Returns the updated holding and the realized P&L of THIS transaction.
func AdjustHolding(id int64, txType string, quantity, price, fee float64, note string) (h *Holding, realizedPnl float64, err error) {
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
		CreatedAt:   time.Now().Format("2006-01-02 15:04:05"),
	}
	if err := InsertPositionTx(&tx); err != nil {
		return nil, 0, err
	}
	return cur, realized, nil
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

func Create(h *Holding) (int64, error) {
	h.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec("INSERT INTO holdings(name,symbol,category,market,currency,source_id,quantity,cost_price,current_price,prev_close,note,linked_symbol,buy_date,buy_plan,user_id,updated_at,transaction_cost,asset_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		h.Name, h.Symbol, h.Category, h.Market, h.Currency, h.SourceID, h.Quantity, h.CostPrice, h.CurrentPrice, h.PrevClose, h.Note, h.LinkedSymbol, h.BuyDate, h.BuyPlan, h.UserID, h.UpdatedAt, h.TransactionCost, h.AssetType)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// roundByCategory 按类别约束价格小数位：基金保留 4 位，其余（股票等）保留 2 位。
// 采用四舍五入（与前端口径一致），清理浮点运算产生的超长尾数，避免摊薄成本 / 计算器展示爆位数。
func roundByCategory(cat string, v float64) float64 {
	prec := 4
	if cat != "fund" {
		prec = 2
	}
	scale := math.Pow(10, float64(prec))
	return math.Round(v*scale) / scale
}

func Update(h *Holding) error {
	h.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
	h.CostPrice = roundByCategory(h.Category, h.CostPrice)
	h.CurrentPrice = roundByCategory(h.Category, h.CurrentPrice)
	h.PrevClose = roundByCategory(h.Category, h.PrevClose)
	h.TransactionCost = roundByCategory(h.Category, h.TransactionCost)
	_, err := DB.Exec("UPDATE holdings SET name=?,symbol=?,category=?,market=?,currency=?,source_id=?,quantity=?,cost_price=?,current_price=?,prev_close=?,note=?,linked_symbol=?,buy_date=?,buy_plan=?,user_id=?,updated_at=?,closed=?,last_quantity=?,last_cost_price=?,transaction_cost=?,asset_type=? WHERE id=?",
		h.Name, h.Symbol, h.Category, h.Market, h.Currency, h.SourceID, h.Quantity, h.CostPrice, h.CurrentPrice, h.PrevClose, h.Note, h.LinkedSymbol, h.BuyDate, h.BuyPlan, h.UserID, h.UpdatedAt, h.Closed, h.LastQuantity, h.LastCostPrice, h.TransactionCost, h.AssetType, h.ID)
	return err
}

// SaveBuyPlan persists the computed 补仓计划 JSON for a holding (used by the
// net-value refresh path). It never touches the note column.
func SaveBuyPlan(id int64, plan string) error {
	_, err := DB.Exec("UPDATE holdings SET buy_plan=?, updated_at=? WHERE id=?",
		plan, time.Now().Format("2006-01-02 15:04:05"), id)
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

// SavePnlDaily upserts the daily P&L summary for a date and user.
func SavePnlDaily(date string, totalCNY, totalUSD, rate float64, detail string, userID int64) error {
	_, err := DB.Exec(`INSERT INTO pnl_daily(date,user_id,total_cny,total_usd,rate,detail) VALUES(?,?,?,?,?,?)
		ON CONFLICT(date,user_id) DO UPDATE SET total_cny=excluded.total_cny, total_usd=excluded.total_usd, rate=excluded.rate, detail=excluded.detail`,
		date, userID, totalCNY, totalUSD, rate, detail)
	return err
}

// PnlDay is one day's P&L record.
type PnlDay struct {
	Date     string  `json:"date"`
	UserID   int64   `json:"user_id"`
	TotalCNY float64 `json:"total_cny"`
	TotalUSD float64 `json:"total_usd"`
	Rate     float64 `json:"rate"`
	Detail   string  `json:"detail"`
}

// GetPnlHistory returns a user's daily P&L records ordered by date ascending.
func GetPnlHistory(userID int64) ([]PnlDay, error) {
	rows, err := DB.Query(`SELECT date,user_id,total_cny,total_usd,rate,detail FROM pnl_daily WHERE user_id=? ORDER BY date ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PnlDay
	for rows.Next() {
		var p PnlDay
		if err := rows.Scan(&p.Date, &p.UserID, &p.TotalCNY, &p.TotalUSD, &p.Rate, &p.Detail); err != nil {
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

// ---- AI summary history (keep latest 10) ----

func initAISummaryHistory() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS ai_summary_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		created_at TEXT NOT NULL,
		model TEXT NOT NULL DEFAULT '',
		content TEXT NOT NULL
	)`)
	return err
}

// SaveAISummary inserts a record and trims the table to the most recent 10 per user.
func SaveAISummary(content, model string, userID int64) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	if _, err := DB.Exec(`INSERT INTO ai_summary_history(user_id,created_at,model,content) VALUES(?,?,?,?)`, userID, now, model, content); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM ai_summary_history WHERE user_id=? AND id NOT IN (SELECT id FROM ai_summary_history WHERE user_id=? ORDER BY id DESC LIMIT 5)`, userID, userID)
	return err
}

// AISummaryRecord is one saved AI summary.
type AISummaryRecord struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	CreatedAt string `json:"created_at"`
	Model     string `json:"model"`
	Content   string `json:"content"`
}

// GetAISummaryHistory returns a user's most recent records (newest first), up to limit.
func GetAISummaryHistory(limit int, userID int64) ([]AISummaryRecord, error) {
	rows, err := DB.Query(`SELECT id,user_id,created_at,model,content FROM ai_summary_history WHERE user_id=? ORDER BY id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AISummaryRecord
	for rows.Next() {
		var r AISummaryRecord
		if err := rows.Scan(&r.ID, &r.UserID, &r.CreatedAt, &r.Model, &r.Content); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
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
			region TEXT NOT NULL DEFAULT 'domestic',
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS wealth_products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL DEFAULT 0,
			name TEXT NOT NULL DEFAULT '',
			code TEXT NOT NULL DEFAULT '',
			currency TEXT NOT NULL DEFAULT 'rmb',
			cum_pnl REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
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
			currency TEXT NOT NULL DEFAULT 'rmb',
			amount REAL NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
	}
	for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			return err
		}
	}
	// Migrations for columns added after first release.
	addColumnIfMissing("wealth_products", "currency", "TEXT NOT NULL DEFAULT 'rmb'")
	addColumnIfMissing("wealth_products", "cum_pnl", "REAL NOT NULL DEFAULT 0")
	addColumnIfMissing("asset_sources", "region", "TEXT NOT NULL DEFAULT 'domestic'")
	return nil
}

// ---- Asset sources (资产来源 / 账户) ----

type AssetSource struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	Type      string `json:"type"` // bank | securities | software | platform
	Region    string `json:"region"` // domestic 境内 | overseas 境外
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

func ListSources(userID int64) ([]AssetSource, error) {
	rows, err := DB.Query(`SELECT id,user_id,name,type,region,note,created_at FROM asset_sources WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssetSource
	for rows.Next() {
		var s AssetSource
		if err := rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Type, &s.Region, &s.Note, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func CreateSource(s *AssetSource) (int64, error) {
	s.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO asset_sources(user_id,name,type,region,note,created_at) VALUES(?,?,?,?,?,?)`,
		s.UserID, s.Name, s.Type, s.Region, s.Note, s.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateSource(s *AssetSource) error {
	_, err := DB.Exec(`UPDATE asset_sources SET user_id=?,name=?,type=?,region=?,note=? WHERE id=?`, s.UserID, s.Name, s.Type, s.Region, s.Note, s.ID)
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
	if _, err := DB.Exec(`DELETE FROM liabilities WHERE source_id=?`, id); err != nil {
		return err
	}
	if _, err := DB.Exec(`UPDATE consumptions SET source_id=0 WHERE source_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM asset_sources WHERE id=?`, id)
	return err
}

// SourceRefCount 返回该来源被引用的条目总数（持仓/理财/现金/负债/消费 引用该来源的数量之和）。
func SourceRefCount(sourceID int64) (int, error) {
	n := 0
	for _, tbl := range []string{"holdings", "wealth_products", "cash_accounts", "liabilities", "consumptions"} {
		var c int
		if err := DB.QueryRow(`SELECT COUNT(*) FROM `+tbl+` WHERE source_id=?`, sourceID).Scan(&c); err != nil {
			return 0, err
		}
		n += c
	}
	return n, nil
}

// ---- Wealth products (理财) ----

type WealthProduct struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	SourceID  int64   `json:"source_id"`
	Name      string  `json:"name"`
	Code      string  `json:"code"`
	Currency  string  `json:"currency"`
	Note      string  `json:"note"`
	CumPnl    float64 `json:"cum_pnl"` // 累计收益：手动编辑值优先；为 0 时由每日快照自动累计。
	CreatedAt string  `json:"created_at"`
}

func ListWealth(userID int64) ([]WealthProduct, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,code,currency,cum_pnl,note,created_at FROM wealth_products WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthProduct
	for rows.Next() {
		var w WealthProduct
		if err := rows.Scan(&w.ID, &w.UserID, &w.SourceID, &w.Name, &w.Code, &w.Currency, &w.CumPnl, &w.Note, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func ListWealthBySource(sourceID int64) ([]WealthProduct, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,code,currency,cum_pnl,note,created_at FROM wealth_products WHERE source_id=? ORDER BY id DESC`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthProduct
	for rows.Next() {
		var w WealthProduct
		if err := rows.Scan(&w.ID, &w.UserID, &w.SourceID, &w.Name, &w.Code, &w.Currency, &w.CumPnl, &w.Note, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func CreateWealth(w *WealthProduct) (int64, error) {
	if w.Currency == "" {
		w.Currency = "rmb"
	}
	w.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO wealth_products(user_id,source_id,name,code,currency,cum_pnl,note,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		w.UserID, w.SourceID, w.Name, w.Code, w.Currency, w.CumPnl, w.Note, w.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateWealth(w *WealthProduct) error {
	if w.Currency == "" {
		w.Currency = "rmb"
	}
	_, err := DB.Exec(`UPDATE wealth_products SET user_id=?,source_id=?,name=?,code=?,currency=?,cum_pnl=?,note=? WHERE id=?`,
		w.UserID, w.SourceID, w.Name, w.Code, w.Currency, w.CumPnl, w.Note, w.ID)
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
	Amount    float64 `json:"amount"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

func ListCash(userID int64) ([]Cash, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,currency,amount,note,created_at FROM cash_accounts WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Cash
	for rows.Next() {
		var c Cash
		if err := rows.Scan(&c.ID, &c.UserID, &c.SourceID, &c.Name, &c.Currency, &c.Amount, &c.Note, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func CreateCash(c *Cash) (int64, error) {
	if c.Currency == "" {
		c.Currency = "rmb"
	}
	c.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO cash_accounts(user_id,source_id,name,currency,amount,note,created_at) VALUES(?,?,?,?,?,?,?)`,
		c.UserID, c.SourceID, c.Name, c.Currency, c.Amount, c.Note, c.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateCash(c *Cash) error {
	if c.Currency == "" {
		c.Currency = "rmb"
	}
	_, err := DB.Exec(`UPDATE cash_accounts SET user_id=?,source_id=?,name=?,currency=?,amount=?,note=? WHERE id=?`,
		c.UserID, c.SourceID, c.Name, c.Currency, c.Amount, c.Note, c.ID)
	return err
}

func DeleteCash(id int64) error {
	_, err := DB.Exec(`DELETE FROM cash_accounts WHERE id=?`, id)
	return err
}

// ---- Wealth daily snapshots (每日持仓金额) ----

type WealthSnapshot struct {
	WealthID int64   `json:"wealth_id"`
	Date     string  `json:"date"`
	Amount   float64 `json:"amount"`
	Cashflow float64 `json:"cashflow"`
}

// GetWealthSnapshot returns the snapshot for a wealth product on a specific date.
func GetWealthSnapshot(wealthID int64, date string) (amount, cashflow float64, ok bool, err error) {
	err = DB.QueryRow(`SELECT amount, cashflow FROM wealth_snapshots WHERE wealth_id=? AND date=?`, wealthID, date).
		Scan(&amount, &cashflow)
	if err == sql.ErrNoRows {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	return amount, cashflow, true, nil
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

func UpsertWealthSnapshot(wealthID int64, date string, amount, cashflow float64) error {
	_, err := DB.Exec(`INSERT INTO wealth_snapshots(wealth_id,date,amount,cashflow) VALUES(?,?,?,?)
		ON CONFLICT(wealth_id,date) DO UPDATE SET amount=excluded.amount, cashflow=excluded.cashflow`,
		wealthID, date, amount, cashflow)
	return err
}

func ListWealthSnapshots(wealthID int64) ([]WealthSnapshot, error) {
	rows, err := DB.Query(`SELECT wealth_id,date,amount,cashflow FROM wealth_snapshots WHERE wealth_id=? ORDER BY date ASC`, wealthID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthSnapshot
	for rows.Next() {
		var s WealthSnapshot
		if err := rows.Scan(&s.WealthID, &s.Date, &s.Amount, &s.Cashflow); err != nil {
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
	ID         int64   `json:"id"`
	WealthID   int64   `json:"wealth_id"`
	Date       string  `json:"date"`
	Action     string  `json:"action"` // 'upsert' | 'delete' | 'undo'
	Field      string  `json:"field"`
	OldAmount  float64 `json:"old_amount"`
	OldCash    float64 `json:"old_cashflow"`
	NewAmount  float64 `json:"new_amount"`
	NewCash    float64 `json:"new_cashflow"`
	OldExists  bool    `json:"old_exists"`
	UserID     int64   `json:"user_id"`
	CreatedAt  string  `json:"created_at"`
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

// DeleteWealthSnapshot 删除某产品某天的快照行。
func DeleteWealthSnapshot(wealthID int64, date string) error {
	_, err := DB.Exec(`DELETE FROM wealth_snapshots WHERE wealth_id=? AND date=?`, wealthID, date)
	return err
}

// InsertWealthAudit 写入一条审计记录。
func InsertWealthAudit(a WealthAudit) error {
	_, err := DB.Exec(`INSERT INTO wealth_snapshot_audit(wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_exists,user_id,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		a.WealthID, a.Date, a.Action, a.Field, a.OldAmount, a.OldCash, a.NewAmount, a.NewCash, boolToInt(a.OldExists), a.UserID, a.CreatedAt)
	return err
}

// ListWealthAudit 返回某产品的审计记录（新→旧）。
func ListWealthAudit(wealthID int64) ([]WealthAudit, error) {
	rows, err := DB.Query(`SELECT id,wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_exists,user_id,created_at
		FROM wealth_snapshot_audit WHERE wealth_id=? ORDER BY id DESC`, wealthID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WealthAudit
	for rows.Next() {
		var a WealthAudit
		var oldExists int
		if err := rows.Scan(&a.ID, &a.WealthID, &a.Date, &a.Action, &a.Field, &a.OldAmount, &a.OldCash, &a.NewAmount, &a.NewCash, &oldExists, &a.UserID, &a.CreatedAt); err != nil {
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
	err := DB.QueryRow(`SELECT id,wealth_id,date,action,field,old_amount,old_cashflow,new_amount,new_cashflow,old_exists,user_id,created_at
		FROM wealth_snapshot_audit WHERE id=?`, id).
		Scan(&a.ID, &a.WealthID, &a.Date, &a.Action, &a.Field, &a.OldAmount, &a.OldCash, &a.NewAmount, &a.NewCash, &oldExists, &a.UserID, &a.CreatedAt)
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

type Liability struct {
	ID            int64   `json:"id"`
	UserID        int64   `json:"user_id"`
	SourceID      int64   `json:"source_id"`
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Amount        float64 `json:"amount"`
	Rate          float64 `json:"rate"`
	MonthlyPayment float64 `json:"monthly_payment"`
	Note          string  `json:"note"`
	CreatedAt     string  `json:"created_at"`
}

func ListLiabilities(userID int64) ([]Liability, error) {
	rows, err := DB.Query(`SELECT id,user_id,source_id,name,type,amount,rate,monthly_payment,note,created_at FROM liabilities WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Liability
	for rows.Next() {
		var l Liability
		if err := rows.Scan(&l.ID, &l.UserID, &l.SourceID, &l.Name, &l.Type, &l.Amount, &l.Rate, &l.MonthlyPayment, &l.Note, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func CreateLiability(l *Liability) (int64, error) {
	l.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO liabilities(user_id,source_id,name,type,amount,rate,monthly_payment,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		l.UserID, l.SourceID, l.Name, l.Type, l.Amount, l.Rate, l.MonthlyPayment, l.Note, l.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateLiability(l *Liability) error {
	_, err := DB.Exec(`UPDATE liabilities SET user_id=?,source_id=?,name=?,type=?,amount=?,rate=?,monthly_payment=?,note=? WHERE id=?`,
		l.UserID, l.SourceID, l.Name, l.Type, l.Amount, l.Rate, l.MonthlyPayment, l.Note, l.ID)
	return err
}

func DeleteLiability(id int64) error {
	_, err := DB.Exec(`DELETE FROM liabilities WHERE id=?`, id)
	return err
}

// ---- Consumptions (消费) ----

type Consumption struct {
	ID        int64   `json:"id"`
	UserID    int64   `json:"user_id"`
	Date      string  `json:"date"`
	SourceID  int64   `json:"source_id"`
	Category  string  `json:"category"`
	Amount    float64 `json:"amount"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

func ListConsumptions(limit int, userID int64) ([]Consumption, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := DB.Query(`SELECT id,user_id,date,source_id,category,amount,note,created_at FROM consumptions WHERE user_id=? ORDER BY date DESC, id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Consumption
	for rows.Next() {
		var c Consumption
		if err := rows.Scan(&c.ID, &c.UserID, &c.Date, &c.SourceID, &c.Category, &c.Amount, &c.Note, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func CreateConsumption(c *Consumption) (int64, error) {
	if c.Date == "" {
		c.Date = time.Now().Format("2006-01-02")
	}
	c.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO consumptions(user_id,date,source_id,category,amount,note,created_at) VALUES(?,?,?,?,?,?,?)`,
		c.UserID, c.Date, c.SourceID, c.Category, c.Amount, c.Note, c.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateConsumption(c *Consumption) error {
	if c.Date == "" {
		c.Date = time.Now().Format("2006-01-02")
	}
	_, err := DB.Exec(`UPDATE consumptions SET user_id=?,date=?,source_id=?,category=?,amount=?,note=? WHERE id=?`,
		c.UserID, c.Date, c.SourceID, c.Category, c.Amount, c.Note, c.ID)
	return err
}

func DeleteConsumption(id int64) error {
	_, err := DB.Exec(`DELETE FROM consumptions WHERE id=?`, id)
	return err
}

// ConsumptionSum returns the total spent on a given day (YYYY-MM-DD) for a user.
func ConsumptionSum(day string, userID int64) (float64, error) {
	var s float64
	err := DB.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM consumptions WHERE date=? AND user_id=?`, day, userID).Scan(&s)
	return s, err
}

// ConsumptionSumMonth returns the total spent in a given month (YYYY-MM) for a user.
func ConsumptionSumMonth(month string, userID int64) (float64, error) {
	var s float64
	err := DB.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM consumptions WHERE date LIKE ? AND user_id=?`, month+"%", userID).Scan(&s)
	return s, err
}

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

// GetCalcInput returns the stored payload (raw JSON string) for a kind+user.
// ok is false when no row exists yet (caller should treat as empty).
func GetCalcInput(kind string, userID int64) (payload string, ok bool, err error) {
	var p string
	e := DB.QueryRow(`SELECT payload FROM calc_inputs WHERE kind=? AND user_id=?`, kind, userID).Scan(&p)
	if e == sql.ErrNoRows {
		return "", false, nil
	}
	if e != nil {
		return "", false, e
	}
	if p == "" {
		p = "[]"
	}
	return p, true, nil
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

// DeleteCalcInput removes the stored inputs for a kind+user (used by 清空).
func DeleteCalcInput(kind string, userID int64) error {
	_, err := DB.Exec(`DELETE FROM calc_inputs WHERE kind=? AND user_id=?`, kind, userID)
	return err
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
// 操作指南（买卖记录/笔记）—— operation_guides
// ============================================================================

// OperationGuide records a trading decision / note.
type OperationGuide struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	HoldingID int64  `json:"holding_id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Tags      string `json:"tags"`
	Side      string `json:"side"` // buy / sell
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

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

func InsertOperationGuide(g *OperationGuide) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	g.CreatedAt = now
	g.UpdatedAt = now
	if g.Side == "" {
		g.Side = "buy"
	}
	res, err := DB.Exec(`INSERT INTO operation_guides(user_id,holding_id,title,content,tags,side,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
		g.UserID, g.HoldingID, g.Title, g.Content, g.Tags, g.Side, g.CreatedAt, g.UpdatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateOperationGuide(g *OperationGuide) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	if g.Side == "" {
		g.Side = "buy"
	}
	_, err := DB.Exec(`UPDATE operation_guides SET holding_id=?,title=?,content=?,tags=?,side=?,updated_at=? WHERE id=?`,
		g.HoldingID, g.Title, g.Content, g.Tags, g.Side, now, g.ID)
	return err
}

func DeleteOperationGuide(id int64) error {
	_, err := DB.Exec(`DELETE FROM operation_guides WHERE id=?`, id)
	return err
}

func ListOperationGuides(userID int64) ([]OperationGuide, error) {
	rows, err := DB.Query(`SELECT id,user_id,holding_id,title,content,tags,side,created_at,updated_at FROM operation_guides WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OperationGuide
	for rows.Next() {
		var r OperationGuide
		if err := rows.Scan(&r.ID, &r.UserID, &r.HoldingID, &r.Title, &r.Content, &r.Tags, &r.Side, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if out == nil {
		out = []OperationGuide{}
	}
	return out, rows.Err()
}

func GetOperationGuide(id int64) (*OperationGuide, error) {
	row := DB.QueryRow(`SELECT id,holding_id,title,content,tags,side,created_at,updated_at FROM operation_guides WHERE id=?`, id)
	var r OperationGuide
	if err := row.Scan(&r.ID, &r.HoldingID, &r.Title, &r.Content, &r.Tags, &r.Side, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}
