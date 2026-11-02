package market

// ===== 指数日线（复盘页基准对比用，2026-11-02）=====
//
// 数据源：腾讯行情（web.ifzq.gtimg.cn），与项目里 A 股 / 美股日线同源，
// 一套解析就够，且**生产容器实测可达**。
//
// 最初用的是东财 push2his，本地跑通、线上全挂：容器只剩 A 记录里的一条 CDN 边缘
// （101.42.128.173 / 14.103.188.89 两个都 EOF），宿主 curl 同一 URL 却是 200。
// 换腾讯后同一容器直连正常 —— 指数这种「锦上添花」的数据不该绑定一个只在家宽可用的源。
//
//   - 沪深300  = sh000300  /appstock/app/fqkline/get?param=sh000300,day,,,N,qfq
//   - 标普500  = us.INX    /appstock/app/usfqkline/get?param=us.INX,day,,,N,qfq
//   - 纳指100  = us.NDX    同上
//
// 返回的日线行：["2026-10-26","4078.570","4103.540","4107.790","4057.560","192147155.000",...]
// 即 [日期, 开, 收, 高, 低, 量]，收盘价取下标 2。

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// IndexBar 指数单日收盘（只保留对比所需两列，不解析 OHLCV）。
type IndexBar struct {
	Date  string
	Close float64
}

// 指数日线缓存 6 小时：复盘页每次进入都会请求，但指数一天只变一次；
// 3 个指数 = 3 次外部请求，不缓存会把「打开复盘页」的耗时绑到外网。
const indexCacheTTL = 6 * time.Hour

// 失败负缓存 2 分钟：上游宕掉时若不做负缓存，每次进复盘页都要重试 3 次外网，
// 页面从 60ms 变成 700ms（线上实测过），而且失败没有自愈机会 —— 2 分钟足够扛过抖动。
const indexFailTTL = 2 * time.Minute

type indexCacheEntry struct {
	bars []IndexBar
	at   time.Time
	err  time.Time // 非零 = 上次失败时间（负缓存）
}

var (
	indexMu    sync.Mutex
	indexCache = map[string]indexCacheEntry{}
)

// FetchIndexDaily 拉取指数近 lmt 个交易日的日线（升序）。symbol 为腾讯代码（sh000300 / us.INX / us.NDX）。
// 上游失败时，只要缓存里还有旧数据就返回旧数据（附 error 由调用方决定是否提示），
// 不让一次网络抖动把整行基准对比变成「—」。
func FetchIndexDaily(symbol string, lmt int) ([]IndexBar, error) {
	if lmt <= 0 {
		lmt = 300
	}
	indexMu.Lock()
	if e, ok := indexCache[symbol]; ok {
		if len(e.bars) > 0 && time.Since(e.at) < indexCacheTTL {
			bars := e.bars
			indexMu.Unlock()
			return bars, nil
		}
		if len(e.bars) == 0 && !e.err.IsZero() && time.Since(e.err) < indexFailTTL {
			indexMu.Unlock()
			return nil, fmt.Errorf("index %s: upstream cooldown", symbol)
		}
	}
	indexMu.Unlock()

	bars, err := fetchIndexDaily(symbol, lmt)
	if err != nil {
		indexMu.Lock()
		stale, ok := indexCache[symbol]
		if ok {
			stale.err = time.Now() // 打失败时间戳，触发负缓存；旧数据仍可作为 stale 回给调用方
			indexCache[symbol] = stale
		} else {
			indexCache[symbol] = indexCacheEntry{err: time.Now()}
		}
		indexMu.Unlock()
		// 失败原因必须落日志：此前只回给前端一句「行情源不可用」，
		// 线上到底是 DNS 只给 AAAA、TLS 被拦还是上游改协议，无从判断（2026-11-02 踩过）。
		log.Printf("[market] index kline %s 拉取失败: %v", symbol, err)
		if ok && len(stale.bars) > 0 {
			return stale.bars, err
		}
		return nil, err
	}
	indexMu.Lock()
	indexCache[symbol] = indexCacheEntry{bars: bars, at: time.Now()}
	indexMu.Unlock()
	return bars, nil
}

func fetchIndexDaily(symbol string, lmt int) ([]IndexBar, error) {
	path := "fqkline"
	if strings.HasPrefix(symbol, "us") || strings.HasPrefix(symbol, "hk") {
		path = "usfqkline"
	}
	url := fmt.Sprintf("https://web.ifzq.gtimg.cn/appstock/app/%s/get?param=%s,day,,,%d,qfq", path, symbol, lmt)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Referer", "https://gu.qq.com/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var out struct {
		Code int `json:"code"`
		Data map[string]struct {
			Day    [][]interface{} `json:"day"`
			QfqDay [][]interface{} `json:"qfqday"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("parse index kline %s: %w (body %.80q)", symbol, err, string(body))
	}
	node, ok := out.Data[symbol]
	if !ok {
		return nil, fmt.Errorf("no index node %s (body %.80q)", symbol, string(body))
	}
	rows := node.Day
	if len(rows) == 0 {
		rows = node.QfqDay
	}
	bars := make([]IndexBar, 0, len(rows))
	for _, r := range rows {
		if len(r) < 3 {
			continue
		}
		date := fmt.Sprintf("%v", r[0])
		close_, e := strconv.ParseFloat(fmt.Sprintf("%v", r[2]), 64)
		if e != nil || close_ <= 0 {
			continue
		}
		bars = append(bars, IndexBar{Date: date, Close: close_})
	}
	if len(bars) == 0 {
		return nil, fmt.Errorf("no index data for %s (body %.80q)", symbol, string(body))
	}
	return bars, nil
}
