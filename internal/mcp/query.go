package mcp

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"portfolio/internal/db"
	"portfolio/internal/market"
)

// registerQueryTools 注册只读查询类工具：账户/现金子账户、持仓、理财。
// 目的是让 AI 客户端先「看清」账本结构，再结合 record_transaction 记流水。
func (s *Server) registerQueryTools() {
	s.tools = append(s.tools, &Tool{
		Name: "list_accounts",
		Description: "列出当前账本的账户来源（平台/银行/券商等），默认内联其下的现金子账户（id/名称/币种/类型/余额/是否默认/备注）。" +
			"可用 source_id 只查某个来源；include_cash=false 可只返回来源列表。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id":    map[string]interface{}{"type": "integer", "description": "只返回该 id 的账户来源；省略返回全部。"},
				"include_cash": map[string]interface{}{"type": "boolean", "description": "是否内联该来源下的现金子账户，默认 true。"},
				"username":     map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":      map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listAccounts,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_cash_accounts",
		Description: "列出当前账本的现金子账户（扁平列表），含所属来源名称、id、币种、类型、余额、是否默认账户、备注。" +
			"可用 source_id / currency 过滤，并给出各币种余额合计。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id": map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的现金子账户；省略返回全部。"},
				"currency":  map[string]interface{}{"type": "string", "description": "只返回该币种（如 CNY/USD/HKD）的子账户；省略返回全部。"},
				"username":  map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":   map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listCashAccounts,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_holdings",
		Description: "列出当前账本的持仓：id、名称、代码、类别、市场、币种、所属来源、份额、成本价、现价、市值、浮动盈亏及盈亏百分比、资产类型、买入日期、备注。" +
			"默认过滤已清仓（份额为 0）的持仓，可设 include_closed=true 一并返回；已清仓行的 pnl/pnl_pct 为落袋口径（Σ减仓已实现盈亏 及 落袋÷本金，另带 realized_pnl/invested_cost 原始字段）；可用 source_id / symbol / category 过滤，并给出各币种市值与盈亏合计（在持为浮动口径、已清仓为落袋口径）。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id":      map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的持仓；省略返回全部。"},
				"symbol":         map[string]interface{}{"type": "string", "description": "按代码过滤（不分大小写，如 AAPL / 600519）；省略返回全部。"},
				"category":       map[string]interface{}{"type": "string", "description": "按类别过滤：stock | fund；省略返回全部。"},
				"include_closed": map[string]interface{}{"type": "boolean", "description": "是否包含份额为 0 的已清仓持仓，默认 false。"},
				"username":       map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":        map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listHoldings,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_wealth",
		Description: "列出当前账本的理财产品：id、名称、代码、币种、所属来源、最新持仓金额及快照日期、累计收益、备注。" +
			"可用 source_id 过滤，并给出各币种最新金额合计。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id": map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的理财产品；省略返回全部。"},
				"username":  map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":   map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listWealth,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_closed_records",
		Description: "列出当前账本全部已平仓记录（与页面「平仓」tab 同源同口径），三类合并：系统已清仓持仓（落袋=Σ减仓已实现盈亏）、已清仓理财（累计收益，手动值优先否则按每日快照累计）、手动补录平仓。" +
			"每条含 kind(stock/fund/wealth)、名称、代码、币种、落袋金额 amount（正=赚负=亏）、本金 principal（null=算不出）、持有期收益率% return_rate（null=算不出）、持有天数、清仓日期、来源；并给出折人民币落袋合计与分类小计。" +
			"分析历史落袋收益/胜率/复盘用本工具；在持仓仓用 list_holdings。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"username":  map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":   map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listClosedRecords,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_amount_modifiable",
		Description: "列出当前账本所有「金额可被 MCP 修改」的实体，即持仓(holding)、现金子账户(cash)、理财(wealth) 三类（加仓/减仓/分红、存入/取出、申购/赎回均走 record_transaction）。" +
			"返回每个实体的类型、id、名称、备注、币种、当前金额，以及支持的 mcp 动作列表，便于 AI 找到可改金额的目标并选择 action。" +
			"注意：负债(liability)与账户来源(source) 不支持 MCP 改金额，故不包含在内。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"entity_type": map[string]interface{}{"type": "string", "enum": []string{"holding", "cash", "wealth"}, "description": "只返回该类型的实体；省略返回全部三类。"},
				"username":    map[string]interface{}{"type": "string", "description": "归属账本名：省略则使用默认（首个）账本。"},
				"user_id":     map[string]interface{}{"type": "integer", "description": "归属账本 id：与 username 二选一；省略则使用默认账本。"},
			},
		},
		Handler: listAmountModifiable,
	})
}

// ---- 工具实现 ----

// sourceNames 返回 source_id → 来源名称 的映射，供列表类工具标注所属来源。
func sourceNames(uid int64) map[int64]string {
	m := map[int64]string{}
	if srcs, err := db.ListSources(uid); err == nil {
		for _, s := range srcs {
			m[s.ID] = s.Name
		}
	}
	return m
}

// marshalResult 统一把结果序列化为缩进 JSON 文本返回给 MCP 客户端。
func marshalResult(v interface{}) (string, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// listAccounts 账户来源 + 内联现金子账户。
func listAccounts(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	srcs, err := db.ListSources(uid)
	if err != nil {
		return "", fmt.Errorf("列举账户来源失败: %w", err)
	}
	includeCash := true
	if v, ok := args["include_cash"].(bool); ok {
		includeCash = v
	}
	sid := toInt64(args["source_id"])

	cashBySource := map[int64][]db.Cash{}
	if includeCash {
		cs, e := db.ListCash(uid)
		if e != nil {
			return "", fmt.Errorf("列举现金子账户失败: %w", e)
		}
		for _, c := range cs {
			cashBySource[c.SourceID] = append(cashBySource[c.SourceID], c)
		}
	}

	type cashRow struct {
		ID       int64   `json:"id"`
		Name     string  `json:"name"`
		Currency string  `json:"currency"`
		Type     string  `json:"type"`
		Amount   float64 `json:"amount"`
		Note     string  `json:"note"`
	}
	type srcRow struct {
		ID         int64              `json:"id"`
		Name       string             `json:"name"`
		Type       string             `json:"type"`
		Region     string             `json:"region"`
		Currencies string             `json:"currencies"`
		Note       string             `json:"note"`
		Cash       []cashRow          `json:"cash_accounts,omitempty"`
		CashTotal  map[string]float64 `json:"cash_total_by_currency,omitempty"`
	}

	out := []srcRow{}
	for _, src := range srcs {
		if sid > 0 && src.ID != sid {
			continue
		}
		r := srcRow{
			ID: src.ID, Name: src.Name, Type: src.Type,
			Region: src.Region, Currencies: src.Currencies,
			Note: strings.TrimSpace(src.Note),
		}
		if includeCash {
			rows := []cashRow{}
			tot := map[string]float64{}
			for _, c := range cashBySource[src.ID] {
				rows = append(rows, cashRow{
					ID: c.ID, Name: c.Name, Currency: c.Currency, Type: c.Type,
					Amount: round2(c.Amount),
					Note:   strings.TrimSpace(c.Note),
				})
				tot[c.Currency] = round2(tot[c.Currency] + c.Amount)
			}
			r.Cash = rows
			if len(tot) > 0 {
				r.CashTotal = tot
			}
		}
		out = append(out, r)
	}
	return marshalResult(map[string]interface{}{"count": len(out), "accounts": out})
}

// listCashAccounts 现金子账户扁平列表。
func listCashAccounts(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	sid := toInt64(args["source_id"])
	var cs []db.Cash
	if sid > 0 {
		if cs, err = db.ListCashBySource(uid, sid); err != nil {
			return "", fmt.Errorf("列举现金子账户失败: %w", err)
		}
	} else {
		if cs, err = db.ListCash(uid); err != nil {
			return "", fmt.Errorf("列举现金子账户失败: %w", err)
		}
	}
	cur := strings.TrimSpace(stringFrom(args, "currency"))
	names := sourceNames(uid)

	type row struct {
		ID       int64   `json:"id"`
		SourceID int64   `json:"source_id"`
		Source   string  `json:"source"`
		Name     string  `json:"name"`
		Currency string  `json:"currency"`
		Type     string  `json:"type"`
		Amount   float64 `json:"amount"`
		Note     string  `json:"note"`
	}
	out := []row{}
	total := map[string]float64{}
	for _, c := range cs {
		if cur != "" && !strings.EqualFold(c.Currency, cur) {
			continue
		}
		out = append(out, row{
			ID: c.ID, SourceID: c.SourceID, Source: names[c.SourceID],
			Name: c.Name, Currency: c.Currency, Type: c.Type,
			Amount: round2(c.Amount),
			Note:   strings.TrimSpace(c.Note),
		})
		total[c.Currency] = round2(total[c.Currency] + c.Amount)
	}
	return marshalResult(map[string]interface{}{
		"count": len(out), "total_by_currency": total, "cash_accounts": out,
	})
}

// listHoldings 持仓列表（默认不含份额为 0 的清仓记录）。
func listHoldings(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	hs, err := db.List(uid)
	if err != nil {
		return "", fmt.Errorf("列举持仓失败: %w", err)
	}
	includeClosed := false
	if v, ok := args["include_closed"].(bool); ok {
		includeClosed = v
	}
	sid := toInt64(args["source_id"])
	symbol := strings.TrimSpace(stringFrom(args, "symbol"))
	category := strings.TrimSpace(stringFrom(args, "category"))
	names := sourceNames(uid)

	type row struct {
		ID           int64   `json:"id"`
		Name         string  `json:"name"`
		Symbol       string  `json:"symbol"`
		Category     string  `json:"category"`
		Market       string  `json:"market"`
		Currency     string  `json:"currency"`
		SourceID     int64   `json:"source_id"`
		Source       string  `json:"source"`
		Quantity     float64 `json:"quantity"`
		CostPrice    float64 `json:"cost_price"`
		CurrentPrice float64 `json:"current_price"`
		MarketValue  float64 `json:"market_value"`
		Pnl          float64 `json:"pnl"`
		PnlPct       float64 `json:"pnl_pct"`
		// 已清仓行（quantity<=0）：Pnl/PnlPct 携带的是落袋口径（Σ position_tx.realized_pnl
		// 与 落袋÷本金）。浮动口径对清仓行恒为 0，直接算会把已实现的盈亏读丢。
		Closed       bool    `json:"closed"`
		RealizedPnl  float64 `json:"realized_pnl"`
		InvestedCost float64 `json:"invested_cost"` // 盈亏率分母（db.CostBasisOf 口径，0=算不出）
		AssetType    string  `json:"asset_type"`
		BuyDate      string  `json:"buy_date"`
		Note         string  `json:"note"`
	}
	out := []row{}
	marketByCur := map[string]float64{}
	pnlByCur := map[string]float64{}
	// 落袋口径一次批量取齐（与 /api/home 的 computeHoldings 同款聚合）
	ids := make([]int64, 0, len(hs))
	for _, h := range hs {
		ids = append(ids, h.ID)
	}
	realizedMap, _ := db.BatchSumRealizedPnl(ids)
	investMap, _ := db.BatchInvestedCost(ids)
	for _, h := range hs {
		if h.Quantity <= 0 && !includeClosed {
			continue
		}
		if sid > 0 && h.SourceID != sid {
			continue
		}
		if symbol != "" && !strings.EqualFold(h.Symbol, symbol) {
			continue
		}
		if category != "" && !strings.EqualFold(h.Category, category) {
			continue
		}
		mv := round2(h.Quantity * h.CurrentPrice)
		cost := h.Quantity * h.CostPrice
		pnl := round2(mv - cost)
		pct := 0.0
		if cost > 1e-9 {
			pct = round2(pnl / cost * 100)
		}
		closed := h.Quantity <= 0
		realized := round2(realizedMap[h.ID])
		basis := db.CostBasisOf(h, investMap[h.ID])
		if closed {
			// 已清仓：浮动口径恒为 0，改带落袋盈亏与落袋收益率（分母无本金时 pct=0，
			// AI 侧以 invested_cost 判断可不可比）
			pnl = realized
			if basis > 1e-9 {
				pct = round2(realized / basis * 100)
			}
		}
		out = append(out, row{
			ID: h.ID, Name: h.Name, Symbol: h.Symbol, Category: h.Category,
			Market: h.Market, Currency: h.Currency, SourceID: h.SourceID,
			Source: names[h.SourceID], Quantity: h.Quantity,
			CostPrice: h.CostPrice, CurrentPrice: h.CurrentPrice,
			MarketValue: mv, Pnl: pnl, PnlPct: pct,
			Closed: closed, RealizedPnl: realized, InvestedCost: round2(basis),
			AssetType: h.AssetType, BuyDate: h.BuyDate,
			Note: strings.TrimSpace(h.Note),
		})
		marketByCur[h.Currency] = round2(marketByCur[h.Currency] + mv)
		pnlByCur[h.Currency] = round2(pnlByCur[h.Currency] + pnl)
	}
	return marshalResult(map[string]interface{}{
		"count": len(out), "market_value_by_currency": marketByCur,
		"pnl_by_currency": pnlByCur, "holdings": out,
	})
}

// listWealth 理财产品列表（含最新快照金额）。
func listWealth(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	sid := toInt64(args["source_id"])
	var ws []db.WealthProduct
	if sid > 0 {
		if ws, err = db.ListWealthBySource(sid); err != nil {
			return "", fmt.Errorf("列举理财产品失败: %w", err)
		}
	} else {
		if ws, err = db.ListWealth(uid); err != nil {
			return "", fmt.Errorf("列举理财产品失败: %w", err)
		}
	}
	names := sourceNames(uid)

	type row struct {
		ID           int64   `json:"id"`
		Name         string  `json:"name"`
		Code         string  `json:"code"`
		Currency     string  `json:"currency"`
		SourceID     int64   `json:"source_id"`
		Source       string  `json:"source"`
		LatestAmount float64 `json:"latest_amount"`
		LatestDate   string  `json:"latest_date"`
		CumPnl       float64 `json:"cum_pnl"`
		Note         string  `json:"note"`
	}
	out := []row{}
	total := map[string]float64{}
	for _, w := range ws {
		// ListWealthBySource 不过滤账本，这里兜底排除不属于当前账本的数据。
		if w.UserID != 0 && w.UserID != uid {
			continue
		}
		amt, date := 0.0, ""
		if d, v, ok, e := db.GetWealthLatest(w.ID); e == nil && ok {
			date, amt = d, round2(v)
		}
		// 累计收益兜底与 /api/asset/overview 同口径：手动编辑值（CumPnl 非 0）优先，
		// 否则按每日快照累计。已清仓理财库内 cum_pnl 常为 0，不兜底会被 AI 读成 0，
		// 与前端表格（有兜底）对不上。
		cum := w.CumPnl
		if cum == 0 {
			cum = db.WealthCumPnl(w.ID)
		}
		out = append(out, row{
			ID: w.ID, Name: w.Name, Code: w.Code, Currency: w.Currency,
			SourceID: w.SourceID, Source: names[w.SourceID],
			LatestAmount: amt, LatestDate: date, CumPnl: round2(cum),
			Note: strings.TrimSpace(w.Note),
		})
		total[w.Currency] = round2(total[w.Currency] + amt)
	}
	return marshalResult(map[string]interface{}{
		"count": len(out), "amount_by_currency": total, "wealth": out,
	})
}

// listClosedRecords 已平仓全量视图（与页面「平仓」tab 同源同口径）：
// ① 系统已清仓持仓（quantity<=0，落袋 = Σ position_tx.realized_pnl，分母 db.CostBasisOf）；
// ② 已清仓理财（archived，累计收益手动值优先、快照累计兜底，本金反推 db.WealthPrincipalAtLastHold）；
// ③ 手动补录平仓（manual_closed_records，系统外发生的平仓不入账）。
// 合计折人民币（market.FetchFXRates），与页面落袋合计同一套汇率口径。
func listClosedRecords(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	cnyRate, hkdRate, _ := market.FetchFXRates()
	toCny := func(v float64, cur string) float64 {
		switch strings.ToLower(strings.TrimSpace(cur)) {
		case "usd":
			return v * cnyRate
		case "hkd":
			return v * hkdRate
		}
		return v
	}
	type row struct {
		Kind        string   `json:"kind"`         // stock | fund | wealth
		Source      string   `json:"source"`
		Name        string   `json:"name"`
		Code        string   `json:"code"`
		Currency    string   `json:"currency"`
		Amount      float64  `json:"amount"`       // 落袋盈亏（原币种，正=赚负=亏）
		Principal   *float64 `json:"principal"`    // 本金（null=算不出/未填，不参与收益率）
		ReturnRate  *float64 `json:"return_rate"`  // 持有期收益率 %（null=算不出）
		HoldingDays int      `json:"holding_days"`
		RealizedAt  string   `json:"realized_at"`  // 清仓日期 YYYY-MM-DD
	}
	out := []row{}
	addRow := func(r row) {
		if r.Currency == "" {
			r.Currency = "cny"
		}
		out = append(out, r)
	}
	names := sourceNames(uid)

	// ① 系统已清仓持仓
	hs, e := db.List(uid)
	if e != nil {
		return "", fmt.Errorf("列举持仓失败: %w", e)
	}
	ids := make([]int64, 0, len(hs))
	for _, h := range hs {
		ids = append(ids, h.ID)
	}
	realizedMap, _ := db.BatchSumRealizedPnl(ids)
	investMap, _ := db.BatchInvestedCost(ids)
	closeDateMap, _ := db.BatchLastSellDate(ids)
	for _, h := range hs {
		if h.Quantity > 0 {
			continue
		}
		realized := round2(realizedMap[h.ID])
		basis := db.CostBasisOf(h, investMap[h.ID])
		r := row{
			Kind: "stock", Source: names[h.SourceID], Name: h.Name, Code: h.Symbol,
			Currency: h.Currency, Amount: realized, RealizedAt: closeDateMap[h.ID],
		}
		if strings.EqualFold(h.Category, "fund") || strings.TrimSpace(h.LinkedSymbol) != "" {
			r.Kind = "fund"
		}
		if d := closeDateMap[h.ID]; d != "" && h.BuyDate != "" {
			r.HoldingDays = db.DaysBetweenDates(h.BuyDate, d)
		}
		if r.HoldingDays == 0 {
			r.HoldingDays = db.CalcHoldingDays(h.BuyDate)
		}
		if basis > 1e-9 {
			p := round2(basis)
			r.Principal = &p
			pct := round2(realized / basis * 100)
			r.ReturnRate = &pct
		}
		addRow(r)
	}

	// ② 已清仓理财
	ws, e := db.ListWealth(uid)
	if e != nil {
		return "", fmt.Errorf("列举理财失败: %w", e)
	}
	for _, w := range ws {
		if !w.Archived || (w.UserID != 0 && w.UserID != uid) {
			continue
		}
		cum := w.CumPnl
		if cum == 0 {
			cum = db.WealthCumPnl(w.ID)
		}
		r := row{Kind: "wealth", Source: names[w.SourceID], Name: w.Name, Code: w.Code, Currency: w.Currency, Amount: round2(cum)}
		snaps, _ := db.ListWealthSnapshots(w.ID)
		if len(snaps) > 0 {
			// 本金口径与总览一致：当前金额>0 用 金额−累计收益；已清仓金额为 0 时反推
			principal := math.NaN()
			if _, amt, ok, _ := db.GetWealthLatest(w.ID); ok && amt > 0.005 {
				principal = amt - cum
			}
			if math.IsNaN(principal) || principal <= 0.005 {
				principal = db.WealthPrincipalAtLastHold(snaps)
			}
			if !math.IsNaN(principal) && principal > 0.005 {
				p := round2(principal)
				r.Principal = &p
				pct := round2(cum / principal * 100)
				r.ReturnRate = &pct
			}
			firstDate, _, _ := db.GetWealthFirst(w.ID)
			r.HoldingDays = db.DaysBetweenDates(firstDate, snaps[len(snaps)-1].Date)
			r.RealizedAt = snaps[len(snaps)-1].Date
		}
		addRow(r)
	}

	// ③ 手动补录平仓
	ms, e := db.ListManualClosed(uid)
	if e != nil {
		return "", fmt.Errorf("列举手动平仓失败: %w", e)
	}
	for _, m := range ms {
		r := row{
			Kind: m.Kind, Source: m.Source, Name: m.Name, Code: m.Code,
			Currency: m.Currency, Amount: round2(m.Amount),
			HoldingDays: m.HoldingDays, RealizedAt: m.RealizedAt,
		}
		if m.Principal != nil {
			p := round2(*m.Principal)
			r.Principal = &p
		}
		if m.ReturnRate != nil {
			pct := round2(*m.ReturnRate)
			r.ReturnRate = &pct
		} else if r.Principal != nil && *r.Principal > 1e-9 {
			pct := round2(m.Amount / *r.Principal * 100)
			r.ReturnRate = &pct
		}
		addRow(r)
	}

	// 汇总：折人民币落袋合计 + 分类小计（胜率口径：金额>0 计盈、<0 计亏、0 不进分母）
	totalCny := 0.0
	byKind := map[string]float64{}
	winN, lossN := 0, 0
	for _, r := range out {
		c := toCny(r.Amount, r.Currency)
		totalCny += c
		byKind[r.Kind] = round2(byKind[r.Kind] + c)
		if r.Amount > 1e-9 {
			winN++
		} else if r.Amount < -1e-9 {
			lossN++
		}
	}
	summary := map[string]interface{}{}
	for k, v := range byKind {
		summary[k+"_cny"] = round2(v)
	}
	winRate := interface{}(nil)
	if winN+lossN > 0 {
		winRate = math.Round(float64(winN) / float64(winN+lossN) * 100)
	}
	return marshalResult(map[string]interface{}{
		"count":              len(out),
		"realized_total_cny": round2(totalCny),
		"by_kind_cny":        summary,
		"win_n":              winN,
		"loss_n":             lossN,
		"win_rate_pct":       winRate,
		"closed_records":     out,
	})
}

// listAmountModifiable 列出所有金额可被 MCP 修改的实体
// （持仓/现金子账户/理财），返回其支持的 mcp 动作与当前金额，便于 AI 选择目标改金额。
func listAmountModifiable(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	et := strings.ToLower(strings.TrimSpace(stringFrom(args, "entity_type")))

	type target struct {
		Type             string   `json:"type"`
		ID               int64    `json:"id"`
		Name             string   `json:"name"`
		Note             string   `json:"note"`
		Currency         string   `json:"currency"`
		CurrentAmount    float64  `json:"current_amount"`
		SupportedActions []string `json:"supported_actions"`
	}
	out := []target{}

	if et == "" || et == "holding" {
		hs, e := db.List(uid)
		if e != nil {
			return "", fmt.Errorf("列举持仓失败: %w", e)
		}
		for _, h := range hs {
			out = append(out, target{
				Type: "holding", ID: h.ID, Name: h.Name, Note: strings.TrimSpace(h.Note),
				Currency: h.Currency, CurrentAmount: round2(h.Quantity * h.CurrentPrice),
				SupportedActions: []string{"buy", "sell", "dividend"},
			})
		}
	}
	if et == "" || et == "cash" {
		cs, e := db.ListCash(uid)
		if e != nil {
			return "", fmt.Errorf("列举现金子账户失败: %w", e)
		}
		for _, c := range cs {
			out = append(out, target{
				Type: "cash", ID: c.ID, Name: c.Name, Note: strings.TrimSpace(c.Note),
				Currency: c.Currency, CurrentAmount: round2(c.Amount),
				SupportedActions: []string{"deposit", "withdraw"},
			})
		}
	}
	if et == "" || et == "wealth" {
		ws, e := db.ListWealth(uid)
		if e != nil {
			return "", fmt.Errorf("列举理财产品失败: %w", e)
		}
		for _, w := range ws {
			if w.UserID != 0 && w.UserID != uid {
				continue
			}
			amt := 0.0
			if _, v, ok, e2 := db.GetWealthLatest(w.ID); e2 == nil && ok {
				amt = round2(v)
			}
			out = append(out, target{
				Type: "wealth", ID: w.ID, Name: w.Name, Note: strings.TrimSpace(w.Note),
				Currency: w.Currency, CurrentAmount: amt,
				SupportedActions: []string{"subscribe", "redeem"},
			})
		}
	}

	return marshalResult(map[string]interface{}{
		"count": len(out), "amount_modifiable": out,
	})
}
