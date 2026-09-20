package market

import (
	"encoding/json"
	"io"
	"net/url"
	"strings"
)

// SearchResult 是证券联想结果。
// Market 取值 CN/HK/US（股票，对应组合持仓的 沪深/港股/美股）；基金为 ""（市场细分由前端默认后可改）。
// Category 取值 stock/fund。
type SearchResult struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Market   string `json:"market"`
	Category string `json:"category"`
}

// SearchSecurities 调用东方财富联想接口，按名称/代码模糊匹配证券。
// 参考 PanWatch 的 src/web/stock_list.py::_realtime_search（同款数据源）。
// 仅依赖标准库 + 包内 httpClient（强制 IPv4，避免容器无 IPv6 路由时挂起）。
func SearchSecurities(q string) ([]SearchResult, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []SearchResult{}, nil
	}
	u := "https://searchapi.eastmoney.com/api/suggest/get?input=" +
		url.QueryEscape(q) + "&type=14&count=100"
	resp, err := httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var data struct {
		QuotationCodeTable struct {
			Data []struct {
				Code             string `json:"Code"`
				Name             string `json:"Name"`
				Classify         string `json:"Classify"`
				SecurityTypeName string `json:"SecurityTypeName"`
				TypeUS           string `json:"TypeUS"`
			} `json:"Data"`
		} `json:"QuotationCodeTable"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	var out []SearchResult
	for _, it := range data.QuotationCodeTable.Data {
		classify := strings.TrimSpace(it.Classify)
		secType := strings.TrimSpace(it.SecurityTypeName)
		codeRaw := strings.TrimSpace(it.Code)

		// 基金：类别自动填 fund；市场细分（QDII/债券/股票/商品）上游无法可靠给出，留空由前端默认后可改。
		isFund := strings.Contains(secType, "基金") || classify == "OTCFUND" || classify == "Fund"
		if isFund {
			symbol := normalizeSearchSymbol(codeRaw, "")
			name := strings.TrimSpace(it.Name)
			if symbol == "" || name == "" {
				continue
			}
			out = append(out, SearchResult{Symbol: symbol, Name: name, Market: "", Category: "fund"})
			if len(out) >= 20 {
				break
			}
			continue
		}

		// 判断市场（东方财富口径：Classify/沪深北/港/美）。
		// 注意：不要用 HasPrefix(codeRaw, "BJ") 判断北交所，否则美股 BJRI 之类会被误判为 A 股。
		var mkt string
		switch {
		case classify == "AStock" || classify == "BJStock" ||
			strings.Contains(secType, "沪") || strings.Contains(secType, "深") || strings.Contains(secType, "北") ||
			strings.HasSuffix(codeRaw, ".BJ"):
			mkt = "CN"
		case classify == "HKStock" || classify == "HK" || strings.Contains(secType, "港"):
			mkt = "HK"
		case classify == "UsStock" || strings.Contains(secType, "美"):
			mkt = "US"
		default:
			continue // 跳过指数、板块、债券等
		}

		// 按市场过滤非权益类（TypeUS 语义随市场不同，以下为实测口径）：
		//   港股 6=窝轮/牛熊证（如「腾讯法兴七三购A」）、18=港股期货 —— 数量极多会刷屏，排除；
		//   美股 6=公司债票据（如 AAPL26 Notes）排除；5=ETF（QQQ/SPY 等主流持仓标的）必须保留。
		// 港股正股为 3（含 -R 人民币柜台）、ETF 为 1，均保留。
		switch mkt {
		case "HK":
			if it.TypeUS == "6" || it.TypeUS == "18" {
				continue
			}
		case "US":
			if it.TypeUS == "6" {
				continue
			}
		}

		symbol := normalizeSearchSymbol(codeRaw, mkt)
		if symbol == "" {
			continue
		}
		name := strings.TrimSpace(it.Name)
		if name == "" {
			continue
		}
		out = append(out, SearchResult{
			Symbol:   symbol,
			Name:     name,
			Market:   mkt,
			Category: "stock",
		})
		if len(out) >= 20 {
			break
		}
	}
	return out, nil
}

// normalizeSearchSymbol 去掉市场前缀/后缀，规范化为纯代码。
// 港股保证 5 位（左侧补 0），与组合持仓存储口径一致。
// 前缀仅在「后面紧跟数字」时剥离，避免误伤 USB/SHOO 等美股代码。
func normalizeSearchSymbol(code, mkt string) string {
	c := strings.TrimSpace(strings.ToUpper(code))
	if i := strings.Index(c, "."); i >= 0 { // 00700.HK / 836239.BJ
		c = c[:i]
	}
	stripPrefix := func(p string) {
		if strings.HasPrefix(c, p) && len(c) > len(p) && c[len(p)] >= '0' && c[len(p)] <= '9' {
			c = c[len(p):]
		}
	}
	switch mkt {
	case "CN":
		stripPrefix("SH")
		stripPrefix("SZ")
		stripPrefix("BJ")
	case "HK":
		stripPrefix("HK")
	}
	if mkt == "HK" {
		for len(c) < 5 {
			c = "0" + c
		}
	}
	return c
}
