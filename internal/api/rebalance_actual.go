package api

// ===== 复盘页「本期兑现」：真实收益 vs 预期收益（2026-10-29 新增）=====
//
// 背景：原有 /api/rebalance 的收益三项（ret_target / ret_actual / excess_pct）全部是
// 「权重 × 配置里的假设年化」，那是配置层的内生期望，回答不了「这一期到底赚了多少、比预期多还是少」。
// 本文件补的是**已实现口径**：从上次复盘日（或指定周期起点）到今天，各类资产的真实盈亏。
//
// 口径（必须与前端文案逐字对应，改一处要同步另一处）：
//
//	真实收益 real = (期末市值 − 期初市值) − 期间净申购 + 期间分红
//	              —— 净申购把「追加本金」从收益里剔掉，分红从现金账户回补
//	预期收益 exp  = 期初市值 × 该类假设年化 × 天数/365
//	              —— 用期初市值做基数，与 real 的分子分母同源，行内可验算
//	兑现偏差 gap  = real − exp；兑现率 = real / exp
//
// 归因两因子（数学恒等，可逐项验算）：
//
//	real − plan = Σ(w_i − t_i)·e_i·T + (real − Σ w_i·e_i·T)
//	              └── 配置偏离 ──┘   └─── 兑现超额 ───┘
//
// 其中 plan 是「按目标权重 t 配置本可以赚多少」，w 是期初实际权重，e 是假设年化，T=天数/365。
//
// 已知数据缺口（页面必须显式暴露，不能静默当成 0 收益）：
//   - 现金：系统没有利息流水类型，real 恒为 0，quality=partial；
//   - 股票/基金：期初收盘价缺失时回落到成本价并把 quality 标 partial；
//   - 理财：期初无快照时回落到最早一条快照（起点被推迟），quality=partial。

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// rbActualBucket 单个类别的本期兑现结果。
type rbActualBucket struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	BeginCNY float64 `json:"begin_cny"`
	EndCNY   float64 `json:"end_cny"`
	NetInCNY float64 `json:"net_in_cny"`
	RealCNY  float64 `json:"real_cny"`
	RealPct  float64 `json:"real_pct"`
	ExpCNY   float64 `json:"exp_cny"`
	ExpPct   float64 `json:"exp_pct"`
	GapCNY   float64 `json:"gap_cny"`
	GapPP    float64 `json:"gap_pp"`
	HitRate  float64 `json:"hit_rate"` // %；exp 为 0 时置 0，前端显示「—」
	Count    int     `json:"count"`
	// Days 该类实际覆盖天数（各标的起点可能被顺延，取最短）。与整个区间天数不等的类别，
	// 其收益率不能和别类横向比 —— 页面据此提示，避免「今年基金只赚了 15 天的钱」被读成全年表现。
	Days    int    `json:"days"`
	Quality string `json:"quality"` // ok | partial | excluded
	Note    string `json:"note"`
}

// rbActualPoint 曲线上的一个采样点（元，CNY）。
type rbActualPoint struct {
	Date string  `json:"date"`
	Real float64 `json:"real"` // 累计真实收益
	Exp  float64 `json:"exp"`  // 累计预期收益（按当前配置的期初权重线性折算）
}

// rbActualTop 单只标的的本期收益贡献（用于「标的贡献 Top」）。
type rbActualTop struct {
	Key    string  `json:"key"` // stock | fund | wealth
	Label  string  `json:"label"`
	Name   string  `json:"name"`
	Symbol string  `json:"symbol"`
	PnlCNY float64 `json:"pnl_cny"`
	Pct    float64 `json:"pct"` // 相对期初市值
	Note   string  `json:"note"`
}

// rbActualResp 「本期兑现」完整响应。
type rbActualResp struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Days   int    `json:"days"`
	Source string `json:"source"` // last | month | quarter | year
	Label  string `json:"label"`  // 给前端直接显示的中文周期名

	BeginCNY float64 `json:"begin_cny"`
	EndCNY   float64 `json:"end_cny"`
	NetInCNY float64 `json:"net_in_cny"`

	RealCNY    float64 `json:"real_cny"`
	RealPct    float64 `json:"real_pct"`
	RealAnnPct float64 `json:"real_ann_pct"`

	ExpCNY  float64 `json:"exp_cny"`
	ExpPct  float64 `json:"exp_pct"`
	PlanCNY float64 `json:"plan_cny"`
	PlanPct float64 `json:"plan_pct"`

	GapCNY  float64 `json:"gap_cny"`
	GapPP   float64 `json:"gap_pp"`
	HitRate float64 `json:"hit_rate"`

	// 相对计划：real − plan，恒等于 AllocCNY + SelectCNY。
	// 与 GapCNY（real − exp，即「跑赢自己当前配置的预期多少」）是两个不同的差，
	// 页面必须分开写，否则「跑赢预期」和「跑赢计划」会被读成同一件事。
	PlanGapCNY float64 `json:"plan_gap_cny"`

	// 归因：alloc + select 恒等于 real − plan
	AllocCNY  float64 `json:"alloc_cny"`
	SelectCNY float64 `json:"select_cny"`

	Buckets []rbActualBucket `json:"buckets"`
	Series  []rbActualPoint  `json:"series"`
	Top     []rbActualTop    `json:"top"`
	Notes   []string         `json:"notes"`
}

// rbPeriodRange 把周期参数解析成 [from, to]。
// last 以最后一次复盘记录为起点；没有记录时回退到当月 1 日（与「本月」同义，但 Label 不同）。
func rbPeriodRange(uid int64, period string, now time.Time) (from, to, label string, days int) {
	to = now.Format("2006-01-02")
	switch strings.ToLower(strings.TrimSpace(period)) {
	case "month":
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
		label = "本月"
	case "quarter":
		q := (int(now.Month()) - 1) / 3
		from = time.Date(now.Year(), time.Month(q*3+1), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
		label = "本季"
	case "year":
		from = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
		label = "今年"
	default: // last
		label = "自上次复盘"
		if l, ok, _ := db.LastRebalanceLog(uid); ok && l != nil && strings.TrimSpace(l.Date) != "" {
			from = l.Date
			// 记录日当天已包含在快照里，从次日开始算，避免把「记录那一刻」重复计入
			if t, e := time.ParseInLocation("2006-01-02", from, now.Location()); e == nil {
				from = t.AddDate(0, 0, 0).Format("2006-01-02")
			}
		} else {
			from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
			label = "本月（暂无复盘记录）"
		}
	}
	days = daysBetweenDates(from, to)
	if days <= 0 {
		days = 1
	}
	return
}

// rbPriceAt 在已排序的价格序列里找 date <= d 的最后一个收盘价。
func rbPriceAt(series []db.PriceDay, d string) (float64, bool) {
	// 序列按日期升序；线上量级是几十到几百条，线性倒扫足够，避免引入额外索引结构
	for i := len(series) - 1; i >= 0; i-- {
		if series[i].Date <= d {
			return series[i].Close, true
		}
	}
	return 0, false
}

// rbPriceFirstIn 取区间 [from,to] 内第一条收盘价。期初缺价时用它把起点整体顺延，
// 比用成本价兜底准确得多（成本价会把整段持有期的浮盈算进本期）。
func rbPriceFirstIn(ps []db.PriceDay, from, to string) (float64, string, bool) {
	for _, p := range ps {
		if p.Date >= from && p.Date <= to && p.Close > 0 {
			return p.Close, p.Date, true
		}
	}
	return 0, "", false
}

// rbActualItem 单只标的的中间结果，供聚合、Top 与曲线复用。
type rbActualItem struct {
	key      string
	name     string
	symbol   string
	currency string
	beginCNY float64
	endCNY   float64
	netIn    float64 // 原币种
	div      float64 // 原币种
	realCNY  float64
	quality  string
	note     string
	// 曲线用：份额与交易时间轴（股票/基金）/ 快照序列（理财）
	qtyNow   float64
	txs      []db.PositionTx
	series   []db.PriceDay
	wSnaps   []db.WealthSnapshot
	wSnapCNY []float64
	wStart   string // 理财起点日：<= 该日的市值一律回落到 beginCNY，保证曲线与 begin 同源
	// effFrom 本标的的有效起点（期初缺价时会顺延）。曲线的累计净申购/分红必须从这天之后算，
	// 否则会把建仓以来的全部流水都当成「本期申购」，曲线整条沉下去。
	effFrom string
	days    int // 有效覆盖天数（effFrom → to）
}

// qtyAt 反推某日末的持仓份额：以当前份额为基准，扣除该日之后发生的加减仓。
// 分红（DIV）不改份额，只有送股再投才会改，当前系统把再投记成 REINVEST=BUY，故无需特判。
func (it *rbActualItem) qtyAt(d string) float64 {
	q := it.qtyNow
	for _, t := range it.txs {
		txDate := strings.TrimSpace(t.CreatedAt)
		if len(txDate) > 10 {
			txDate = txDate[:10]
		}
		if txDate == "" || txDate <= d {
			continue
		}
		switch t.TxType {
		case "BUY":
			q -= t.Quantity
		case "SELL":
			q += t.Quantity
		}
	}
	if q < 0 {
		return 0
	}
	return q
}

// netInAt 有效起点之后、某日（含）之前的累计净申购（原币种）。
func (it *rbActualItem) netInAt(d string) float64 {
	sum := 0.0
	for _, t := range it.txs {
		if t.Reverted == 1 {
			continue
		}
		txDate := strings.TrimSpace(t.CreatedAt)
		if len(txDate) > 10 {
			txDate = txDate[:10]
		}
		if txDate == "" || txDate <= it.effFrom || txDate > d {
			continue
		}
		switch t.TxType {
		case "BUY":
			sum += t.Amount + t.Fee
		case "SELL":
			sum -= t.Amount - t.Fee
		}
	}
	return sum
}

// computeRbActual 计算本期兑现。uid<=0 或区间无效时返回空结构（前端按空态渲染）。
func computeRbActual(uid int64, from, to string, label string, days int) rbActualResp {
	out := rbActualResp{
		From: from, To: to, Days: days, Label: label,
		Buckets: make([]rbActualBucket, 0, 4),
		Series:  make([]rbActualPoint, 0, 32),
		Top:     make([]rbActualTop, 0, 8),
		Notes:   make([]string, 0, 4),
	}
	cfg := loadRebalanceConfig(uid)
	expOf := map[string]float64{}
	tgtOf := map[string]float64{}
	for _, t := range cfg.Targets {
		expOf[t.Key] = t.Exp
		tgtOf[t.Key] = t.Pct
	}
	cnyRate, hkdRate, _ := market.FetchFXRates()
	yearFrac := float64(days) / 365.0

	items := make([]*rbActualItem, 0, 16)

	// ---- 1) 股票 / 基金：期初份额 + 期初价回算 ----
	hs, _ := db.List(uid)
	for _, h := range hs {
		if h.Closed {
			continue
		}
		cur := strings.ToLower(strings.TrimSpace(h.Currency))
		if cur == "rmb" {
			cur = "cny"
		}
		key := rbClassFund
		if strings.EqualFold(strings.TrimSpace(h.Category), "stock") {
			key = rbClassStock
		}
		txs, _ := db.ListPositionTx(h.ID)
		it := &rbActualItem{
			key: key, name: h.Name, symbol: h.Symbol, currency: cur,
			qtyNow: h.Quantity, quality: "ok", txs: txs,
		}
		// 期初价：优先 from 当日/之前最近的收盘价；缺价时把起点顺延到区间内第一条收盘价
		// （新入库基金常见），而不是用成本价 —— 成本价是建仓价，会把整个持有期的浮盈算进本期。
		ps, _ := db.GetPriceSeries(h.Symbol, uid)
		it.series = ps
		effFrom := from
		beginPrice, okP := rbPriceAt(ps, from)
		if !okP || beginPrice <= 0 {
			if p2, d2, ok2 := rbPriceFirstIn(ps, from, to); ok2 {
				beginPrice = p2
				effFrom = d2
				it.quality = "partial"
				it.note = "期初无收盘价，起点顺延至 " + d2
			} else {
				beginPrice = h.CostPrice
				it.quality = "partial"
				it.note = "区间内无收盘价，按成本价计"
			}
		}
		// 期初份额与净申购：只统计 (effFrom, to] 区间内的流水，起点顺延后同样要跟着挪
		qtyBegin := h.Quantity
		for _, t := range txs {
			if t.Reverted == 1 {
				continue
			}
			d := strings.TrimSpace(t.CreatedAt)
			if len(d) > 10 {
				d = d[:10]
			}
			if d <= effFrom || d > to {
				continue
			}
			switch t.TxType {
			case "BUY":
				qtyBegin -= t.Quantity
				it.netIn += t.Amount + t.Fee
			case "SELL":
				qtyBegin += t.Quantity
				it.netIn -= t.Amount - t.Fee
			case "DIV":
				it.div += t.Amount
			}
		}
		if qtyBegin < 0 {
			qtyBegin = 0
			it.quality = "partial"
			it.note = "期初份额为负，按 0 计（加仓早于建仓日期）"
		}
		it.effFrom = effFrom
		it.days = daysBetweenDates(effFrom, to)
		if it.days <= 0 {
			it.days = 1
		}
		it.beginCNY = fxToCNY(qtyBegin*beginPrice, cur, cnyRate, hkdRate)
		it.endCNY = fxToCNY(h.Quantity*h.CurrentPrice, cur, cnyRate, hkdRate)
		it.realCNY = round2((it.endCNY - it.beginCNY) - fxToCNY(it.netIn, cur, cnyRate, hkdRate) + fxToCNY(it.div, cur, cnyRate, hkdRate))
		if it.beginCNY == 0 && it.endCNY == 0 {
			continue
		}
		items = append(items, it)
	}

	// ---- 2) 理财：期初/期末快照 + 期间 cashflow ----
	wps, _ := db.ListWealth(uid)
	for _, w := range wps {
		if w.Archived {
			continue
		}
		snaps, _ := db.ListWealthSnapshots(w.ID)
		if len(snaps) == 0 {
			continue
		}
		cur := strings.ToLower(strings.TrimSpace(w.Currency))
		if cur == "rmb" {
			cur = "cny"
		}
		var beginAmt, endAmt, netIn float64
		beginOK := false
		early := false
		startDate := from
		// 期初快照：优先取 <= from 的最后一条；没有则用区间内第一条当起点（起点被推迟）。
		// 关键：起点当天及之前的 cashflow 必须排除，否则「当期申购」会被当成收益扣掉 ——
		// 一笔 7 万的新申购能让 real 直接变成 -7 万。
		for _, s := range snaps {
			if s.Date <= from {
				beginAmt = s.Amount
				beginOK = true
			}
		}
		if !beginOK {
			for _, s := range snaps {
				if s.Date > to {
					break
				}
				beginAmt = s.Amount
				startDate = s.Date
				beginOK = true
				early = true
				break
			}
		}
		if !beginOK {
			continue
		}
		for _, s := range snaps {
			if s.Date <= startDate {
				if s.Date == startDate {
					beginAmt = s.Amount
				}
				continue
			}
			if s.Date > to {
				break
			}
			endAmt = s.Amount
			netIn += s.Cashflow
		}
		if endAmt == 0 {
			// 区间内没有新快照：期末沿用 <= to 的最新一条
			for i := len(snaps) - 1; i >= 0; i-- {
				if snaps[i].Date <= to {
					endAmt = snaps[i].Amount
					break
				}
			}
		}
		it := &rbActualItem{
			key: rbClassWealth, name: w.Name, symbol: "", currency: cur,
			beginCNY: fxToCNY(beginAmt, cur, cnyRate, hkdRate),
			endCNY:   fxToCNY(endAmt, cur, cnyRate, hkdRate),
			quality:  "ok",
		}
		it.wSnaps = snaps
		it.wSnapCNY = make([]float64, len(snaps))
		it.wStart = startDate
		it.days = daysBetweenDates(startDate, to)
		if it.days <= 0 {
			it.days = 1
		}
		for i, s := range snaps {
			it.wSnapCNY[i] = fxToCNY(s.Amount, cur, cnyRate, hkdRate)
		}
		it.netIn = netIn
		it.realCNY = round2((it.endCNY - it.beginCNY) - fxToCNY(netIn, cur, cnyRate, hkdRate))
		if early {
			it.quality = "partial"
			it.note = "期初无快照，按最早一条计"
		}
		items = append(items, it)
	}

	// ---- 3) 现金：只取规模，收益恒为 0（无利息流水） ----
	var cashBegin, cashEnd float64
	var cashN int
	if cs, e := db.ListCash(uid); e == nil {
		for _, cc := range cs {
			if cc.Excluded || cc.Amount == 0 {
				continue
			}
			cashEnd += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
			cashN++
		}
	}
	cashBegin = cashEnd

	// ---- 4) 按类聚合 ----
	agg := map[string]*rbActualBucket{}
	for _, k := range rbClassOrder {
		agg[k] = &rbActualBucket{Key: k, Label: rbClassLabels[k], Quality: "ok", Days: days}
	}
	for _, it := range items {
		b := agg[it.key]
		b.BeginCNY += it.beginCNY
		b.EndCNY += it.endCNY
		b.NetInCNY += fxToCNY(it.netIn, it.currency, cnyRate, hkdRate)
		b.RealCNY += it.realCNY
		b.Count++
		if it.days > 0 && it.days < b.Days {
			b.Days = it.days
		}
		if it.quality == "partial" {
			b.Quality = "partial"
			if b.Note == "" {
				b.Note = it.note
			}
		}
	}
	if cashN > 0 {
		b := agg[rbClassCash]
		b.BeginCNY = cashBegin
		b.EndCNY = cashEnd
		b.Count = cashN
		b.Quality = "partial"
		b.Note = "现金利息未入账，本期收益按 0 计"
	}

	totalBegin, totalEnd, totalNetIn, totalReal := 0.0, 0.0, 0.0, 0.0
	for _, k := range rbClassOrder {
		b := agg[k]
		b.BeginCNY = round2(b.BeginCNY)
		b.EndCNY = round2(b.EndCNY)
		b.NetInCNY = round2(b.NetInCNY)
		b.RealCNY = round2(b.RealCNY)
		if b.BeginCNY > 0 {
			b.RealPct = round2(b.RealCNY / b.BeginCNY * 100)
		}
		e := expOf[k]
		b.ExpPct = round2(e * yearFrac)
		b.ExpCNY = round2(b.BeginCNY * e / 100 * yearFrac)
		b.GapCNY = round2(b.RealCNY - b.ExpCNY)
		b.GapPP = round2(b.RealPct - b.ExpPct)
		if b.ExpCNY > 0.005 {
			b.HitRate = round2(b.RealCNY / b.ExpCNY * 100)
		}
		totalBegin += b.BeginCNY
		totalEnd += b.EndCNY
		totalNetIn += b.NetInCNY
		totalReal += b.RealCNY
		out.Buckets = append(out.Buckets, *b)
	}

	out.BeginCNY = round2(totalBegin)
	out.EndCNY = round2(totalEnd)
	out.NetInCNY = round2(totalNetIn)
	out.RealCNY = round2(totalReal)
	if totalBegin > 0 {
		out.RealPct = round2(totalReal / totalBegin * 100)
		out.RealAnnPct = round2(out.RealPct / yearFrac)
	}

	// 预期（按实际期初权重）与计划（按目标权重）
	var expCNY, planCNY, selectCNY, allocCNY float64
	for _, b := range out.Buckets {
		e := expOf[b.Key]
		expCNY += b.ExpCNY
		planCNY += totalBegin * tgtOf[b.Key] / 100 * e / 100 * yearFrac
		w := 0.0
		if totalBegin > 0 {
			w = b.BeginCNY / totalBegin
		}
		allocCNY += (w - tgtOf[b.Key]/100) * e / 100 * yearFrac * totalBegin
		selectCNY += b.RealCNY - w*e/100*yearFrac*totalBegin
	}
	out.ExpCNY = round2(expCNY)
	out.PlanCNY = round2(planCNY)
	if totalBegin > 0 {
		out.ExpPct = round2(expCNY / totalBegin * 100)
		out.PlanPct = round2(planCNY / totalBegin * 100)
	}
	out.GapCNY = round2(out.RealCNY - out.ExpCNY)
	out.GapPP = round2(out.RealPct - out.ExpPct)
	if out.ExpCNY > 0.005 {
		out.HitRate = round2(out.RealCNY / out.ExpCNY * 100)
	}
	out.AllocCNY = round2(allocCNY)
	out.SelectCNY = round2(selectCNY)
	out.PlanGapCNY = round2(out.RealCNY - out.PlanCNY)

	// ---- 5) 曲线：逐日市值（份额按流水回推，价格取 <= 当日的最后收盘） ----
	out.Series = rbActualSeries(items, cashEnd, from, to, cnyRate, hkdRate, out.ExpCNY, out.RealCNY, days)

	// ---- 6) 标的贡献 Top ----
	sort.SliceStable(items, func(i, j int) bool {
		return math.Abs(items[i].realCNY) > math.Abs(items[j].realCNY)
	})
	limit := 5
	if len(items) < limit {
		limit = len(items)
	}
	for _, it := range items[:limit] {
		pct := 0.0
		if it.beginCNY > 0 {
			pct = round2(it.realCNY / it.beginCNY * 100)
		}
		out.Top = append(out.Top, rbActualTop{
			Key: it.key, Label: rbClassLabels[it.key], Name: it.name, Symbol: it.symbol,
			PnlCNY: it.realCNY, Pct: pct, Note: it.note,
		})
	}

	// ---- 7) 数据缺口提示（页面直接用，不自造文案） ----
	missCash := cashN > 0
	partial := 0
	var shortSpan []string
	for _, b := range out.Buckets {
		if b.Quality == "partial" && b.Key != rbClassCash {
			partial++
		}
		// 覆盖天数明显短于区间：该类收益率不能和其它类直接比（常见于「今年」+ 新入库基金）
		if b.Key != rbClassCash && b.Days > 0 && days > 0 && float64(b.Days) < float64(days)*0.6 {
			shortSpan = append(shortSpan, b.Label+"仅覆盖 "+strconv.Itoa(b.Days)+" 天")
		}
	}
	if len(shortSpan) > 0 {
		out.Notes = append(out.Notes, strings.Join(shortSpan, "、")+"（期初无可比价格/快照），该类收益率不能与其它类别直接横向比较。")
	}
	if partial > 0 {
		out.Notes = append(out.Notes, "有 "+strconv.Itoa(partial)+" 个类别缺期初价/快照，已用区间内最早可得值兜底，兑现率可能偏低。")
	}
	if missCash {
		out.Notes = append(out.Notes, "现金类无利息流水，本期收益按 0 计，不参与兑现率判断。")
	}
	if out.BeginCNY == 0 {
		out.Notes = append(out.Notes, "区间内没有可用的期初市值，无法计算兑现。")
	}
	return out
}

// rbActualSeries 生成真实/预期累计曲线。点数超过 90 时按等间隔采样（保留首尾）。
// 现金按常数处理：余额变化来自内部转账，不是收益，也无法逐日还原。
func rbActualSeries(items []*rbActualItem, cash float64, from, to string, cnyRate, hkdRate, expCNY, totalReal float64, days int) []rbActualPoint {
	start, err := time.ParseInLocation("2006-01-02", from, time.Local)
	if err != nil {
		return nil
	}
	end, err := time.ParseInLocation("2006-01-02", to, time.Local)
	if err != nil {
		return nil
	}
	total := int(end.Sub(start).Hours()/24) + 1
	if total <= 0 {
		return nil
	}
	step := 1
	if total > 90 {
		step = total / 90
		if step < 1 {
			step = 1
		}
	}

	baseMV := cash
	for _, it := range items {
		baseMV += it.beginCNY
	}
	dailyExp := 0.0
	if days > 0 {
		dailyExp = expCNY / float64(days)
	}

	// realAt 某日累计真实收益 = 当日市值 − 期初市值 − 累计净申购 + 累计分红
	realAt := func(d string) float64 {
		mv := cash
		for _, it := range items {
			if it.key == rbClassWealth {
				mv += rbWealthMVAt(it, d)
				continue
			}
			px, ok := rbPriceAt(it.series, d)
			if !ok || px <= 0 {
				mv += it.beginCNY // 缺价区间按住期初市值，曲线走平而不是断裂
				continue
			}
			mv += fxToCNY(it.qtyAt(d)*px, it.currency, cnyRate, hkdRate)
		}
		sum := mv - baseMV
		for _, it := range items {
			if it.key == rbClassWealth {
				// 理财没有 position_tx，净申购只能从快照的 cashflow 取；
				// 漏掉这一步会把「赎回」当成亏损（反之申购当成盈利）。
				sum -= fxToCNY(it.wNetInAt(d), it.currency, cnyRate, hkdRate)
				continue
			}
			sum -= fxToCNY(it.netInAt(d), it.currency, cnyRate, hkdRate)
			sum += fxToCNY(it.divAt(d), it.currency, cnyRate, hkdRate)
		}
		return sum
	}

	pts := make([]rbActualPoint, 0, total/step+2)
	for i := 0; i < total; i += step {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		// 首点按定义为 0：起点就是基准，任何非零都只说明期初价/快照口径没对齐
		r := 0.0
		if i > 0 {
			r = realAt(d)
		}
		pts = append(pts, rbActualPoint{Date: d, Real: round2(r), Exp: round2(dailyExp * float64(i))})
	}
	// 保证末点严格等于 to，且收益等于表里的合计 —— 历史收盘价可能停在几天前
	// （基金净值不每日更新），不强制对齐会让曲线末端突然跳一截。
	if n := len(pts); n == 0 || pts[n-1].Date != to {
		pts = append(pts, rbActualPoint{Date: to, Real: round2(totalReal), Exp: round2(expCNY)})
	} else {
		pts[len(pts)-1].Real = round2(totalReal)
		pts[len(pts)-1].Exp = round2(expCNY)
	}
	return pts
}

// wNetInAt 理财在有效起点之后、某日（含）之前的累计净申购（原币种）。
// cashflow 是「当日净申购额」：正=申购、负=赎回；起点当天的不算（那是期初本金的来源）。
func (it *rbActualItem) wNetInAt(d string) float64 {
	sum := 0.0
	for _, s := range it.wSnaps {
		if s.Date <= it.wStart || s.Date > d {
			continue
		}
		sum += s.Cashflow
	}
	return sum
}

// rbWealthMVAt 理财在某日的市值：无逐日快照，取 <= d 的最近一条。
// d <= 起点日时直接回落到期初市值 —— 否则曲线起点与表里的「期初」对不上（差一笔历史快照）。
func rbWealthMVAt(it *rbActualItem, d string) float64 {
	if it.wStart != "" && d <= it.wStart {
		return it.beginCNY
	}
	for i := len(it.wSnaps) - 1; i >= 0; i-- {
		if it.wSnaps[i].Date <= d {
			return it.wSnapCNY[i]
		}
	}
	return it.beginCNY
}

// divAt 有效起点之后、某日（含）之前累计分红（原币种）。
func (it *rbActualItem) divAt(d string) float64 {
	sum := 0.0
	for _, t := range it.txs {
		if t.TxType != "DIV" || t.Reverted == 1 {
			continue
		}
		txDate := strings.TrimSpace(t.CreatedAt)
		if len(txDate) > 10 {
			txDate = txDate[:10]
		}
		if txDate == "" || txDate <= it.effFrom || txDate > d {
			continue
		}
		sum += t.Amount
	}
	return sum
}

// rebalanceActualGet GET /api/rebalance/actual?period=last|month|quarter|year
func rebalanceActualGet(c *gin.Context) {
	uid := currentUserID(c)
	if uid <= 0 {
		c.JSON(401, gin.H{"error": "unauthorized"})
		return
	}
	now := time.Now().In(beijing)
	from, to, label, days := rbPeriodRange(uid, c.Query("period"), now)
	resp := computeRbActual(uid, from, to, label, days)
	resp.Source = strings.ToLower(strings.TrimSpace(c.Query("period")))
	if resp.Source == "" {
		resp.Source = "last"
	}
	c.JSON(200, resp)
}
