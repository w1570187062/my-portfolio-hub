package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ---- AI 助手联网检索（DeepSeek Search / Fetch API）----
//
// 为什么不用 DeepSeek 的「服务端联网工具」（tools 里声明 deepseek_web_search）：
//  1. 官方要求该工具只跑 deepseek-flash，而账本助手默认 deepseek-v4-pro，切模型会连带改变现有回答风格；
//  2. 文档明确它不能与其它工具混声明（other tools cannot be used together with ...），
//     而我们同一轮必须暴露 list_holdings / record_transaction 等账本工具；
//  3. 非流式请求拿不到 server_tool_calls 的过程，且 signature 必须入库才能跨轮复用，
//     现有 ai_chat_messages 只有 role/content/tool_name 三列。
//
// 因此这里把 Search / Fetch 包成普通 function tool：模型照常调 tool，我们把 HTTP 结果转成
// 纯文本塞回 tool message，完全复用 runChatLoop 与现有会话存储，零结构改动。
//
// 计费：Search / Fetch 按「成功且有结果的请求」计费（5 元 / 1000 次），无结果、失败、超时不计费；
// count 不影响单价，所以宁可少调也别把 count 调大（都是 token）。

const (
	aiWebTimeout      = 25 * time.Second
	aiWebMaxCount     = 8   // 单次返回条数上限（官方允许 50；多给只会烧 token）
	aiWebMinScore     = 1.5 // rerank_score 低于此为低质结果（官方口径：>=1.5 优质）
	aiWebMaxSummary   = 500 // 单条长摘要截断（原文 600~800 字符，留够信息又不挤爆上下文）
	aiWebMaxFetchBody = 6000
	aiWebNeedContent  = false // content 全文太重，summary 已够模型阅读
)

// aiWebEnabled 只有官方 DeepSeek 端点提供 /v1/tools/search、/v1/tools/fetch。
// 自定义网关（第三方 OpenAI 兼容层）没有这两个接口，声明工具会直接 400，
// 所以按 base_url 判定，非官方地址整体隐藏联网能力（与 aiGuardBaseURL 的宽松策略配套）。
func aiWebEnabled(baseURL string) bool {
	b := strings.ToLower(strings.TrimSpace(baseURL))
	b = strings.TrimPrefix(b, "https://")
	b = strings.TrimPrefix(b, "http://")
	if i := strings.IndexByte(b, '/'); i >= 0 {
		b = b[:i]
	}
	if i := strings.IndexByte(b, ':'); i >= 0 {
		b = b[:i]
	}
	return b == "api.deepseek.com"
}

// aiWebToolDefs 返回联网检索的 function tool 定义（仅在官方端点下挂载）。
func aiWebToolDefs() []map[string]interface{} {
	return []map[string]interface{}{
		{
			"type": "function",
			"function": map[string]interface{}{
				"name": "web_search",
				"description": "联网搜索实时网页。回答「最近/今天/最新/新闻/公告/财报/政策/为什么涨跌」类问题，或需要账本以外的公开信息时必须先调用。" +
					"query 支持搜索语法：\"精确短语\"、site:github.com、-site:example.com、-关键词、lang:zh,en、after:2025-01-01、before:2026-06-01，" +
					"需要限定时间或来源时写进 query，不要另加参数。返回结果含标题、URL、站点、发布日期与摘要。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"query": map[string]interface{}{"type": "string", "description": "搜索词（1~128 字符），可带 site:/after:/lang: 等语法。"},
						"count": map[string]interface{}{"type": "integer", "description": "返回条数 1~8，默认 5。宁少勿多。"},
					},
					"required": []string{"query"},
				},
			},
		},
		{
			"type": "function",
			"function": map[string]interface{}{
				"name": "web_fetch",
				"description": "抓取指定网页的正文（Markdown）。用于阅读用户给出的链接，或搜索结果里需要看全文的那一篇（优先挑官方/权威站点）。" +
					"不要对搜索结果逐条抓取，最多抓 1~2 篇最相关的。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"url": map[string]interface{}{"type": "string", "description": "要抓取的 HTTP/HTTPS 链接。"},
					},
					"required": []string{"url"},
				},
			},
		},
	}
}

// ---- 底层 HTTP ----

// deepseekOrigin 取 base_url 的 scheme+host。工具接口路径固定为 /v1/tools/*，
// 而 chat 端允许用户把 base 填成 https://api.deepseek.com/v1（DeepSeek 两个路径都认），
// 若直接拼 base 会得到 /v1/v1/tools/search → 404，所以这里只保留 origin。
func deepseekOrigin(baseURL string) string {
	raw := strings.TrimSpace(baseURL)
	if raw == "" {
		return "https://api.deepseek.com"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "https://api.deepseek.com"
	}
	scheme := u.Scheme
	if scheme == "" {
		scheme = "https"
	}
	return scheme + "://" + u.Host
}

// deepseekToolPost 调用 /v1/tools/* 系列接口。非 200 时把错误体塞进 error 返回给模型看，
// 由模型决定是换个 query 还是直接说「联网不可用」，绝不 panic、绝不中断对话循环。
func deepseekToolPost(baseURL, apiKey, path string, payload map[string]interface{}, out interface{}) error {
	base := deepseekOrigin(baseURL)
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	client := &http.Client{Timeout: aiWebTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("网络异常：%v", err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d %s", resp.StatusCode, clipRunes(strings.TrimSpace(string(rb)), 160))
	}
	if err := json.Unmarshal(rb, out); err != nil {
		return fmt.Errorf("响应解析失败：%v", err)
	}
	return nil
}

// ---- Search ----

type webSearchItem struct {
	RerankScore float64 `json:"rerank_score"`
	Title       string  `json:"title"`
	URL         string  `json:"url"`
	Snippet     string  `json:"snippet"`
	Summary     string  `json:"summary"`
	SiteName    string  `json:"site_name"`
	Date        string  `json:"date"`
	Authority   int     `json:"authority"`
}

type webSearchResp struct {
	Results []webSearchItem `json:"results"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func chatToolWebSearch(baseURL, apiKey, question string, args map[string]interface{}) string {
	query, _ := args["query"].(string)
	query = strings.TrimSpace(query)
	if query == "" {
		return "缺少 query 参数。请重新调用并给出搜索词。"
	}
	if utf8.RuneCountInString(query) > 128 {
		query = string([]rune(query)[:128])
	}
	count := 5
	switch v := args["count"].(type) {
	case float64:
		count = int(v)
	case string:
		if n, e := strconv.Atoi(strings.TrimSpace(v)); e == nil {
			count = n
		}
	}
	if count < 1 {
		count = 5
	}
	if count > aiWebMaxCount {
		count = aiWebMaxCount
	}

	payload := map[string]interface{}{
		"query":        query,
		"count":        count,
		"need_content": aiWebNeedContent,
	}
	// ori_question 帮助搜索引擎理解意图（可选字段，失败不影响主流程）
	if q := strings.TrimSpace(question); q != "" && utf8.RuneCountInString(q) <= 128 {
		payload["ori_question"] = q
	}

	var res webSearchResp
	if err := deepseekToolPost(baseURL, apiKey, "/v1/tools/search", payload, &res); err != nil {
		return "搜索失败（" + err.Error() + "）。请直接告诉用户无法联网检索，不要编造新闻或行情。"
	}
	if res.Error != nil && strings.TrimSpace(res.Error.Message) != "" {
		return "搜索失败（" + res.Error.Message + "）。请直接告诉用户无法联网检索，不要编造。"
	}
	if len(res.Results) == 0 {
		return fmt.Sprintf("搜索「%s」没有匹配结果。可以换更短的关键词、去掉限定语法后重试一次；仍为空就直说没搜到。", query)
	}

	// 过滤低质 + 去重（同一 URL 只留一条），最多取 count 条
	seen := map[string]bool{}
	var picked []webSearchItem
	var lowQ []webSearchItem
	for _, it := range res.Results {
		if strings.TrimSpace(it.URL) == "" || seen[it.URL] {
			continue
		}
		seen[it.URL] = true
		if it.RerankScore >= aiWebMinScore {
			picked = append(picked, it)
		} else {
			lowQ = append(lowQ, it)
		}
	}
	lowQuality := false
	if len(picked) == 0 {
		// 全部低于阈值：宁可给模型几条低质结果（带警告），也别让它空手编答案
		if len(lowQ) > 3 {
			lowQ = lowQ[:3]
		}
		picked = lowQ
		lowQuality = true
	}
	if len(picked) > count {
		picked = picked[:count]
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("搜索「%s」返回 %d 条结果：\n", query, len(picked)))
	if lowQuality {
		sb.WriteString("（相关性偏低，仅供参考；回答时必须说明来源可信度有限）\n")
	}
	for i, it := range picked {
		sb.WriteString(fmt.Sprintf("\n[%d] %s\n", i+1, strings.TrimSpace(it.Title)))
		sb.WriteString("URL: " + it.URL + "\n")
		meta := make([]string, 0, 3)
		if hasText(it.SiteName) {
			meta = append(meta, it.SiteName)
		}
		if d := it.Date; len(d) >= 10 {
			meta = append(meta, d[:10])
		}
		if it.Authority >= 3 {
			meta = append(meta, fmt.Sprintf("权威度 %d", it.Authority))
		}
		if len(meta) > 0 {
			sb.WriteString("来源: " + strings.Join(meta, " · ") + "\n")
		}
		text := strings.TrimSpace(it.Summary)
		if text == "" {
			text = strings.TrimSpace(it.Snippet)
		}
		if text != "" {
			sb.WriteString("摘要: " + clipRunes(text, aiWebMaxSummary) + "\n")
		}
	}
	sb.WriteString("\n引用要求：引用外部事实时用 Markdown 链接 [标题](URL) 并带上日期；没有链接的内容不要写成事实。")
	return sb.String()
}

// hasText 判断站点名等可选字符串是否「有值」（JSON null 反序列化成空串，无需指针）。
func hasText(s string) bool { return strings.TrimSpace(s) != "" }

// ---- Fetch ----

func chatToolWebFetch(baseURL, apiKey string, args map[string]interface{}) string {
	raw, _ := args["url"].(string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "缺少 url 参数。"
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "url 必须是带 host 的 HTTP/HTTPS 地址。"
	}
	if u.User != nil {
		return "url 不能携带用户名或密码。"
	}

	var res struct {
		Title   string `json:"title"`
		Content string `json:"content"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := deepseekToolPost(baseURL, apiKey, "/v1/tools/fetch", map[string]interface{}{"url": raw}, &res); err != nil {
		return "抓取失败（" + err.Error() + "）。请改用搜索结果里的摘要作答，或说明该链接打不开。"
	}
	if res.Error != nil && strings.TrimSpace(res.Error.Message) != "" {
		return "抓取失败（" + res.Error.Message + "）。"
	}
	if strings.TrimSpace(res.Content) == "" {
		return "该网页没有可提取的正文（可能被站点策略拦截或内容为空）。请改用搜索摘要作答。"
	}
	title := strings.TrimSpace(res.Title)
	if title == "" {
		title = raw
	}
	return fmt.Sprintf("网页：%s\nURL: %s\n\n%s", title, raw, clipRunes(res.Content, aiWebMaxFetchBody))
}

// clipRunes 按字符（rune）截断 —— 中文占 3 字节，按字节切会切出半个 UTF-8 序列。
func clipRunes(s string, n int) string {
	if n <= 0 || s == "" {
		return ""
	}
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n]) + "…"
}
