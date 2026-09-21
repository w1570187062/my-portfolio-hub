package mcp

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
)

// sourceMCP 是写入 cash_flow.source 的来源标记：表示该流水由 MCP 服务产生，
// 前端资产全景「流水」表格据此打「MCP」标签突出显示。
const sourceMCP = "mcp"

// registerDefaultTools 注册当前版本暴露给 MCP 客户端的工具：
// 核心写能力（record_transaction）+ 只读查询能力（见 registerQueryTools）。
func (s *Server) registerDefaultTools() {
	s.tools = append(s.tools, &Tool{
		Name:        "record_transaction",
		Description: "根据实体的 mcp 标记（备注字段）记录一笔流水。可作用于：持仓(holding)的加仓/减仓/分红、现金子账户(cash)的存入/取出、理财(wealth)的申购(转入)/赎回(转出)。marker 用于在三类资产中定位目标，entity_type 可省略以自动匹配。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"marker": map[string]interface{}{
					"type":        "string",
					"description": "mcp 标记：目标实体的「备注」字段值，用于在持仓/子账户/理财中定位。",
				},
				"entity_type": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"holding", "cash", "wealth"},
					"description": "目标类型；省略则在三类资产中按 marker 自动匹配第一个命中。",
				},
				"action": map[string]interface{}{
					"type":        "string",
					"description": "操作类型。holding: buy(加仓)/sell(减仓)/dividend(分红)；cash: deposit(存入)/withdraw(取出)；wealth: subscribe(申购/转入)/redeem(赎回/转出)。",
				},
				"quantity": map[string]interface{}{"type": "number", "description": "持仓加仓/减仓数量（股/份）。"},
				"price":    map[string]interface{}{"type": "number", "description": "持仓加仓/减仓价格（每股/每份）。"},
				"fee":      map[string]interface{}{"type": "number", "description": "手续费/佣金，默认 0。"},
				"per_share": map[string]interface{}{"type": "number", "description": "持仓分红每股金额（action=dividend 时使用）。"},
				"amount":   map[string]interface{}{"type": "number", "description": "现金存取金额，或理财申赎的净流入/流出额（正=转入/存入，负=转出/取出）。"},
				"note":     map[string]interface{}{"type": "string", "description": "附加说明，会写入账本备注。"},
				"username": map[string]interface{}{"type": "string", "description": "归属用户名：指定后流水记录到该用户账本，必须与系统用户名精确匹配；省略则使用默认（首个）用户。"},
				"user_id":  map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一，必须与系统中的用户 id 匹配；省略则使用默认用户。"},
			},
			"required": []string{"marker", "action"},
		},
		Handler: recordTransaction,
	})

	s.tools = append(s.tools, &Tool{
		Name:        "list_markers",
		Description: "列出当前用户所有设置了 mcp 标记（备注非空）的实体，返回其类型、id、名称与标记值，便于 AI 选择 record_transaction 的 marker 参数。",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"username": map[string]interface{}{"type": "string", "description": "归属用户名：省略则使用默认（首个）用户。"},
				"user_id":  map[string]interface{}{"type": "integer", "description": "归属用户 id：与 username 二选一；省略则使用默认用户。"},
			},
		},
		Handler: listMarkers,
	})

	// 只读查询工具：账户/子账户、持仓、理财
	s.registerQueryTools()
}

// resolveUserID 解析 MCP 操作归属的用户：
//  1. 优先使用调用方通过 MCP 参数传入的用户标识（username 或 user_id），必须与系统用户名/id 匹配；
//  2. 否则回退到配置 user_id（0 表示默认首个用户）。
//
// 这样既可在前端「MCP 参数」页不设置归属用户，又能在客户端按调用传入具体用户。
func resolveUserID(args map[string]interface{}) (int64, error) {
	if args == nil {
		args = map[string]interface{}{}
	}
	if name, ok := args["username"].(string); ok && strings.TrimSpace(name) != "" {
		u, err := db.GetUserByName(strings.TrimSpace(name))
		if err != nil {
			return 0, fmt.Errorf("未找到用户名为「%s」的用户", name)
		}
		return u.ID, nil
	}
	if vid, ok := args["user_id"]; ok && vid != nil {
		if id := toInt64(vid); id > 0 {
			u, err := db.GetUser(id)
			if err != nil {
				return 0, fmt.Errorf("未找到 id=%d 的用户", id)
			}
			return u.ID, nil
		}
	}
	if cfgUserID > 0 {
		return cfgUserID, nil
	}
	users, err := db.ListUsers()
	if err != nil {
		return 0, fmt.Errorf("列举用户失败: %w", err)
	}
	if len(users) == 0 {
		return 0, fmt.Errorf("系统内没有任何用户，请先在前端创建用户")
	}
	return users[0].ID, nil
}

// toInt64 将 JSON 中可能出现的整型（含 string）统一转换为 int64。
func toInt64(v interface{}) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case float32:
		return int64(n)
	case int:
		return int64(n)
	case int64:
		return n
	case json.Number:
		if i, e := n.Int64(); e == nil {
			return i
		}
	case string:
		if i, e := strconv.ParseInt(strings.TrimSpace(n), 10, 64); e == nil {
			return i
		}
	}
	return 0
}

// entityHit 描述一个被 marker 命中的实体。
type entityHit struct {
	Type   string
	ID     int64
	Name   string
	Extra  string
	Object interface{} // 原始 db 对象（holding/cash/wealth）
}

// findEntityByMarker 在指定（或所有）类型中按 note == marker 查找实体。
func findEntityByMarker(uid int64, marker, entityType string) (*entityHit, error) {
	norm := strings.TrimSpace(marker)
	if norm == "" {
		return nil, fmt.Errorf("marker 不能为空")
	}
	types := []string{"holding", "cash", "wealth"}
	if entityType != "" {
		types = []string{strings.ToLower(entityType)}
	}
	for _, t := range types {
		switch t {
		case "holding":
			hs, err := db.List(uid)
			if err != nil {
				return nil, err
			}
			for _, h := range hs {
				if strings.TrimSpace(h.Note) == norm {
					return &entityHit{Type: "holding", ID: h.ID, Name: h.Name, Extra: fmt.Sprintf("%s/%s", h.Symbol, h.Currency), Object: h}, nil
				}
			}
		case "cash":
			cs, err := db.ListCash(uid)
			if err != nil {
				return nil, err
			}
			for _, c := range cs {
				if strings.TrimSpace(c.Note) == norm {
					return &entityHit{Type: "cash", ID: c.ID, Name: c.Name, Extra: c.Currency, Object: c}, nil
				}
			}
		case "wealth":
			ws, err := db.ListWealth(uid)
			if err != nil {
				return nil, err
			}
			for _, w := range ws {
				if strings.TrimSpace(w.Note) == norm {
					return &entityHit{Type: "wealth", ID: w.ID, Name: w.Name, Extra: w.Currency, Object: w}, nil
				}
			}
		default:
			return nil, fmt.Errorf("未知 entity_type: %s（应为 holding/cash/wealth）", entityType)
		}
	}
	return nil, fmt.Errorf("未找到备注(标记)为「%s」的%s实体", norm, entityTypeText(entityType))
}

func entityTypeText(t string) string {
	if t == "" {
		return "任何类型"
	}
	return t + " 类型"
}

// resolveCashAccount 复刻 api.resolveCashAccount：优先默认子账户，必要时补齐，最后兜底取来源下任一账户。
func resolveCashAccount(uid, sourceID int64, currency string) (*db.Cash, error) {
	if c, err := db.GetDefaultCash(uid, sourceID, currency); err == nil && c != nil {
		return c, nil
	}
	if id, err := db.EnsureCurrencyDefaults(uid, sourceID, "", currency); err == nil && id > 0 {
		if c, e := db.GetCash(id); e == nil && c != nil {
			return c, nil
		}
	}
	if cs, err := db.ListCashBySource(uid, sourceID); err == nil && len(cs) > 0 {
		return &cs[0], nil
	}
	return nil, fmt.Errorf("找不到可用的现金子账户（来源=%d 币种=%s）", sourceID, currency)
}

// recordTransaction 是核心工具：按 marker 定位实体并记录一笔流水。
func recordTransaction(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	marker, _ := args["marker"].(string)
	entityType, _ := args["entity_type"].(string)
	action, _ := args["action"].(string)
	action = strings.ToLower(strings.TrimSpace(action))
	if marker == "" || action == "" {
		return "", fmt.Errorf("marker 与 action 均为必填")
	}
	hit, err := findEntityByMarker(uid, marker, entityType)
	if err != nil {
		return "", err
	}
	note := strings.TrimSpace(stringFrom(args, "note"))
	mcpNote := "MCP·" + action
	if note != "" {
		mcpNote += "·" + note
	}

	switch hit.Type {
	case "holding":
		return recordHoldingTX(uid, hit, action, args, mcpNote)
	case "cash":
		return recordCashTX(uid, hit, action, args, mcpNote)
	case "wealth":
		return recordWealthTX(uid, hit, action, args, mcpNote)
	}
	return "", fmt.Errorf("不支持的实体类型")
}

func recordHoldingTX(uid int64, hit *entityHit, action string, args map[string]interface{}, mcpNote string) (string, error) {
	h, ok := hit.Object.(db.Holding)
	if !ok {
		return "", fmt.Errorf("内部错误：持仓对象类型异常")
	}
	switch action {
	case "buy", "sell":
		qty := numFrom(args, "quantity")
		price := numFrom(args, "price")
		fee := numFrom(args, "fee")
		if qty <= 0 || price < 0 {
			return "", fmt.Errorf("加仓/减仓需要 quantity>0 且 price>=0")
		}
		typ := strings.ToUpper(action)
		upd, realized, err := db.AdjustHolding(h.ID, typ, qty, price, fee, mcpNote)
		if err != nil {
			return "", err
		}
		// 现金联动：加仓扣款 / 减仓回款，落到该持仓来源同币种的默认子账户。
		cash, cerr := resolveCashAccount(uid, h.SourceID, h.Currency)
		if cerr != nil {
			log.Printf("[mcp] 持仓%s现金联动失败(uid=%d hid=%d): %v", action, uid, h.ID, cerr)
		} else {
			var delta float64
			if action == "buy" {
				delta = -(qty*price + fee)
			} else {
				delta = qty*price - fee
			}
			if e := db.AddCashAmountFrom(sourceMCP, cash.ID, round2(delta), "mcp_"+action, "holding", h.ID, h.Name, mcpNote); e != nil {
				log.Printf("[mcp] 现金账户记账失败: %v", e)
			}
		}
		if action == "sell" && (realized > 1e-9 || realized < -1e-9) {
			today := time.Now().Format("2006-01-02")
			if e := db.RecordRealizedPnl(uid, today, h.ID, h.Symbol, h.Name, h.Currency, realized); e != nil {
				log.Printf("[mcp] 记录已实现盈亏失败: %v", e)
			}
		}
		return fmt.Sprintf("已记录持仓%s流水：%s(%s) 数量 %.4g @ %.4g，费用 %.2f，已实现盈亏 %.2f。",
			actionName(action), h.Name, h.Symbol, qty, price, fee, realized) +
			fmt.Sprintf("\n当前持仓：份额 %.4g，成本价 %.4g，现价 %.4g。", upd.Quantity, upd.CostPrice, upd.CurrentPrice), nil
	case "dividend":
		per := numFrom(args, "per_share")
		if per < 0 {
			return "", fmt.Errorf("分红每股金额不能为负")
		}
		upd, total, err := db.AdjustDividend(h.ID, per, mcpNote)
		if err != nil {
			return "", err
		}
		if cash, cerr := resolveCashAccount(uid, h.SourceID, h.Currency); cerr == nil {
			if e := db.AddCashAmountFrom(sourceMCP, cash.ID, round2(total), "mcp_dividend", "holding", h.ID, h.Name, mcpNote); e != nil {
				log.Printf("[mcp] 分红入账记账失败: %v", e)
			}
		}
		return fmt.Sprintf("已记录持仓分红流水：%s(%s) 每股 %.4g，分红总额 %.2f，新成本价 %.4g。",
			h.Name, h.Symbol, per, total, upd.CostPrice), nil
	default:
		return "", fmt.Errorf("持仓不支持的操作：%s（应为 buy/sell/dividend）", action)
	}
}

func recordCashTX(uid int64, hit *entityHit, action string, args map[string]interface{}, mcpNote string) (string, error) {
	c, ok := hit.Object.(db.Cash)
	if !ok {
		return "", fmt.Errorf("内部错误：现金对象类型异常")
	}
	amount := numFrom(args, "amount")
	if amount == 0 {
		return "", fmt.Errorf("现金存取需要 amount（非零）")
	}
	var delta float64
	switch action {
	case "deposit":
		delta = amount
	case "withdraw":
		delta = -amount
	default:
		return "", fmt.Errorf("现金不支持的操作：%s（应为 deposit/withdraw）", action)
	}
	if e := db.AddCashAmountFrom(sourceMCP, c.ID, round2(delta), "mcp_"+action, "mcp", 0, "MCP", mcpNote); e != nil {
		return "", e
	}
	return fmt.Sprintf("已记录现金%s流水：%s(%s) 变动 %.2f，新余额 %.2f。",
		actionName(action), c.Name, c.Currency, round2(delta), round2(c.Amount+delta)), nil
}

func recordWealthTX(uid int64, hit *entityHit, action string, args map[string]interface{}, mcpNote string) (string, error) {
	w, ok := hit.Object.(db.WealthProduct)
	if !ok {
		return "", fmt.Errorf("内部错误：理财对象类型异常")
	}
	amount := numFrom(args, "amount")
	if amount == 0 {
		return "", fmt.Errorf("理财申赎需要 amount（非零净流入/流出）")
	}
	var cashflow float64
	switch action {
	case "subscribe":
		cashflow = amount
	case "redeem":
		cashflow = -amount
	default:
		return "", fmt.Errorf("理财不支持的操作：%s（应为 subscribe/redeem）", action)
	}
	today := time.Now().Format("2006-01-02")
	_, lastAmount, ok, err := db.GetWealthLatest(w.ID)
	if err != nil {
		return "", err
	}
	if !ok {
		lastAmount = 0
	}
	newAmount := round2(lastAmount + cashflow)
	if e := db.UpsertWealthSnapshot(w.ID, today, newAmount, round2(cashflow)); e != nil {
		return "", e
	}
	return fmt.Sprintf("已记录理财%s流水：%s(%s) 当日净%s %.2f，持仓金额更新为 %.2f。",
		actionName(action), w.Name, w.Currency, actionName(action), round2(cashflow), newAmount), nil
}

func listMarkers(args map[string]interface{}) (string, error) {
	uid, err := resolveUserID(args)
	if err != nil {
		return "", err
	}
	type row struct {
		Type   string `json:"type"`
		ID     int64  `json:"id"`
		Name   string `json:"name"`
		Marker string `json:"marker"`
		Extra  string `json:"extra"`
	}
	out := []row{}
	hs, _ := db.List(uid)
	for _, h := range hs {
		if strings.TrimSpace(h.Note) != "" {
			out = append(out, row{"holding", h.ID, h.Name, h.Note, fmt.Sprintf("%s/%s", h.Symbol, h.Currency)})
		}
	}
	cs, _ := db.ListCash(uid)
	for _, c := range cs {
		if strings.TrimSpace(c.Note) != "" {
			out = append(out, row{"cash", c.ID, c.Name, c.Note, c.Currency})
		}
	}
	ws, _ := db.ListWealth(uid)
	for _, w := range ws {
		if strings.TrimSpace(w.Note) != "" {
			out = append(out, row{"wealth", w.ID, w.Name, w.Note, w.Currency})
		}
	}
	b, err := json.MarshalIndent(map[string]interface{}{"count": len(out), "markers": out}, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ---- 参数 / 数值助手 ----

func stringFrom(args map[string]interface{}, key string) string {
	if v, ok := args[key]; ok {
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func numFrom(args map[string]interface{}, key string) float64 {
	v, ok := args[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		if f, e := n.Float64(); e == nil {
			return f
		}
	case string:
		if f, e := strconv.ParseFloat(strings.TrimSpace(n), 64); e == nil {
			return f
		}
	}
	return 0
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5*sign(v))) / 100
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func actionName(a string) string {
	switch a {
	case "buy":
		return "加仓"
	case "sell":
		return "减仓"
	case "dividend":
		return "分红"
	case "deposit":
		return "存入"
	case "withdraw":
		return "取出"
	case "subscribe":
		return "申购"
	case "redeem":
		return "赎回"
	}
	return a
}
