package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"portfolio/internal/db"
)

// registerQueryTools 注册只读查询类工具：账户/现金子账户、持仓、理财。
// 目的是让 AI 客户端先「看清」账本结构，再结合 record_transaction 记流水。
func (s *Server) registerQueryTools() {
	s.tools = append(s.tools, &Tool{
		Name: "list_accounts",
		Description: "列出当前用户的账户来源（平台/银行/券商等），默认内联其下的现金子账户（id/名称/币种/类型/余额/是否默认/mcp 标记）。" +
			"可用 source_id 只查某个来源；include_cash=false 可只返回来源列表。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id":    map[string]interface{}{"type": "integer", "description": "只返回该 id 的账户来源；省略返回全部。"},
				"include_cash": map[string]interface{}{"type": "boolean", "description": "是否内联该来源下的现金子账户，默认 true。"},
				"username":     map[string]interface{}{"type": "string", "description": "归属用户名：省略则使用默认（首个）用户。"},
				"user_id":      map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一；省略则使用默认用户。"},
			},
		},
		Handler: listAccounts,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_cash_accounts",
		Description: "列出当前用户的现金子账户（扁平列表），含所属来源名称、id、币种、类型、余额、是否默认账户、mcp 标记（备注）。" +
			"可用 source_id / currency 过滤，并给出各币种余额合计。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id": map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的现金子账户；省略返回全部。"},
				"currency":  map[string]interface{}{"type": "string", "description": "只返回该币种（如 CNY/USD/HKD）的子账户；省略返回全部。"},
				"username":  map[string]interface{}{"type": "string", "description": "归属用户名：省略则使用默认（首个）用户。"},
				"user_id":   map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一；省略则使用默认用户。"},
			},
		},
		Handler: listCashAccounts,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_holdings",
		Description: "列出当前用户的持仓：id、名称、代码、类别、市场、币种、所属来源、份额、成本价、现价、市值、浮动盈亏及盈亏百分比、资产类型、买入日期、mcp 标记（备注）。" +
			"默认过滤已清仓（份额为 0）的持仓，可设 include_closed=true 一并返回；可用 source_id / symbol / category 过滤，并给出各币种市值与盈亏合计。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id":      map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的持仓；省略返回全部。"},
				"symbol":         map[string]interface{}{"type": "string", "description": "按代码过滤（不分大小写，如 AAPL / 600519）；省略返回全部。"},
				"category":       map[string]interface{}{"type": "string", "description": "按类别过滤：stock | fund；省略返回全部。"},
				"include_closed": map[string]interface{}{"type": "boolean", "description": "是否包含份额为 0 的已清仓持仓，默认 false。"},
				"username":       map[string]interface{}{"type": "string", "description": "归属用户名：省略则使用默认（首个）用户。"},
				"user_id":        map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一；省略则使用默认用户。"},
			},
		},
		Handler: listHoldings,
	})

	s.tools = append(s.tools, &Tool{
		Name: "list_wealth",
		Description: "列出当前用户的理财产品：id、名称、代码、币种、所属来源、最新持仓金额及快照日期、累计收益、mcp 标记（备注）。" +
			"可用 source_id 过滤，并给出各币种最新金额合计。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"source_id": map[string]interface{}{"type": "integer", "description": "只返回该账户来源下的理财产品；省略返回全部。"},
				"username":  map[string]interface{}{"type": "string", "description": "归属用户名：省略则使用默认（首个）用户。"},
				"user_id":   map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一；省略则使用默认用户。"},
			},
		},
		Handler: listWealth,
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
		ID        int64   `json:"id"`
		Name      string  `json:"name"`
		Currency  string  `json:"currency"`
		Type      string  `json:"type"`
		Amount    float64 `json:"amount"`
		IsDefault bool    `json:"is_default"`
		Marker    string  `json:"marker"`
	}
	type srcRow struct {
		ID         int64              `json:"id"`
		Name       string             `json:"name"`
		Type       string             `json:"type"`
		Region     string             `json:"region"`
		Currencies string             `json:"currencies"`
		Marker     string             `json:"marker"`
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
			Marker: strings.TrimSpace(src.Note),
		}
		if includeCash {
			rows := []cashRow{}
			tot := map[string]float64{}
			for _, c := range cashBySource[src.ID] {
				rows = append(rows, cashRow{
					ID: c.ID, Name: c.Name, Currency: c.Currency, Type: c.Type,
					Amount: round2(c.Amount), IsDefault: c.IsDefault,
					Marker: strings.TrimSpace(c.Note),
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
		ID        int64   `json:"id"`
		SourceID  int64   `json:"source_id"`
		Source    string  `json:"source"`
		Name      string  `json:"name"`
		Currency  string  `json:"currency"`
		Type      string  `json:"type"`
		Amount    float64 `json:"amount"`
		IsDefault bool    `json:"is_default"`
		Marker    string  `json:"marker"`
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
			Amount: round2(c.Amount), IsDefault: c.IsDefault,
			Marker: strings.TrimSpace(c.Note),
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
		AssetType    string  `json:"asset_type"`
		BuyDate      string  `json:"buy_date"`
		Marker       string  `json:"marker"`
	}
	out := []row{}
	marketByCur := map[string]float64{}
	pnlByCur := map[string]float64{}
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
		out = append(out, row{
			ID: h.ID, Name: h.Name, Symbol: h.Symbol, Category: h.Category,
			Market: h.Market, Currency: h.Currency, SourceID: h.SourceID,
			Source: names[h.SourceID], Quantity: h.Quantity,
			CostPrice: h.CostPrice, CurrentPrice: h.CurrentPrice,
			MarketValue: mv, Pnl: pnl, PnlPct: pct,
			AssetType: h.AssetType, BuyDate: h.BuyDate,
			Marker: strings.TrimSpace(h.Note),
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
		Marker       string  `json:"marker"`
	}
	out := []row{}
	total := map[string]float64{}
	for _, w := range ws {
		// ListWealthBySource 不过滤用户，这里兜底排除不属于当前用户的数据。
		if w.UserID != 0 && w.UserID != uid {
			continue
		}
		amt, date := 0.0, ""
		if d, v, ok, e := db.GetWealthLatest(w.ID); e == nil && ok {
			date, amt = d, round2(v)
		}
		out = append(out, row{
			ID: w.ID, Name: w.Name, Code: w.Code, Currency: w.Currency,
			SourceID: w.SourceID, Source: names[w.SourceID],
			LatestAmount: amt, LatestDate: date, CumPnl: round2(w.CumPnl),
			Marker: strings.TrimSpace(w.Note),
		})
		total[w.Currency] = round2(total[w.Currency] + amt)
	}
	return marshalResult(map[string]interface{}{
		"count": len(out), "amount_by_currency": total, "wealth": out,
	})
}
