package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"
	"portfolio/internal/mcp"

	"github.com/gin-gonic/gin"
)

// ---- 内置 AI 助手（右下角悬浮聊天面板）----
//
// 与「AI 总结」不同，这里是对话式的：模型可以在回答过程中调用工具（OpenAI function calling
// 兼容协议）。工具分两类：
//   1. MCP 已对接的账本能力（list_holdings / list_wealth / list_accounts /
//      list_cash_accounts / record_transaction）—— 与对外 MCP 服务同源，
//      由 internal/mcp 直接提供，避免两套实现漂移。
//   2. 持仓分析能力（analyze_holding 技术分析 / 买卖判断、portfolio_summary 持仓总结）。
//
// 若模型或网关不支持 tools，自动降级为「注入持仓上下文的纯对话」，保证功能可用。

const (
	// 工具调用最大轮次：联网场景常见「搜索 → 抓正文 → 作答」三步，
	// 4 轮在网络抖动需要重搜时会顶到上限，留 8 轮余量（仍是防死循环的硬闸）。
	// 配合每次工具结果后的收敛提示（aiChatConvergeHint），模型当轮即收敛出正文，
	// 极端场景才会撑到上限。
	aiChatMaxRounds = 8
	aiChatTimeout   = 180 * time.Second

	// 工具执行完后追加的收敛提示：引导模型基于已拿到的工具结果直接回答用户，
	// 不要继续调工具。这比单纯放宽轮次更省 token（当轮收敛 vs 再兜 2-3 轮）。
	aiChatConvergeHint = "以上为工具返回结果，信息已足够请直接回答用户问题，不要再调用任何工具。"
)

const aiChatSystemPrompt = `你是「持仓侠」内置的 AI 投资助手，服务于用户自己的持仓账本。

能力边界（只能做这些，做不到就直说，不要编造）：
1. 查询账本：持仓、理财、账户来源、现金子账户（用 list_* 工具）。
2. 记录流水：持仓加仓/减仓/分红、现金存入/取出、理财申购/赎回（用 record_transaction 工具）。
3. 持仓技术分析（analyze_holding）：MA/MACD/RSI/KDJ/BOLL + 看涨概率，可据此给买卖判断。
4. 持仓总结（portfolio_summary）：总市值、总盈亏、结构分布、今日表现。
5. 资产再平衡（get_rebalance）：股票/基金/理财/现金四大类的目标占比、实际占比、偏离、应买应卖金额、组合预期年化与超额收益。回答「该不该调仓、该买多少、现金是不是太多」前必须先调它，不要自己拿持仓金额估算。
6. 联网检索（web_search / web_fetch）：回答涉及「最近 / 今天 / 最新 / 新闻 / 公告 / 财报 / 政策 / 为什么涨跌」或任何账本以外的公开事实时，先搜索再回答；用户给出链接想让你看内容时用 web_fetch。搜索结果里的日期即发布日，务必据此判断时效。

铁律：
- 涉及数字的一律以工具返回的真实数据为准，禁止凭印象编造价格、份额、盈亏。
- 引用外部信息必须给 Markdown 链接 [标题](URL) 和日期；搜不到、抓不到就直说「没查到 / 打不开」，绝不虚构新闻、公告、财报数字。
- 外部信息与账本数据冲突时以账本为准（账本是真实成交，外部是公开信息），差异可以点出来。
- 执行写操作（record_transaction）前，若目标不唯一或关键参数缺失，先向用户确认。
- 给买卖判断时必须说明依据的指标，并提示「仅供参考，不构成投资建议」。
- 用中文回答，条理清晰，能分点就分点，不要长篇铺垫。`

// ---- 会话 CRUD ----

func aiChatsList(c *gin.Context) {
	uid := currentUserID(c)
	list, err := db.ListAIChats(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chats": list})
}

func aiChatCreate(c *gin.Context) {
	uid := currentUserID(c)
	var b struct {
		Title string `json:"title"`
	}
	_ = c.ShouldBindJSON(&b)
	title := strings.TrimSpace(b.Title)
	if title == "" {
		title = "新对话"
	}
	id, err := db.CreateAIChat(uid, title)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "title": title})
}

func aiChatGet(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if _, err := db.GetAIChat(id, uid); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}
	msgs, err := db.ListAIChatMessages(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "messages": msgs})
}

func aiChatRename(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var b struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if strings.TrimSpace(b.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "标题不能为空"})
		return
	}
	if err := db.RenameAIChat(id, uid, strings.TrimSpace(b.Title)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func aiChatDelete(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := db.DeleteAIChat(id, uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 对话 ----

type aiChatReq struct {
	ChatID          int64  `json:"chat_id"`
	APIKey          string `json:"api_key"`
	Model           string `json:"model"`
	BaseURL         string `json:"base_url"`
	Message         string `json:"message"`
	ReasoningEffort string `json:"reasoning_effort"` // 本轮覆盖值（空=用全局设置/自动推断）
}

type aiChatResp struct {
	ChatID    int64    `json:"chat_id"` // 会话 id（前端首次发送时用它回写当前会话）
	Content   string   `json:"content"`
	Reasoning string   `json:"reasoning,omitempty"` // 模型思考过程（reasoning_content）
	Tools     []string `json:"tools,omitempty"`     // 本轮实际调用过的工具
	Title     string   `json:"title,omitempty"`     // 首次回答后生成的会话标题
	Degraded  bool     `json:"degraded,omitempty"`  // true=模型不支持工具调用，已降级为上下文注入
}

func aiChatPost(c *gin.Context) {
	uid := currentUserID(c)
	var b aiChatReq
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	msg := strings.TrimSpace(b.Message)
	if msg == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "消息为空"})
		return
	}
	if strings.TrimSpace(b.APIKey) == "" || isMaskedSecret(b.APIKey) {
		// 与 /ai/settings、/ai/summary 同口径：前端拿到的是掩码（****末四位），
		// 原样回传时按「未修改」处理，换回库中原文。少这一步，换浏览器或刷新页面后
		// 内存里没有明文 Key，聊天会把掩码当密钥发给模型，直接 401。
		if cfg, err := loadAIConfig(uid); err == nil {
			b.APIKey = resolveSavedKey(cfg, b.Model, b.APIKey)
		}
	}
	if strings.TrimSpace(b.APIKey) == "" || isMaskedSecret(b.APIKey) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 API Key，请到「设置 → AI」填写"})
		return
	}
	model := strings.TrimSpace(b.Model)
	if model == "" {
		model = "deepseek-chat"
	}
	base := strings.TrimSpace(b.BaseURL)
	if base == "" {
		base = "https://api.deepseek.com"
	}
	if !aiGuardBaseURL(c, uid, base) {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅主设备可以使用自定义 AI 地址", "owner_required": true})
		return
	}

	chatID := b.ChatID
	isNew := false
	if chatID <= 0 {
		id, err := db.CreateAIChat(uid, titleFromMessage(msg))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		chatID, isNew = id, true
	} else if _, err := db.GetAIChat(chatID, uid); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	// 组装历史消息
	msgs := []map[string]interface{}{{"role": "system", "content": aiChatSystemPrompt}}
	if hist, err := db.ListAIChatMessages(chatID); err == nil {
		for _, m := range hist {
			if m.Role != "user" && m.Role != "assistant" && m.Role != "tool" {
				continue
			}
			item := map[string]interface{}{"role": m.Role, "content": m.Content}
			if m.Role == "tool" && m.ToolName != "" {
				item["name"] = m.ToolName
			}
			msgs = append(msgs, item)
		}
	}
	msgs = append(msgs, map[string]interface{}{"role": "user", "content": msg})
	if err := db.AppendAIChatMessage(chatID, "user", msg, "", ""); err != nil {
		log.Printf("[aichat] append user msg failed: %v", err)
	}

	tools := aiChatTools(aiWebEnabled(base))
	used := []string{}
	// reasoning_effort 三层优先级：
	// 1. 前端本轮显式传值（对话框每轮可切） → 直接用
	// 2. 否则 resolveReasoningEffort（全局设置 > baseURL 自动推断）
	reasoningEffort := strings.TrimSpace(b.ReasoningEffort)
	if reasoningEffort == "" {
		reasoningEffort = resolveReasoningEffort(uid, base)
	}
	content, reasoning, degraded, err := runChatLoop(base, b.APIKey, model, msgs, tools, uid, &used, reasoningEffort)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(content) == "" {
		content = "（模型返回为空）"
	}
	if err := db.AppendAIChatMessage(chatID, "assistant", content, reasoning, ""); err != nil {
		log.Printf("[aichat] append assistant msg failed: %v", err)
	}

	out := aiChatResp{ChatID: chatID, Content: content, Reasoning: reasoning, Tools: used, Degraded: degraded}
	if isNew {
		out.Title = titleFromMessage(msg)
	}
	c.JSON(http.StatusOK, out)
}

// runChatLoop 执行「模型 ⇄ 工具」循环，直到模型给出正文或达到轮次上限。
// 若服务端不支持 tools（400 且响应提及 tools/function），自动去掉 tools 并注入持仓上下文重试。
// reasoningEffort 透传给 DeepSeek 原生参数（none/low/high/max），空字符串=不传=模型默认。
// 返回 (content, reasoning, degraded, err)：reasoning 是模型的思考过程（reasoning_content）。
func runChatLoop(baseURL, apiKey, model string, msgs []map[string]interface{}, tools []map[string]interface{}, uid int64, used *[]string, reasoningEffort string) (string, string, bool, error) {
	degraded := false
	// 原始提问喂给搜索接口的 ori_question，帮助搜索引擎理解意图（只取最后一条用户消息）
	question := lastUserContent(msgs)
	for round := 0; round < aiChatMaxRounds; round++ {
		raw, status, err := postChat(baseURL, apiKey, model, msgs, tools, reasoningEffort)
		if err != nil {
			return "", "", degraded, err
		}
		if status != http.StatusOK && len(tools) > 0 && looksLikeToolUnsupported(raw) {
			// 降级：不支持 function calling → 注入持仓上下文后再问一次
			log.Printf("[aichat] model rejects tools (%d: %s), fallback to plain chat", status, truncate(string(raw), 200))
			degraded = true
			tools = nil
			msgs = injectPortfolioContext(msgs, uid)
			raw, status, err = postChat(baseURL, apiKey, model, msgs, nil, reasoningEffort)
			if err != nil {
				return "", "", degraded, err
			}
		}
		if status != http.StatusOK {
			return "", "", degraded, fmt.Errorf("模型返回 %d: %s", status, truncate(string(raw), 400))
		}
		choice, err := parseChatChoice(raw)
		if err != nil {
			return "", "", degraded, err
		}
		if len(choice.ToolCalls) == 0 {
			c := strings.TrimSpace(choice.Content)
			r := strings.TrimSpace(choice.Reasoning)
			if c == "" {
				c = r
			}
			return c, r, degraded, nil
		}
		// 有工具调用：把 assistant 的 tool_calls 原样入列，再逐条追加工具结果
		assistantMsg := map[string]interface{}{"role": "assistant", "content": choice.Content, "tool_calls": choice.ToolCalls}
		if choice.Content == "" {
			delete(assistantMsg, "content")
		}
		msgs = append(msgs, assistantMsg)
		for _, tc := range choice.ToolCalls {
			result := execChatTool(tc.Function.Name, tc.Function.Arguments, uid, baseURL, apiKey, question)
			*used = append(*used, tc.Function.Name)
			msgs = append(msgs, map[string]interface{}{
				"role":         "tool",
				"tool_call_id": tc.ID,
				"name":         tc.Function.Name,
				"content":      result,
			})
		}
		// 收敛提示：工具已执行完毕，引导模型直接基于结果回答，避免继续调用工具
		// 导致死循环（模型看到这条 system 消息后大概率当轮就输出正文）。
		msgs = append(msgs, map[string]interface{}{
			"role":    "system",
			"content": aiChatConvergeHint,
		})
	}
	return "工具调用轮次已达上限，请换个更明确的问法重试。", "", degraded, nil
}
func lastUserContent(msgs []map[string]interface{}) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if r, _ := msgs[i]["role"].(string); r == "user" {
			if c, ok := msgs[i]["content"].(string); ok {
				return strings.TrimSpace(c)
			}
			return ""
		}
	}
	return ""
}

// ---- 工具定义与执行 ----

// aiChatTools 组装 chat/completions 的 tools 数组。
// web=true 时追加联网检索工具（仅官方 DeepSeek 端点，见 aiWebEnabled）。
func aiChatTools(web bool) []map[string]interface{} {
	defs := mcp.ChatToolDefs()
	defs = append(defs,
		map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name": "analyze_holding",
				"description": "对某只持仓做技术分析（MA5/10/20/60、MACD、RSI、KDJ、BOLL）并给出看涨概率与买卖信号，" +
					"用于回答「XX 现在能买吗 / 该不该卖 / 技术面怎么样」。name 支持持仓名称或证券代码模糊匹配；" +
					"不确定标的是哪只时先调用 list_holdings。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"name": map[string]interface{}{"type": "string", "description": "持仓名称或证券代码（模糊匹配）。"},
					},
					"required": []string{"name"},
				},
			},
		},
		map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        "portfolio_summary",
				"description": "获取当前用户的整体持仓统计（总市值、总盈亏、结构分布、各标的明细），用于回答「我的持仓怎么样 / 帮我做个总结」。",
				"parameters": map[string]interface{}{
					"type":       "object",
					"properties": map[string]interface{}{},
				},
			},
		},
	)
	if web {
		defs = append(defs, aiWebToolDefs()...)
	}
	return defs
}

func execChatTool(name, argsJSON string, uid int64, baseURL, apiKey, question string) string {
	args := map[string]interface{}{}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			// 少数模型会吐出非 JSON，退化成空参数而不是直接失败
			log.Printf("[aichat] tool %s args parse failed: %v", name, err)
		}
	}
	// 归属用户：与前端 X-User-Id 一致，避免写到默认用户账本
	if _, ok := args["user_id"]; !ok {
		args["user_id"] = uid
	}
	switch name {
	case "web_search":
		if !aiWebEnabled(baseURL) {
			return "当前模型地址不支持联网检索，请直接说明无法联网。"
		}
		return chatToolWebSearch(baseURL, apiKey, question, args)
	case "web_fetch":
		if !aiWebEnabled(baseURL) {
			return "当前模型地址不支持联网检索，请直接说明无法联网。"
		}
		return chatToolWebFetch(baseURL, apiKey, args)
	case "analyze_holding":
		return chatToolAnalyzeHolding(uid, args)
	case "portfolio_summary":
		s, err := buildPortfolioStats(uid)
		if err != nil {
			return "读取持仓统计失败：" + err.Error()
		}
		return s
	}
	out, err := mcp.CallToolByName(name, args)
	if err != nil {
		return "工具执行失败：" + err.Error()
	}
	return out
}

// chatToolAnalyzeHolding 技术分析工具：先按名称/代码定位持仓，再复用分析链路产出文本结论。
func chatToolAnalyzeHolding(uid int64, args map[string]interface{}) string {
	key, _ := args["name"].(string)
	key = strings.TrimSpace(strings.ToLower(key))
	if key == "" {
		return "缺少 name 参数。"
	}
	hs, err := db.List(uid)
	if err != nil {
		return "读取持仓失败：" + err.Error()
	}
	var exact []db.Holding
	var fuzzy []db.Holding
	for _, h := range hs {
		ln := strings.ToLower(h.Name)
		ls := strings.ToLower(h.Symbol)
		if ln == key || ls == key {
			exact = append(exact, h)
		} else if strings.Contains(ln, key) || strings.Contains(ls, key) {
			fuzzy = append(fuzzy, h)
		}
	}
	pick := exact
	if len(pick) == 0 {
		pick = fuzzy
	}
	if len(pick) == 0 {
		return fmt.Sprintf("没有找到名称或代码包含「%s」的持仓。可先用 list_holdings 查看全部持仓。", key)
	}
	if len(pick) > 1 {
		names := make([]string, 0, len(pick))
		for _, h := range pick {
			names = append(names, fmt.Sprintf("%s(%s)", h.Name, h.Symbol))
		}
		return "匹配到多个持仓，请更精确一些：" + strings.Join(names, "、")
	}
	h := pick[0]

	symForFetch := h.Symbol
	if h.Category == "fund" {
		if h.LinkedSymbol == "" {
			return fmt.Sprintf("%s 是基金且未设置关联股票代码，不支持技术分析。", h.Name)
		}
		symForFetch = h.LinkedSymbol
	}
	symbol := resolveSymbol(symForFetch, h.Market)

	bars, ind, prob := analysisFromCacheOrFetch(symbol)
	if ind == nil {
		return fmt.Sprintf("%s（%s）：获取行情或指标失败，暂时无法做技术分析。", h.Name, symbol)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("【%s】代码 %s | 市场 %s | 类别 %s\n", h.Name, h.Symbol, h.Market, catLabel(h.Category)))
	sb.WriteString(fmt.Sprintf("现价 %.4f | 今日涨跌 %+.2f%%\n", ind.Price, ind.DailyChangePct))
	sb.WriteString(fmt.Sprintf("MA5 %.4f / MA10 %.4f / MA20 %.4f / MA60 %.4f\n", ind.MA5, ind.MA10, ind.MA20, ind.MA60))
	sb.WriteString(fmt.Sprintf("MACD: DIF %.4f DEA %.4f 柱 %.4f（上日柱 %.4f）\n", ind.MACD.DIF, ind.MACD.DEA, ind.MACD.HIST, ind.MACD.HistPrev))
	sb.WriteString(fmt.Sprintf("RSI %.2f | KDJ: K %.2f D %.2f J %.2f\n", ind.RSI, ind.KDJ.K, ind.KDJ.D, ind.KDJ.J))
	sb.WriteString(fmt.Sprintf("BOLL: 上轨 %.4f 中轨 %.4f 下轨 %.4f 带宽 %.2f%%\n", ind.BOLL.Upper, ind.BOLL.Mid, ind.BOLL.Lower, ind.BOLL.Width))
	if len(bars) > 0 {
		sb.WriteString(fmt.Sprintf("K线区间：%s ~ %s（%d 根）\n", bars[0].Date, bars[len(bars)-1].Date, len(bars)))
	}
	if prob != nil {
		sb.WriteString(fmt.Sprintf("看涨概率 %.1f%% / 看跌 %.1f%% | 信号置信度 %d/5 | 综合信号 %s\n",
			prob.UpPct, prob.DownPct, prob.Confidence, market.SignalFromUpPct(prob.UpPct)))
		if strings.TrimSpace(prob.Summary) != "" {
			sb.WriteString("指标小结：" + prob.Summary + "\n")
		}
	}
	// 持仓维度：成本、盈亏、市值，便于「买卖判断」结合持仓成本
	mv := h.Quantity * h.CurrentPrice
	cost := h.Quantity * h.CostPrice
	sb.WriteString(fmt.Sprintf("持仓：份额 %.4f | 成本价 %.4f | 现价 %.4f | 市值 %.2f | 浮动盈亏 %.2f\n",
		h.Quantity, h.CostPrice, h.CurrentPrice, mv, mv-cost))
	return sb.String()
}

// analysisFromCacheOrFetch 复用当日的分析缓存，未命中再实时抓取（与 /holdings/:id/analysis 同源策略）。
func analysisFromCacheOrFetch(symbol string) ([]market.KlineBar, *market.IndicatorsResult, *market.ProbabilityResult) {
	today := time.Now().Format("2006-01-02")
	if row, e := db.GetAnalysisCache(symbol, today); e == nil && row != nil {
		var bars []market.KlineBar
		var ind market.IndicatorsResult
		if json.Unmarshal([]byte(row.BarsJSON), &bars) == nil && len(bars) >= 30 {
			if json.Unmarshal([]byte(row.IndicatorsJSON), &ind) == nil {
				var prob market.ProbabilityResult
				_ = json.Unmarshal([]byte(row.ProbabilityJSON), &prob)
				return bars, &ind, &prob
			}
		}
	}
	bars, err := market.FetchKline(symbol)
	if err != nil || len(bars) < 30 {
		return nil, nil, nil
	}
	ind := market.CalculateIndicators(bars)
	prob := market.CalculateProbability(ind)
	// 顺手写回缓存，前端弹框可直接复用
	go func() {
		barsJSON, _ := json.Marshal(bars)
		indJSON, _ := json.Marshal(ind)
		probJSON, _ := json.Marshal(prob)
		if e := db.SaveAnalysisCache(symbol, today, string(barsJSON), string(indJSON), string(probJSON), "[]", "{}", time.Now().Format("2006-01-02 15:04:05")); e != nil {
			log.Printf("[aichat] save analysis cache %s failed: %v", symbol, e)
		}
	}()
	return bars, ind, prob
}

// resolveReasoningEffort 解析 reasoning_effort：显式配置优先，老数据自动推断。
// deepseek 官方端点 → 默认 "low"（查询类对话的推理链是最大 token 浪费点，
// low 比 high 省 50%+ 的 reasoning token 且不影响简单查询回答质量）。
// 其他兼容端点 → 空串（不传 reasoning_effort 键，避免对方网关不认识参数报错）。
func resolveReasoningEffort(uid int64, baseURL string) string {
	// 1. 用户显式配置了 → 直接用
	if cfg, err := loadAIConfig(uid); err == nil && strings.TrimSpace(cfg.ReasoningEffort) != "" {
		return strings.TrimSpace(cfg.ReasoningEffort)
	}
	// 2. 老数据未配置 → 按端点自动判断
	b := strings.ToLower(strings.TrimSpace(baseURL))
	b = strings.TrimPrefix(b, "https://")
	b = strings.TrimPrefix(b, "http://")
	if i := strings.IndexByte(b, '/'); i >= 0 {
		b = b[:i]
	}
	// api.deepseek.com / api.deepseek-r1.com / 等 deepseek 官方端点
	if strings.Contains(b, "deepseek.com") {
		return "low"
	}
	return ""
}

func postChat(baseURL, apiKey, model string, msgs []map[string]interface{}, tools []map[string]interface{}, reasoningEffort string) ([]byte, int, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = "https://api.deepseek.com"
	}
	payload := map[string]interface{}{
		"model":       model,
		"messages":    msgs,
		"temperature": 0.6,
		"stream":      false,
	}
	if len(tools) > 0 {
		payload["tools"] = tools
	}
	// reasoning_effort：DeepSeek 原生思考强度控制。
	// deepseek-v4-pro 默认 high（重度推理链），对查询类对话是巨大浪费。
	// 只有当配置值非空时才下发，其他兼容端点不受影响。
	if strings.TrimSpace(reasoningEffort) != "" {
		payload["reasoning_effort"] = reasoningEffort
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequest(http.MethodPost, base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	client := &http.Client{Timeout: aiChatTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("调用模型失败: %w", err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return rb, resp.StatusCode, nil
}

type chatChoice struct {
	Content   string
	Reasoning string
	ToolCalls []chatToolCall
}

type chatToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func parseChatChoice(raw []byte) (chatChoice, error) {
	var out struct {
		Choices []struct {
			Message struct {
				Content          string         `json:"content"`
				ReasoningContent string         `json:"reasoning_content"`
				ToolCalls        []chatToolCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		// 兼容 SSE / 轻微畸形响应
		if c, ok := parseSSEContent(string(raw)); ok && strings.TrimSpace(c) != "" {
			return chatChoice{Content: strings.TrimSpace(c)}, nil
		}
		if c, ok := extractContentFallback(string(raw)); ok && strings.TrimSpace(c) != "" {
			return chatChoice{Content: strings.TrimSpace(c)}, nil
		}
		return chatChoice{}, fmt.Errorf("解析响应失败: %s", truncate(string(raw), 300))
	}
	if len(out.Choices) == 0 {
		if out.Error != nil {
			return chatChoice{}, fmt.Errorf("模型错误: %s", out.Error.Message)
		}
		return chatChoice{}, fmt.Errorf("模型未返回内容")
	}
	return chatChoice{
		Content:   out.Choices[0].Message.Content,
		Reasoning: out.Choices[0].Message.ReasoningContent,
		ToolCalls: out.Choices[0].Message.ToolCalls,
	}, nil
}

// looksLikeToolUnsupported 判断 4xx 响应是否因不支持 tools/function calling。
func looksLikeToolUnsupported(raw []byte) bool {
	s := strings.ToLower(string(raw))
	for _, kw := range []string{"tool", "function calling", "function_call", "unsupported"} {
		if strings.Contains(s, kw) {
			return true
		}
	}
	return false
}

// injectPortfolioContext 在降级路径下把持仓统计塞进最后一条用户消息，保证模型仍有数据可答。
func injectPortfolioContext(msgs []map[string]interface{}, uid int64) []map[string]interface{} {
	stats, err := buildPortfolioStats(uid)
	if err != nil || strings.TrimSpace(stats) == "" {
		return msgs
	}
	out := append([]map[string]interface{}{}, msgs...)
	for i := len(out) - 1; i >= 0; i-- {
		if r, _ := out[i]["role"].(string); r == "user" {
			c, _ := out[i]["content"].(string)
			out[i] = map[string]interface{}{"role": "user", "content": c + "\n\n【我的持仓数据】\n" + stats}
			break
		}
	}
	return out
}

// titleFromMessage 用首条消息生成会话标题（截断 + 去换行）。
// 必须按字符（rune）截断：中文占 3 字节，若用 truncate 那种 s[:24] 的字节切片，
// 24 字节边界常落在汉字中间，切出半个 UTF-8 序列，入库后前端显示成菱形问号（U+FFFD）。
func titleFromMessage(msg string) string {
	s := strings.TrimSpace(strings.ReplaceAll(msg, "\n", " "))
	if s == "" {
		return "新对话"
	}
	rs := []rune(s)
	if len(rs) <= 24 {
		return s
	}
	return string(rs[:24]) + "..."
}
