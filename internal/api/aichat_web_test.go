package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 联网检索工具的单测：只覆盖「请求体形状 + 结果过滤 + 文本格式」，
// 真实 Search API 需要官方 Key，本地不跑（无 Key 时被 aiWebEnabled 挡掉）。

func TestAIWebEnabled(t *testing.T) {
	cases := map[string]bool{
		"":                                  false,
		"https://api.deepseek.com":          true,
		"https://api.deepseek.com/":         true,
		"https://api.deepseek.com/v1":       true,
		"HTTPS://API.DEEPSEEK.COM":          true,
		"http://api.deepseek.com":           true,
		"https://api.agnes-ai.cn/v1":        false,
		"https://api.deepseek.com.proxy.io": false,
		"https://my-gateway.local/deepseek": false,
	}
	for base, want := range cases {
		if got := aiWebEnabled(base); got != want {
			t.Errorf("aiWebEnabled(%q)=%v want %v", base, got, want)
		}
	}
}

func TestDeepseekOrigin(t *testing.T) {
	cases := map[string]string{
		"":                             "https://api.deepseek.com",
		"https://api.deepseek.com/v1":  "https://api.deepseek.com",
		"https://api.deepseek.com/v1/": "https://api.deepseek.com",
		"http://127.0.0.1:8080/x":      "http://127.0.0.1:8080",
	}
	for in, want := range cases {
		if got := deepseekOrigin(in); got != want {
			t.Errorf("deepseekOrigin(%q)=%q want %q", in, got, want)
		}
	}
}

func TestChatToolWebSearch(t *testing.T) {
	var gotPath string
	var gotBody map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("missing bearer auth, got %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"results": []map[string]interface{}{
				{
					"rerank_score": 2.4, "title": "茅台三季报点评", "url": "https://example.com/a",
					"summary": "三季度营收同比增长。", "site_name": "示例财经",
					"date": "2026-10-30T00:00:00+00:00", "authority": 3,
				},
				{
					// 低质：应被过滤
					"rerank_score": 0.4, "title": "广告页", "url": "https://ads.example.com/x",
					"summary": "买买买", "site_name": "AD", "date": nil,
				},
				{
					// 重复 URL：应去重
					"rerank_score": 2.1, "title": "重复", "url": "https://example.com/a",
					"summary": "dup",
				},
			},
		})
	}))
	defer srv.Close()

	out := chatToolWebSearch(srv.URL+"/v1", "sk-test", "茅台最近怎么样", map[string]interface{}{
		"query": "贵州茅台 三季报",
		"count": float64(5),
	})

	if gotPath != "/v1/tools/search" {
		t.Errorf("path=%q want /v1/tools/search", gotPath)
	}
	if gotBody["query"] != "贵州茅台 三季报" {
		t.Errorf("query not forwarded: %v", gotBody["query"])
	}
	if gotBody["need_content"] != false {
		t.Errorf("need_content should be false, got %v", gotBody["need_content"])
	}
	if gotBody["ori_question"] != "茅台最近怎么样" {
		t.Errorf("ori_question=%v", gotBody["ori_question"])
	}
	if !strings.Contains(out, "https://example.com/a") {
		t.Errorf("结果缺 URL：%s", out)
	}
	if !strings.Contains(out, "2026-10-30") {
		t.Errorf("结果缺发布日期：%s", out)
	}
	if strings.Contains(out, "ads.example.com") {
		t.Errorf("低质结果未被过滤：%s", out)
	}
	if strings.Count(out, "https://example.com/a") != 1 {
		t.Errorf("同一 URL 未去重：%s", out)
	}
	if !strings.Contains(out, "1 条结果") {
		t.Errorf("条数统计不对：%s", out)
	}
}

func TestChatToolWebSearchHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
	}))
	defer srv.Close()

	out := chatToolWebSearch(srv.URL, "sk-test", "", map[string]interface{}{"query": "x"})
	if !strings.Contains(out, "搜索失败") || !strings.Contains(out, "429") {
		t.Errorf("应把 HTTP 错误回给模型而不是 panic：%s", out)
	}
	if !strings.Contains(out, "不要编造") {
		t.Errorf("缺防编造提示：%s", out)
	}
}

func TestChatToolWebFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"title":   "示例文章",
			"content": "# 标题\n\n正文内容。",
		})
	}))
	defer srv.Close()

	out := chatToolWebFetch(srv.URL, "sk-test", map[string]interface{}{"url": "https://example.com/post"})
	if !strings.Contains(out, "示例文章") || !strings.Contains(out, "正文内容") {
		t.Errorf("抓取结果格式异常：%s", out)
	}

	// 非法 URL 直接拒绝，不发请求
	if got := chatToolWebFetch(srv.URL, "sk-test", map[string]interface{}{"url": "ftp://x/y"}); !strings.Contains(got, "HTTP/HTTPS") {
		t.Errorf("非 http(s) 应被拒：%s", got)
	}
	if got := chatToolWebFetch(srv.URL, "sk-test", map[string]interface{}{"url": "https://u:p@example.com/x"}); !strings.Contains(got, "用户名") {
		t.Errorf("带 userinfo 应被拒：%s", got)
	}
}

func TestAIChatToolsWebGating(t *testing.T) {
	names := func(defs []map[string]interface{}) map[string]bool {
		out := map[string]bool{}
		for _, d := range defs {
			if fn, ok := d["function"].(map[string]interface{}); ok {
				if n, _ := fn["name"].(string); n != "" {
					out[n] = true
				}
			}
		}
		return out
	}

	off := names(aiChatTools(false))
	if off["web_search"] || off["web_fetch"] {
		t.Errorf("非官方端点不应挂联网工具: %v", off)
	}
	if !off["portfolio_summary"] {
		t.Errorf("本地工具缺失: %v", off)
	}

	on := names(aiChatTools(true))
	if !on["web_search"] || !on["web_fetch"] {
		t.Errorf("官方端点应挂上联网工具: %v", on)
	}
	// 账本工具必须同时存在（联网不能顶掉账本能力）
	if !on["portfolio_summary"] {
		t.Errorf("联网模式下账本工具丢失: %v", on)
	}
}

func TestExecChatToolWebGuard(t *testing.T) {
	// 第三方网关下即便模型硬造出 web_search 调用，也只能得到一句说明，绝不外发请求
	got := execChatTool("web_search", `{"query":"x"}`, 1, "https://api.agnes-ai.cn/v1", "sk-x", "")
	if !strings.Contains(got, "不支持联网") {
		t.Errorf("非官方端点未拦截: %s", got)
	}
}

func TestClipRunes(t *testing.T) {
	if got := clipRunes("中文测试", 2); got != "中文…" {
		t.Errorf("clipRunes=%q", got)
	}
	if got := clipRunes("abc", 5); got != "abc" {
		t.Errorf("clipRunes 不应补省略号：%q", got)
	}
}
