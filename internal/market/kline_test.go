package market

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 线上服务器出口被腾讯 WAF 拦时返回的就是这种 501 HTML 跳转页。
const wafPage = `<!DOCTYPE html><html><head><script>location.href="https://waf.tencent.com/501page.html"</script></head></html>`
const tencentJSON = `{"code":0,"data":{"sh600036":{"day":[["2026-11-11","42.10","42.60","42.80","42.00","1000"],["2026-11-12","42.60","42.69","42.90","42.30","1200"]]}}}`

func useSources(t *testing.T, urls []string) {
	t.Helper()
	orig := aShareKlineURLs
	aShareKlineURLs = func(string) []string { return urls }
	t.Cleanup(func() { aShareKlineURLs = orig })
}

func TestFetchAShareKlineFallsBackOnWAFPage(t *testing.T) {
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotImplemented)
		_, _ = w.Write([]byte(wafPage))
	}))
	defer blocked.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(tencentJSON))
	}))
	defer good.Close()
	useSources(t, []string{blocked.URL, good.URL})

	bars, err := FetchKline("sh600036")
	if err != nil {
		t.Fatalf("第一源被拦时应回退到第二源，实际报错: %v", err)
	}
	if len(bars) != 2 || bars[0].Open != 42.10 || bars[1].Close != 42.69 {
		t.Fatalf("K 线解析结果不对: %+v", bars)
	}
}

func TestFetchAShareKlineAllSourcesBlocked(t *testing.T) {
	// 有些网关拦截时状态码仍是 200，只把 body 换成 HTML。
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(wafPage))
	}))
	defer blocked.Close()
	useSources(t, []string{blocked.URL, blocked.URL, blocked.URL})

	_, err := FetchKline("sh600036")
	if err == nil {
		t.Fatal("全部数据源被拦时应返回错误")
	}
	if !strings.Contains(err.Error(), "non-JSON response") {
		t.Fatalf("错误信息应指明是非 JSON 响应，实际: %v", err)
	}
	if strings.Contains(err.Error(), "invalid character") {
		t.Fatalf("不应再暴露底层 JSON 解析错误: %v", err)
	}
}

func TestParseEastmoneyKline(t *testing.T) {
	body := []byte(`{"rc":0,"data":{"code":"513050","klines":["2026-11-11,1.435,1.431,1.438,1.423,12142425","2026-11-12,1.433,1.433,1.439,1.422,11361480"]}}`)
	bars, err := parseEastmoneyKline(body)
	if err != nil {
		t.Fatalf("东方财富解析失败: %v", err)
	}
	if len(bars) != 2 || bars[0].Close != 1.431 || bars[1].High != 1.439 || bars[0].Volume != 12142425 {
		t.Fatalf("东方财富字段顺序解析错误: %+v", bars)
	}
}
