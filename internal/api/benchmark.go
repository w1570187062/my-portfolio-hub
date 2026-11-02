package api

// ===== 复盘页「基准对比」（2026-11-02）=====
//
// 只回答一个问题：这一年（近 1 年）自己做得比大盘好还是差。
//
// 三个基准（用户指定）：沪深300、标普500、纳指100。
//
// 口径必须写清，否则这个数字会误导：
//   - 基准 = 指数**区间价格收益**（起止收盘价，时间加权，不含分红）；
//   - 组合 = **持仓（股票/基金）**区间累计盈亏 ÷ 区间平均持仓本金
//     （本金取 pnl_daily 每日 contrib_cny 的均值，资金加权效果由「平均本金」近似）；
//   - 不含理财与现金：它们的每日盈亏没有「本金」序列，混进来会让分子分母口径不一致。
//     组合与基准的差额（pp）随行返回，前端直接展示，不在前端重算。

import (
	"net/http"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// 基准指数定义。symbol 为腾讯行情代码，见 internal/market/index.go 注释。
// 2026-11-02 从东财 secid 换过来：东财 push2his 在家宽能跑、在生产容器里持续 EOF
// （容器只拿到一条不可用的 CDN 边缘），腾讯这一套在两边都实测可达。
var benchIndexes = []struct {
	Key    string
	Label  string
	Symbol string
}{
	{"csi300", "沪深300", "sh000300"},
	{"sp500", "标普500", "us.INX"},
	{"ndx", "纳指100", "us.NDX"},
}

type benchItem struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	RetPct   float64  `json:"ret_pct"`
	FromDate string   `json:"from_date"`
	ToDate   string   `json:"to_date"`
	Ok       bool     `json:"ok"`
	Err      string   `json:"err,omitempty"`
	ExcessPP *float64 `json:"excess_pp"` // 组合 − 该指数（pp）；组合不可算时为 null
}

type benchPortfolio struct {
	RetPct  float64 `json:"ret_pct"`
	Ok      bool    `json:"ok"`
	PnlCNY  float64 `json:"pnl_cny"`
	AvgCost float64 `json:"avg_cost_cny"`
	Days    int     `json:"days"`
	Note    string  `json:"note"`
	// 实际覆盖的起止日：账本历史常不足 1 年（pnl_daily 从建账那天才有），
	// 指数窗口必须跟着它走，否则会拿 75 天的组合收益去比 365 天的指数收益。
	CoveredFrom string `json:"covered_from"`
	CoveredTo   string `json:"covered_to"`
}

// benchRangeMap 区间别名 → 天数；all = 0 表示不限制。
var benchRangeMap = map[string]int{
	"1m":  30,
	"3m":  90,
	"6m":  180,
	"1y":  365,
	"all": 0,
}

// benchRangeLabel 区间展示名。
var benchRangeLabel = map[string]string{
	"1m":  "近 1 月",
	"3m":  "近 3 月",
	"6m":  "近 6 月",
	"1y":  "近 1 年",
	"all": "全部",
}

// computeBenchmark 组合区间收益 + 三个指数同期收益。
// rangeStr: 1m/3m/6m/1y/all（默认 1y）。
func computeBenchmark(uid int64, rangeStr string) gin.H {
	now := time.Now().In(beijing)
	today := now.Format("2006-01-02")
	days, ok := benchRangeMap[rangeStr]
	if !ok {
		days = 365 // 默认近 1 年
		rangeStr = "1y"
	}
	var wantFrom string
	if days > 0 {
		wantFrom = now.AddDate(0, 0, -days).Format("2006-01-02")
	}
	from := wantFrom

	// ---- 组合：区间累计盈亏 ÷ 区间每日净资产基数均值 ----
	pf := benchPortfolio{Note: "持仓 + 理财的每日盈亏；分母为区间每日净资产基数均值（不含已平仓标的）"}
	var rows []db.PnlDay
	if r, err := db.GetPnlHistory(uid); err == nil {
		rows = r
	}
	calcContribCNY(uid, rows)
	// 理财每日盈亏与持仓同口径叠加（与 /api/pnl/history 一致），否则分子会漏掉理财收益。
	wpnl := wealthDailyPnlByDate(uid)
	var sumPnl, sumBase, sumCost float64
	var baseN, costN int
	for _, r := range rows {
		if r.Date < wantFrom || r.Date > today {
			continue
		}
		pnl := r.TotalCNY
		if wp, ok := wpnl[r.Date]; ok {
			pnl += wp.totalCNY
		}
		sumPnl += pnl
		if r.BaseCNY > 0 {
			sumBase += r.BaseCNY
			baseN++
		}
		if r.ContribCNY > 0 {
			sumCost += r.ContribCNY
			costN++
		}
		if pf.CoveredFrom == "" {
			pf.CoveredFrom = r.Date
		}
		pf.CoveredTo = r.Date
		pf.Days++
	}
	// 账本历史不足一年：把指数窗口收缩到组合真正覆盖的区间，保证两边天数一致。
	if pf.CoveredFrom != "" && pf.CoveredFrom > from {
		from = pf.CoveredFrom
		pf.Note = "账本历史不足 1 年，对比窗口已收缩至实际覆盖区间"
	}
	// 优先用净资产基数（与盈亏日历同源，「当日盈亏 / 当日基数」就是真实日收益率），
	// 老账本没有 base_cny 时退回成本口径。
	if baseN > 0 {
		pf.AvgCost = round2(sumBase / float64(baseN))
	} else if costN > 0 {
		pf.AvgCost = round2(sumCost / float64(costN))
		pf.Note = "历史数据缺少净资产基数，分母退回累计成本均值"
	}
	pf.PnlCNY = round2(sumPnl)
	// 少于 20 个交易日或基数无效时不给结论：样本太短的「收益率」只是噪声。
	if pf.Days >= 20 && pf.AvgCost > 0 {
		pf.Ok = true
		pf.RetPct = round2(sumPnl / pf.AvgCost * 100)
	} else if pf.Days > 0 {
		pf.Note = "区间内有效交易日不足 20 天，暂不参与对比"
	} else {
		pf.Note = "区间内没有盈亏记录"
	}

	// ---- 三个指数：区间价格收益 ----
	items := make([]benchItem, 0, len(benchIndexes))
	for _, b := range benchIndexes {
		it := benchItem{Key: b.Key, Label: b.Label}
		bars, err := market.FetchIndexDaily(b.Symbol, 300)
		if err != nil && len(bars) == 0 {
			it.Err = "行情源不可用"
			items = append(items, it)
			continue
		}
		it.FromDate, it.ToDate, it.RetPct, it.Ok = indexWindowReturn(bars, from)
		if !it.Ok {
			it.Err = "区间数据不足"
		}
		if it.Ok && pf.Ok {
			ex := round2(pf.RetPct - it.RetPct)
			it.ExcessPP = &ex
		}
		items = append(items, it)
	}

	return gin.H{
		// range 对象：前端文案跟着走，不能顶着「近 1 年」去展示 75 天的组合收益。
		"range": gin.H{
			"key":   rangeStr,
			"label": benchRangeLabel[rangeStr],
			"from":  from,
			"to":    today,
			"days":  days,                     // 0 = all
			"full":  days == 0 || from == wantFrom, // all 或窗口完整覆盖到今天
		},
		"portfolio": pf,
		"bench":     items,
	}
}

// indexWindowReturn 取「截至 from 的最近一个交易日收盘」到「最新收盘」的区间收益（%）。
// 指数交易日历与 A 股不同（美股多一个时区差），所以两端都各自按自己的 K 线取边界值，
// 不强行对齐到同一天 —— 差一两个交易日对年度收益的影响远小于「对齐后没数据」。
func indexWindowReturn(bars []market.IndexBar, from string) (fromDate, toDate string, ret float64, ok bool) {
	if len(bars) < 2 {
		return "", "", 0, false
	}
	base := -1
	for i, b := range bars {
		if b.Date <= from {
			base = i
		} else {
			break
		}
	}
	if base < 0 {
		base = 0 // 数据起点晚于 from：用最早一根当基准，并在起止日里如实体现
	}
	last := bars[len(bars)-1]
	if base >= len(bars)-1 || bars[base].Close <= 0 {
		return "", "", 0, false
	}
	ret = round2((last.Close/bars[base].Close - 1) * 100)
	return bars[base].Date, last.Date, ret, true
}

// benchmarkGet GET /api/review/benchmark?range=1y（1m/3m/6m/1y/all，默认 1y）
func benchmarkGet(c *gin.Context) {
	rng := c.Query("range")
	c.JSON(http.StatusOK, computeBenchmark(currentUserID(c), rng))
}
