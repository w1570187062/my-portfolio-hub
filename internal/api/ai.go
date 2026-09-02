package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// ---- AI summary feature (DeepSeek / OpenAI-compatible chat completions) ----
//
// The prompt template contains the placeholder {{DATA}}. At request time we replace
// it with the live portfolio statistics. Two default templates ship with the app:
// a witty one and a professional one. Users can add / edit / delete their own.

type aiTemplate struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type aiModelConfig struct {
	Name    string `json:"name"`
	Model   string `json:"model"`
	APIKey  string `json:"api_key"`
	BaseURL string `json:"base_url"`
}

type aiConfig struct {
	APIKey    string          `json:"api_key"`
	Model     string          `json:"model"`
	BaseURL   string          `json:"base_url"`
	Templates []aiTemplate    `json:"templates"`
	Models    []aiModelConfig `json:"models"` // 多模型配置（名称/模型/API Key/地址）
	// AutoDaily: 每日收盘后（21:30 定时任务，复用 21:00 基金快照）自动生成 AI 总结并存入历史。
	AutoDaily bool `json:"auto_daily"`
	// AutoSend: 自动生成的总结是否随净值推送一起发送到已配置的通知渠道。
	AutoSend bool `json:"auto_send"`
}

var defaultTemplates = []aiTemplate{
	{
		Name: "诙谐幽默",
		Content: `你是一位喜欢拿用户持仓开涮、但数据从不乱编的财经段子手。请基于下面「我的持仓数据」，用诙谐、幽默、带点调侃（可以适度玩梗、使用表情符号）的口吻，给我写一份专属的「持仓体检报告」。
要求：
1. 先来一句风趣的总体定调（赚麻了还是绿油油）；
2. 挑几个有代表性的持仓点评一下，夸就夸到位，亏就损到位，但数字必须准确；
3. 用轻松的方式点出风险或槽点；
4. 结尾给一句毒舌又实在的寄语。
不要说教，多用口语，篇幅适中（300~500字）。

我的持仓数据如下：
{{DATA}}`,
	},
	{
		Name: "专业视角",
		Content: `你是一名严谨、客观、专业的投资顾问。请基于下面的「我的持仓数据」，用专业、结构化、条理清晰的视角，做一份持仓分析报告。
要求：
1. 组合概览：总资产、总盈亏及收益率、RMB/USD 市值分布；
2. 结构分析：股票与基金的占比、各市场分布、单一标的集中度风险；
3. 当日表现：当日盈亏与当日盈亏率的整体与个股情况；
4. 风险提示：结合回撤、集中度、币种敞口给出客观判断；
5. 配置建议：基于以上数据给出 2~3 条可执行的优化建议。
语言专业克制，避免夸张表述，可适度使用分点与小标题，篇幅 400~600字。

我的持仓数据如下：
{{DATA}}`,
	},
}

const dataPlaceholder = "{{DATA}}"

// loadAIConfig reads the persisted config and fills in defaults where missing.
func loadAIConfig(uid int64) (aiConfig, error) {
	raw, err := db.GetAIConfig(uid)
	if err != nil {
		return aiConfig{}, err
	}
	var cfg aiConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return aiConfig{}, err
	}
	if len(cfg.Templates) == 0 {
		cfg.Templates = defaultTemplates
	}
	if cfg.Model == "" {
		cfg.Model = "deepseek-v4-pro"
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.deepseek.com"
	}
	return cfg, nil
}

func aiSettingsGet(c *gin.Context) {
	cfg, err := loadAIConfig(currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func aiSettingsPost(c *gin.Context) {
	var b aiConfig
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.Model == "" {
		b.Model = "deepseek-v4-pro"
	}
	if b.BaseURL == "" {
		b.BaseURL = "https://api.deepseek.com"
	}
	raw, _ := json.Marshal(b)
	if err := db.SaveAIConfig(currentUserID(c), string(raw)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type aiSummaryReq struct {
	APIKey   string `json:"api_key"`
	Model    string `json:"model"`
	BaseURL  string `json:"base_url"`
	Template string `json:"template"`
}

func aiSummary(c *gin.Context) {
	uid := currentUserID(c)
	var b aiSummaryReq
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	// Prefer the API key supplied by the client (the key box in the frontend) so a
	// freshly entered or updated key takes effect immediately without a separate save
	// — otherwise a stale/invalid saved key makes every summary 401. Fall back to the
	// saved config key only when the client leaves the field blank. Model/base_url/
	// template still fall back to saved values when the client leaves them blank.
	cfg, cfgErr := loadAIConfig(uid)
	if b.APIKey == "" {
		b.APIKey = cfg.APIKey
	}
	if b.Model == "" {
		b.Model = cfg.Model
	}
	if b.BaseURL == "" {
		b.BaseURL = cfg.BaseURL
	}
	if b.Template == "" {
		if len(cfg.Templates) > 0 {
			b.Template = cfg.Templates[0].Content
		} else {
			b.Template = defaultTemplates[0].Content
		}
	}
	if b.APIKey == "" || b.BaseURL == "" || b.Model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先在「AI 设置」中填写 API Key、模型名称与模型地址"})
		return
	}
	stats, err := buildPortfolioStats(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "统计失败: " + err.Error()})
		return
	}
	prompt := injectData(b.Template, stats)
	content, err := callChatCompletions(b.BaseURL, b.APIKey, b.Model, prompt)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	// Persist to history (keep latest 10). Failure is non-fatal. 空内容不写库，避免污染历史。
	if strings.TrimSpace(content) != "" {
		if err := db.SaveAISummary(content, b.Model, uid); err != nil {
			log.Printf("warn: save ai summary history failed: %v", err)
		}
	} else {
		log.Printf("[ai] model=%s 返回内容为空，跳过历史保存", b.Model)
	}
	// If the key actually used differs from the saved one (e.g. the user typed a
	// fresh key and generated without clicking "保存设置"), persist it so it
	// survives a page refresh. Non-fatal; only when the config loaded cleanly.
	if cfgErr == nil && b.APIKey != "" && b.APIKey != cfg.APIKey {
		cfg.APIKey = b.APIKey
		if raw, e := json.Marshal(cfg); e == nil {
			if e2 := db.SaveAIConfig(uid, string(raw)); e2 != nil {
				log.Printf("warn: persist api key from summary failed: %v", e2)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"content": content})
}

// injectData replaces the {{DATA}} placeholder with the live stats. If the template
// has no placeholder we append the stats so the model still receives the data.
func injectData(tmpl, data string) string {
	if strings.Contains(tmpl, dataPlaceholder) {
		return strings.ReplaceAll(tmpl, dataPlaceholder, data)
	}
	return tmpl + "\n\n【我的持仓数据】\n" + data
}

// callChatCompletions calls an OpenAI-compatible /chat/completions endpoint
// (DeepSeek by default) and returns the assistant message content.
//
// 容错要点（针对线上“解析响应失败”复盘）：
//  1. 部分网关/代理在 stream:false 时仍返回 SSE 流（text/event-stream），标准
//     JSON 反序列化会失败 → 先识别并按事件流拼接 content。
//  2. 解析失败时在服务端记录原始响应体（前 800 字节），便于后续排查而非盲改。
//  3. DeepSeek-Reasoner 等模型正文可能落在 reasoning_content，content 为空时回退。
func callChatCompletions(baseURL, apiKey, model, prompt string) (string, error) {
	base := strings.TrimRight(baseURL, "/")
	url := base + "/chat/completions"
	payload := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.7,
		"stream":      false,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("调用模型失败: %w", err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("模型返回 %d: %s", resp.StatusCode, truncate(string(rb), 600))
	}
	raw := string(rb)
	// 兼容 SSE：Content-Type 为事件流，或响应体以 data: 起头/含换行 data:
	ct := resp.Header.Get("Content-Type")
	isSSE := strings.Contains(ct, "text/event-stream") ||
		strings.HasPrefix(strings.TrimSpace(raw), "data:") ||
		strings.Contains(raw, "\ndata:")
	if isSSE {
		if c, ok := parseSSEContent(raw); ok {
			return strings.TrimSpace(c), nil
		}
		// SSE 解析未命中也可能只是首行带 data: 前缀的普通 JSON，继续走 JSON 分支
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rb, &out); err != nil {
		// 记录原始响应体，便于定位（截断到 800 字节）
		log.Printf("[ai] 解析模型响应失败 model=%s base=%s ct=%q: %s", model, base, ct, truncate(raw, 800))
		return "", fmt.Errorf("解析响应失败: %s", truncate(raw, 400))
	}
	if len(out.Choices) == 0 {
		if out.Error != nil {
			return "", fmt.Errorf("模型错误: %s", out.Error.Message)
		}
		return "", fmt.Errorf("模型未返回内容")
	}
	content := strings.TrimSpace(out.Choices[0].Message.Content)
	if content == "" {
		// DeepSeek-Reasoner 等可能把正文放在 reasoning_content
		if rc := strings.TrimSpace(out.Choices[0].Message.ReasoningContent); rc != "" {
			log.Printf("[ai] model=%s content 为空，回退使用 reasoning_content (len=%d)", model, len(rc))
			content = rc
		}
	}
	return content, nil
}

// parseSSEContent 从 SSE 流（data: 行）中拼接 content / reasoning_content。
// 返回 (拼接文本, 是否至少解析到一段)。无法解析时返回 ("", false)。
func parseSSEContent(raw string) (string, bool) {
	var sb strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var ev struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			continue
		}
		for _, c := range ev.Choices {
			if c.Delta.Content != "" {
				sb.WriteString(c.Delta.Content)
			} else if c.Delta.ReasoningContent != "" {
				sb.WriteString(c.Delta.ReasoningContent)
			}
		}
	}
	if sb.Len() == 0 {
		return "", false
	}
	return sb.String(), true
}

// buildPortfolioStats assembles a human- and model-readable text snapshot of the
// whole portfolio (all holdings, unfiltered) including summary + per-holding detail.
func buildPortfolioStats(uid int64) (string, error) {
	hs, err := db.List(uid)
	if err != nil {
		return "", err
	}
	rate, hkdRate, _ := market.FetchFXRates()
	today := time.Now().Format("2006-01-02")

	hkdToCny := 1.0
	if hkdRate > 0 {
		hkdToCny = rate / hkdRate
	}
	var (
		cnyMV, cnyPnl         float64
		usdMV, usdPnl         float64
		hkdMV, hkdPnl         float64
		totalCNY, totalCostCNY float64
		totalDayCNY           float64
	)
	catMV := map[string]float64{}
	mktMV := map[string]float64{}
	views := make([]HoldingView, 0, len(hs))
	for _, h := range hs {
		v := enrich(h, uid)
		views = append(views, v)
		mv := v.MarketValue
		cv := v.CostValue
		pnl := v.Pnl
		switch h.Currency {
		case "USD":
			usdMV += mv
			usdPnl += pnl
			totalCNY += mv * rate
			totalCostCNY += cv * rate
		case "HKD":
			hkdMV += mv
			hkdPnl += pnl
			totalCNY += mv * hkdToCny
			totalCostCNY += cv * hkdToCny
		default:
			cnyMV += mv
			cnyPnl += pnl
			totalCNY += mv
			totalCostCNY += cv
		}
		cmv := mv * rateChoice(h.Currency, rate, hkdRate)
		catMV[h.Category] += cmv
		mktMV[h.Market] += cmv
		totalDayCNY += v.DayPnl * rateChoice(h.Currency, rate, hkdRate)
	}
	totalPnl := totalCNY - totalCostCNY
	totalPct := 0.0
	if totalCostCNY > 0 {
		totalPct = totalPnl / totalCostCNY * 100
	}

	var b strings.Builder
	b.WriteString("统计日期：" + today + "\n")
	if rate > 0 {
		b.WriteString("汇率：1 USD ≈ " + nf(rate) + " CNY\n")
	}
	b.WriteString("\n【组合总览】\n")
	b.WriteString("持仓总数：" + fmt.Sprintf("%d", len(hs)) + " 条\n")
	b.WriteString("总资产(CNY)：" + nf(totalCNY) + "\n")
	b.WriteString("总成本(CNY)：" + nf(totalCostCNY) + "\n")
	b.WriteString("总盈亏(CNY)：" + sf(totalPnl) + "（总收益率 " + pf(totalPct) + "）\n")
	b.WriteString("当日盈亏(CNY)：" + sf(totalDayCNY) + "\n")
	b.WriteString("RMB 市值(CNY)：" + nf(cnyMV) + "（盈亏 " + sf(cnyPnl) + "）\n")
	b.WriteString("USD 市值折合(CNY)：" + nf(usdMV*rate) + "（盈亏 " + sf(usdPnl*rate) + "）\n")
	b.WriteString("HKD 市值折合(CNY)：" + nf(hkdMV*hkdToCny) + "（盈亏 " + sf(hkdPnl*hkdToCny) + "）\n")

	b.WriteString("\n【资产结构（按 CNY 折算市值）】\n")
	for _, k := range []string{"stock", "fund"} {
		if v, ok := catMV[k]; ok && totalCNY > 0 {
			b.WriteString(catLabel(k) + "：" + nf(v) + "（占比 " + pf(v/totalCNY) + "）\n")
		}
	}
	if len(mktMV) > 0 {
		b.WriteString("市场分布：")
		parts := make([]string, 0, len(mktMV))
		for m, v := range mktMV {
			parts = append(parts, m+" "+nf(v))
		}
		b.WriteString(strings.Join(parts, " | ") + "\n")
	}

	b.WriteString("\n【持仓明细】\n")
	for i, v := range views {
		h := v.Holding
		line := fmt.Sprintf("%d. %s(%s) %s/%s/%s 份额%s 成本价%s 现价%s 市值(CNY)%s",
			i+1, h.Name, h.Symbol, catLabel(h.Category), h.Market, h.Currency,
			nf(h.Quantity), nf(h.CostPrice), nf(h.CurrentPrice), nf(v.MarketValue*(rateChoice(h.Currency, rate, hkdRate))))
		line += " 当日盈亏" + sf(v.DayPnl*(rateChoice(h.Currency, rate, hkdRate))) + "(" + pf(v.DayPnlPct) + ")"
		line += " 总盈亏" + sf(v.Pnl*(rateChoice(h.Currency, rate, hkdRate))) + "(" + pf(v.PnlPct) + ")"
		b.WriteString(line + "\n")
	}
	return b.String(), nil
}

// rateChoice returns the multiplier to convert a holding's value into CNY.
// USD->CNY uses cnyRate; HKD->CNY uses cnyRate/hkdRate (both USD-based rates
// from FetchFXRates). Other currencies are treated as CNY (multiplier 1).
func rateChoice(cur string, cnyRate, hkdRate float64) float64 {
	switch cur {
	case "USD":
		if cnyRate <= 0 {
			return 1
		}
		return cnyRate
	case "HKD":
		if hkdRate > 0 {
			return cnyRate / hkdRate
		}
		return 1
	default:
		return 1
	}
}

func catLabel(c string) string {
	if c == "fund" {
		return "基金"
	}
	return "股票"
}

// ---- number formatting helpers ----

func nf(f float64) string {
	neg := f < 0
	a := math.Abs(f)
	s := fmt.Sprintf("%.2f", a)
	dot := strings.IndexByte(s, '.')
	intp := s[:dot]
	var sb strings.Builder
	for i, ch := range intp {
		if i > 0 && (len(intp)-i)%3 == 0 {
			sb.WriteByte(',')
		}
		sb.WriteRune(ch)
	}
	out := sb.String() + s[dot:]
	if neg {
		out = "-" + out
	}
	return out
}

func sf(f float64) string {
	if f > 0 {
		return "+" + nf(f)
	}
	return nf(f)
}

func pf(f float64) string {
	if f > 0 {
		return "+" + fmt.Sprintf("%.2f", f) + "%"
	}
	return fmt.Sprintf("%.2f", f) + "%"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// aiHistoryGet returns the most recent AI summary history (newest first, max 5).
func aiHistoryGet(c *gin.Context) {
	rows, err := db.GetAISummaryHistory(5, currentUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"history": rows})
}

// generateDailyAISummary generates the portfolio AI summary using the saved
// config, persists it to history, and returns the content. It mirrors the logic
// in aiSummary but runs without an HTTP context (for the scheduled job).
func generateDailyAISummary(uid int64) (string, error) {
	cfg, err := loadAIConfig(uid)
	if err != nil {
		return "", err
	}
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		return "", fmt.Errorf("AI 未配置（请在 AI 设置填写 API Key / 模型 / 模型地址）")
	}
	tmpl := defaultTemplates[0].Content
	if len(cfg.Templates) > 0 {
		tmpl = cfg.Templates[0].Content
	}
	stats, err := buildPortfolioStats(uid)
	if err != nil {
		return "", err
	}
	prompt := injectData(tmpl, stats)
	content, err := callChatCompletions(cfg.BaseURL, cfg.APIKey, cfg.Model, prompt)
	if err != nil {
		return "", err
	}
	if err := db.SaveAISummary(content, cfg.Model, uid); err != nil {
		log.Printf("warn: save ai summary history failed: %v", err)
	}
	return content, nil
}

// ScheduleDailyAISummary runs once per day at 21:30 Beijing (after the 21:00
// fund snapshot). If AutoDaily is enabled in the AI settings, it generates the
// summary and saves it to history; if AutoSend is also enabled, it pushes the
// result via the configured notify channels.
func ScheduleDailyAISummary() {
	scheduleAt(21, 30, "AI收盘总结", func(label string) {
		if !isTradingDayCN(time.Now()) {
			log.Printf("[ai] %s 非交易日，跳过定时总结", label)
			return
		}
		for _, u := range allUsers() {
			cfg, err := loadAIConfig(u.ID)
			if err != nil {
				log.Printf("[ai] 读取用户 %d AI 配置失败: %v", u.ID, err)
				continue
			}
			if !cfg.AutoDaily {
				continue
			}
			content, err := generateDailyAISummary(u.ID)
			if err != nil {
				log.Printf("[ai] 用户 %d 定时总结生成失败: %v", u.ID, err)
				continue
			}
			log.Printf("[ai] 用户 %d 定时总结已生成并保存到历史", u.ID)
			if cfg.AutoSend {
				NotifyAIContent("持仓 AI 收盘总结", content)
			}
		}
	})
}
