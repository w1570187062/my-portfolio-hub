package api

// ===== 复盘页 v6.1：收益率诊断（2026-10-30）=====
//
// 页面只回答两个问题：① 多少现金闲置了 ② 业绩表现如何（单一榜，按收益总额排序）。
//
// 核心量是「实测年化」（XIRR，现金流法：追加本金/赎回以现金流进出处理，不污染收益）：
//   ann  = 该标的的实测年化
//   gain = 持仓中：市值 × ann% （按当前规模一年能赚多少）
//          已平仓：Σ(卖出回款 + 分红 − 买入成本) （落袋的总收益）
//   业绩表现 = 两类合并进一个列表（state 区分），前端按状态过滤后呈现。
//
// 三处护栏（与原型一致，落地不能省）：
//   1. 持有不足 90 天的照列但标 days，由前端打「仅 N 天」灰标 ——
//      短期年化被行情放大，别当长期能力看（不再像旧版那样直接踢出榜单）。
//   2. 现金没有利息流水，实测年化按 0 估算并标 estimated；因此现金不进业绩榜，
//      单独成「闲置现金」卡，避免与业绩榜重复计算。
//   3. 年化展示上限 50%（reviewAnnCap）：短期暴涨的标的年化能到几百个百分点，
//      不截断会把展示压成失真数字。截断写进 note，不静默改数。

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

const (
	// reviewAnnCap 年化展示上限（%），超出按上限显示并记 note。
	reviewAnnCap = 50.0
)

// reviewCashflow 一笔现金流：正 = 钱回到用户口袋（卖出/分红/期末市值），负 = 投出去（买入/申购）。
type reviewCashflow struct {
	date string
	amt  float64
}

// xirrSolve 二分法求年化 IRR（返回百分数）。
// cfs 必须含正有负且末端为正（期末市值），否则无解。
//
// 用二分而不是牛顿法：牛顿法在现金流符号多次变化时极易发散（初值稍差就飞到 1e9），
// 而 f(r) = Σ cf_i/(1+r)^t_i 关于 r 单调递减，区间 [-99.99%, 1000%] 内二分必然收敛。
func xirrSolve(cfs []reviewCashflow) (float64, bool) {
	if len(cfs) < 2 {
		return 0, false
	}
	sort.SliceStable(cfs, func(i, j int) bool { return cfs[i].date < cfs[j].date })
	ts := make([]float64, len(cfs))
	span := 0
	for i, c := range cfs {
		d := daysBetweenDates(cfs[0].date, c.date)
		if d < 0 {
			d = 0
		}
		if d > span {
			span = d
		}
		ts[i] = float64(d) / 365.0
	}
	if span <= 0 {
		return 0, false // 全部现金流同一天：年化无定义（且必然被 90 天门槛挡掉）
	}
	f := func(r float64) float64 {
		s := 0.0
		for i, c := range cfs {
			s += c.amt / math.Pow(1+r, ts[i])
		}
		return s
	}
	lo, hi := -0.9999, 10.0
	flo, fhi := f(lo), f(hi)
	// 首笔为负、末笔为正时 f(lo)>0、f(hi)<0；不满足即无根（例如市值归零或全是投入）。
	if !(flo > 0 && fhi < 0) {
		return 0, false
	}
	for i := 0; i < 200; i++ {
		mid := (lo + hi) / 2
		if f(mid) > 0 {
			lo = mid
		} else {
			hi = mid
		}
	}
	return (lo + hi) / 2 * 100, true
}

// reviewItem 一只标的的诊断结果（业绩榜 / 现金明细共用）。
type reviewItem struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Name   string `json:"name"`
	Sub    string `json:"sub,omitempty"` // 子账户名（现金账户的 Type；其他标的为空）
	Symbol string `json:"symbol"`
	// State holding 持仓中 | closed 已平仓。业绩榜据此分「已平仓 / 持仓中」两个视图。
	State string `json:"state"`
	// MV 当前市值（已平仓为 0）；Invested 累计投入本金（仅已平仓有值，前端用来替代市值展示）。
	MV       float64  `json:"mv_cny"`
	Invested float64  `json:"invested_cny"`
	Ann      *float64 `json:"ann"`    // 实测年化 %；nil = 算不出来
	Target   float64  `json:"target"` // 该类目标年化 %
	// Gain 收益金额：**与持仓 / 平仓 / 理财表格同口径，可逐行对账** ——
	// 持仓中（股票基金）= (现价−成本价)×数量（表格「盈亏」列）；
	// 已平仓 = Σ position_tx.realized_pnl（平仓表「金额」列）；
	// 理财 = cum_pnl（理财表「累计收益」列，持仓与归档同字段）。
	// 不再用 市值×年化 造「年化金额」：那是假设复利一年的推演值，没法和任何表格对上，
	// 而且无年化的标的（XIRR 无解）会被迫虚构或显示「—」。
	Gain    float64 `json:"gain_cny"`
	Days    int     `json:"days"`    // 持有天数（已平仓 = 首笔→末笔流水的跨度）
	Quality string  `json:"quality"` // ok | partial | estimated | no_data
	Note    string  `json:"note"`
}

// reviewIdle 闲置现金卡片。
type reviewIdle struct {
	Amount float64      `json:"amount"`
	Weight float64      `json:"weight"`
	Target float64      `json:"target"`   // 现金目标年化 %
	Cost   float64      `json:"cost_cny"` // 按目标年化算，每年少赚多少
	N      int          `json:"n"`
	Items  []reviewItem `json:"items"`
}

type reviewTarget struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Exp   float64 `json:"exp"`
}

// reviewResp GET /api/review 的响应体。
type reviewResp struct {
	TotalCNY float64 `json:"total_cny"`
	// Ann 组合实测年化：Σ(市值 × 该标的实测年化) / 总市值。
	// 注意这是「逐标的年化的市值加权」，不是组合层面的 XIRR —— 后者需要整个组合的
	// 逐笔现金流对齐，且会被大额申赎时点主导，反而看不清「现在持有什么水平」。
	Ann float64 `json:"ann"`
	// AnnEst 组合年化里含估算成分（无流水的老标的 / 现金按 0 计）。页面必须标出来。
	AnnEst bool `json:"ann_est"`

	GoalPct *float64 `json:"goal_pct"`
	// GoalFallback true = 用户没设整体目标，用的是「按目标权重 × 各类年化」内生出来的数。
	GoalFallback bool    `json:"goal_fallback"`
	GapPP        float64 `json:"gap_pp"`  // 目标 − 实测（正 = 还差多少）
	GapAmt       float64 `json:"gap_amt"` // 组合每年差额（正 = 少赚）

	Targets []reviewTarget `json:"targets"`

	// Perf 业绩表现单一榜：持仓中 + 已平仓合并，按收益总额降序，前端按 state 过滤。
	Perf []reviewItem `json:"perf"`
	Idle reviewIdle   `json:"idle"`

	// 被排除的日常开销账户：不算闲置现金，但页面要说明，否则用户以为漏算了钱
	ExcludedN   int      `json:"excluded_n"`
	ExcludedAmt float64  `json:"excluded_amt"`
	Notes       []string `json:"notes"`
	UpdatedAt   string   `json:"updated_at"`
}

// reviewCashAnn 现金的实测年化：系统没有利息流水（cash_flow 只记余额变动，没有利息类型），
// 一律按 0 估算而不是按目标年化 —— 按目标估算会让「闲置现金每年少赚」恒为 0，卡片失去意义。
const reviewCashAnn = 0.0

func computeReview(uid int64) reviewResp {
	out := reviewResp{
		Perf:    make([]reviewItem, 0, 16),
		Notes:   make([]string, 0, 4),
		Targets: make([]reviewTarget, 0, 4),
	}
	cfg := loadRebalanceConfig(uid)
	expOf := map[string]float64{}
	for _, t := range cfg.Targets {
		expOf[t.Key] = t.Exp
		out.Targets = append(out.Targets, reviewTarget{Key: t.Key, Label: rbClassLabels[t.Key], Exp: t.Exp})
	}
	out.UpdatedAt = cfg.UpdatedAt

	cnyRate, hkdRate, _ := market.FetchFXRates()
	today := time.Now().In(beijing).Format("2006-01-02")
	items := make([]reviewItem, 0, 24)      // 持仓中
	closedItems := make([]reviewItem, 0, 8) // 已平仓
	var estN, closedSkip int

	// ---- 1) 股票 / 基金：position_tx 流水 + 期末市值（持仓中）/ 完整生命周期（已平仓）----
	hs, _ := db.List(uid)
	for _, h := range hs {
		cur := strings.ToLower(strings.TrimSpace(h.Currency))
		if cur == "rmb" {
			cur = "cny"
		}
		key := rbClassFund
		if strings.EqualFold(strings.TrimSpace(h.Category), "stock") {
			key = rbClassStock
		}
		// 现金流提取：BUY 流出、SELL/DIV 流回。分红已下调 cost_price，
		// 现金流视角它就是一笔回到口袋的钱，两处口径一致。
		cfs := make([]reviewCashflow, 0, 8)
		first, last := "", ""
		invested := 0.0
		// sellAmt / realized 仅用于「无买入流水」时反推本金：
		// 卖出回款合计 − 已实现盈亏合计 = 这批卖出的成本（含多批次建仓）。
		// realizedAll = Σ position_tx.realized_pnl（与 db.BatchSumRealizedPnl 同式），
		// 是已平仓展示金额的展示口径 —— 与平仓表「金额」列逐行一致。
		sellAmt, realized := 0.0, 0.0
		realizedAll := 0.0
		txs, _ := db.ListPositionTx(h.ID)
		for _, t := range txs {
			if t.Reverted == 1 {
				continue
			}
			realizedAll += t.RealizedPnl
			d := strings.TrimSpace(t.CreatedAt)
			if len(d) > 10 {
				d = d[:10]
			}
			if d == "" {
				continue
			}
			if first == "" || d < first {
				first = d
			}
			if last == "" || d > last {
				last = d
			}
			switch t.TxType {
			case "BUY":
				cfs = append(cfs, reviewCashflow{date: d, amt: -(t.Amount + t.Fee)})
				invested += t.Amount + t.Fee
			case "SELL":
				cfs = append(cfs, reviewCashflow{date: d, amt: t.Amount - t.Fee})
				sellAmt += t.Amount - t.Fee
				realized += t.RealizedPnl
			case "DIV":
				cfs = append(cfs, reviewCashflow{date: d, amt: t.Amount})
			}
		}
		if h.Closed {
			// 已平仓：现金流即完整生命周期，落袋收益 = Σ 现金流（无期末市值）。
			// 若还残留市值（半路标记平仓的脏数据），把残值当期末回款补上。
			nativeMV := h.Quantity * h.CurrentPrice
			if nativeMV > 0 {
				cfs = append(cfs, reviewCashflow{date: today, amt: nativeMV})
				if last == "" || today > last {
					last = today
				}
			}
			// 老数据没有 BUY 流水（买入早于流水功能上线，或直接改持仓建仓），本金得反推。
			// 两条兜底，优先用「可对账」的那条：
			//   a) 卖出回款 − 已实现盈亏 = 卖出部分的成本 —— 与平仓页「本金」同源，
			//      且多批次建仓（last_quantity 只记最后一批）也不会少算；
			//   b) 再不行用平仓备份的 last_quantity × last_cost_price。
			// 两条都必须在 buy_date 补一笔期初投入现金流，否则本金恒 0，
			// 且现金流只剩 SELL/DIV 的全流入形态 —— XIRR 无解，本金与年化一起缺。
			legacyNote := ""
			if invested <= 0 {
				switch {
				case sellAmt > 0 && math.Abs(realized) > 0.005:
					invested = sellAmt - realized
					legacyNote = "无买入流水，本金按卖出回款−已实现盈亏反推"
				case h.LastQuantity > 0 && h.LastCostPrice > 0:
					invested = h.LastQuantity * h.LastCostPrice
					legacyNote = "无买入流水，本金按平仓前成本价估算"
				}
				if invested > 0 {
					bd := strings.TrimSpace(h.BuyDate)
					if bd == "" {
						bd = first
					}
					if bd == "" {
						bd = last
					}
					if bd != "" {
						cfs = append(cfs, reviewCashflow{date: bd, amt: -invested})
						if first == "" || bd < first {
							first = bd
						}
					}
				}
			}
			if len(cfs) == 0 {
				closedSkip++ // 老数据没有流水，什么都算不出来
				continue
			}
			it := reviewItem{
				Key: key, Label: rbClassLabels[key], Name: h.Name, Symbol: h.Symbol,
				State: "closed", Target: expOf[key],
				// 本金与落袋收益都是原币金额，展示口径是人民币，必须折汇（原来漏了这一步，
				// 美元持仓的落袋 +$438 被当成 +¥438 显示）。
				// Gain 与平仓表「金额」列同源（Σ position_tx.realized_pnl），可逐行对账；
				// 现金流口径只用于 invested 反推与 XIRR，不再用来出展示金额。
				Invested: round2(fxToCNY(invested, cur, cnyRate, hkdRate)),
				Gain:     round2(fxToCNY(realizedAll, cur, cnyRate, hkdRate)),
				Quality:  "ok", Days: daysBetweenDates(first, last),
			}
			if it.Days < 0 {
				it.Days = 0
			}
			if nativeMV > 0 {
				it.MV = round2(fxToCNY(nativeMV, cur, cnyRate, hkdRate))
			}
			if ann, ok := xirrSolve(cfs); ok {
				it.Ann = &ann
			} else {
				it.Quality = "partial"
				it.Note = "现金流形态无法计算年化"
			}
			if legacyNote != "" && it.Note == "" {
				it.Quality = "partial"
				it.Note = legacyNote
			}
			closedItems = append(closedItems, it)
			continue
		}
		// 持仓中：期末补今天的市值。
		nativeMV := h.Quantity * h.CurrentPrice
		mv := fxToCNY(nativeMV, cur, cnyRate, hkdRate)
		if mv <= 0 {
			continue
		}
		it := reviewItem{
			Key: key, Label: rbClassLabels[key], Name: h.Name, Symbol: h.Symbol,
			State: "holding", MV: round2(mv), Target: expOf[key], Quality: "ok",
			Days: db.CalcHoldingDays(h.BuyDate),
			// Gain 与持仓表「盈亏」列同式：(现价 − 成本价) × 数量，可逐行对账。
			Gain: round2(fxToCNY(nativeMV-h.Quantity*h.CostPrice, cur, cnyRate, hkdRate)),
		}
		if invested <= 0 {
			// 没有 BUY 流水（买入早于流水功能上线 / 直接建仓），但有分红等其他流水的也算进来：
			// 兜底条件不能是 len(cfs)==0 —— 只剩 DIV 的现金流全是流入，XIRR 必然无解，
			// 会被误标「估算」并按目标年化虚构收益（易方达中债 +¥6,001 的根因）。
			// 用买入日 + 成本价补一笔期初投入，XIRR 就有符号变化可解了。
			// 用成本价而不是现价，否则期初投入被抬高/压低，年化会系统性失真。
			if h.BuyDate != "" && h.CostPrice > 0 {
				cfs = append(cfs, reviewCashflow{date: h.BuyDate, amt: -(h.Quantity * h.CostPrice)})
				first = h.BuyDate
				it.Quality = "partial"
				it.Note = "无买入流水，按买入日成本价估算"
			}
		}
		cfs = append(cfs, reviewCashflow{date: today, amt: nativeMV})
		if first == "" {
			it.Days = 0
		} else if d := daysBetweenDates(first, today); d > 0 {
			it.Days = d // 首笔流水早于建仓日时以流水为准（买入日可能未填或不准）
		}
		if ann, ok := xirrSolve(cfs); ok {
			it.Ann = &ann
		}
		items = append(items, it)
	}

	// ---- 2) 理财：快照序列（amount 市值 / cashflow 净申购 / dividend 分红转出）----
	// 持仓中末端补今天市值；已归档（平仓）末端用最后一条快照市值，落袋收益 = Σ 现金流。
	if wps, e := db.ListWealth(uid); e == nil {
		for _, w := range wps {
			snaps, e := db.ListWealthSnapshots(w.ID)
			if len(snaps) == 0 || e != nil {
				continue
			}
			cur := strings.ToLower(strings.TrimSpace(w.Currency))
			if cur == "rmb" {
				cur = "cny"
			}
			lastSnap := snaps[len(snaps)-1]
			// 累计收益与理财表同口径：手动编辑值优先（CumPnl 非 0），否则按快照累计
			// （复用资产页的 wealthCumPnl）。两处（持仓中/已归档）Gain 都用它，可逐行对账。
			cum := w.CumPnl
			if cum == 0 {
				cum = wealthCumPnl(w.ID)
			}
			cfs := []reviewCashflow{{date: snaps[0].Date, amt: -snaps[0].Amount}}
			invested := snaps[0].Amount
			for _, s := range snaps[1:] {
				if s.Cashflow != 0 {
					// cashflow 正 = 追加（钱进去 = 流出），负 = 赎回（钱回来 = 流入）
					cfs = append(cfs, reviewCashflow{date: s.Date, amt: -s.Cashflow})
					if s.Cashflow > 0 {
						invested += s.Cashflow
					}
				}
				if s.Dividend != 0 {
					cfs = append(cfs, reviewCashflow{date: s.Date, amt: s.Dividend})
				}
			}
			first, last := snaps[0].Date, lastSnap.Date
			if w.Archived {
				if lastSnap.Amount > 0 {
					cfs = append(cfs, reviewCashflow{date: lastSnap.Date, amt: lastSnap.Amount})
				}
				if len(cfs) < 2 {
					closedSkip++
					continue
				}
				it := reviewItem{
					Key: rbClassWealth, Label: rbClassLabels[rbClassWealth], Name: w.Name,
					State: "closed", Target: expOf[rbClassWealth],
					// 本金 / 落袋原币 → 折人民币，与股票基金同口径
					Invested: round2(fxToCNY(invested, cur, cnyRate, hkdRate)),
					// Gain 与理财表「累计收益」列同源（手动值优先 / 快照累计）
					Gain:    round2(fxToCNY(cum, cur, cnyRate, hkdRate)),
					Quality: "ok", Days: daysBetweenDates(first, last),
				}
				if it.Days < 0 {
					it.Days = 0
				}
				if lastSnap.Amount > 0 {
					it.MV = round2(fxToCNY(lastSnap.Amount, cur, cnyRate, hkdRate))
				}
				if ann, ok := xirrSolve(cfs); ok {
					it.Ann = &ann
				} else {
					it.Quality = "partial"
					it.Note = "现金流形态无法计算年化"
				}
				closedItems = append(closedItems, it)
				continue
			}
			nativeMV := lastSnap.Amount
			mv := fxToCNY(nativeMV, cur, cnyRate, hkdRate)
			if mv <= 0 {
				continue
			}
			it := reviewItem{
				Key: rbClassWealth, Label: rbClassLabels[rbClassWealth], Name: w.Name,
				State: "holding", MV: round2(mv), Target: expOf[rbClassWealth], Quality: "ok",
				Days: daysBetweenDates(snaps[0].Date, today),
				// Gain 与理财表「累计收益」列同源（手动值优先 / 快照累计），持仓中同样可对账
				Gain: round2(fxToCNY(cum, cur, cnyRate, hkdRate)),
			}
			// 期初视为一次性投入 amount0；此后 cashflow 是追加/赎回，dividend 是分红转出。
			cfs = append(cfs, reviewCashflow{date: today, amt: nativeMV})
			if ann, ok := xirrSolve(cfs); ok {
				it.Ann = &ann
			} else if len(snaps) == 1 {
				it.Quality = "no_data"
				it.Note = "只有一条快照，无法计算年化"
			}
			items = append(items, it)
		}
	}

	// ---- 3) 现金：只进「闲置现金」卡，不进业绩榜 ----
	idle := reviewIdle{Target: expOf[rbClassCash], Items: make([]reviewItem, 0, 8)}
	if cs, e := db.ListCash(uid); e == nil {
		for _, cc := range cs {
			amt := fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
			if cc.Excluded {
				if amt != 0 {
					out.ExcludedN++
					out.ExcludedAmt += amt
				}
				continue
			}
			if amt <= 0 {
				continue
			}
			ann := reviewCashAnn
			idle.Items = append(idle.Items, reviewItem{
				Key: rbClassCash, Label: rbClassLabels[rbClassCash], Name: cc.Name,
				Sub: strings.TrimSpace(cc.Type),
				MV:  round2(amt), Ann: &ann, Target: expOf[rbClassCash],
				Quality: "estimated", Note: "现金无利息流水，按 0 估算",
			})
		}
	}
	sort.SliceStable(idle.Items, func(i, j int) bool { return idle.Items[i].MV > idle.Items[j].MV })

	// ---- 4) 总市值与组合年化（只含持仓中 + 现金，已平仓不占市值）----
	total := 0.0
	for _, it := range items {
		total += it.MV
	}
	for _, c := range idle.Items {
		total += c.MV
	}
	out.TotalCNY = round2(total)

	// 组合年化：逐标的市值加权。ann 算不出来的按该类目标年化兜底并标估算，
	// 不能跳过 —— 跳过等于把它当成 0 收益，市值越大低估越多，总览就成了假数。
	// 「按目标估算」只进组合加权的分子，不碰 it.Gain：业绩榜收益额已改为
	// 与持仓/平仓/理财表格同口径的真实金额（见 reviewItem.Gain 注释），无年化也有真数。
	weighted := 0.0
	for i := range items {
		it := &items[i]
		ann := it.Target
		if it.Ann != nil {
			ann = *it.Ann
		} else {
			estN++
			it.Quality = "estimated"
			if it.Note == "" {
				it.Note = "无法计算年化，按该类目标估算"
			}
		}
		weighted += it.MV * ann / 100
	}
	// 现金按 0 计入分子（不虚构利息），因此组合年化会被现金略微拉低 —— 这是保守方向，可接受。
	if total > 0 {
		out.Ann = round2(weighted / total * 100)
	}
	out.AnnEst = estN > 0 || len(idle.Items) > 0

	// 闲置现金卡：金额 / 占比 / 按目标年化每年少赚多少
	idleAmt := 0.0
	for _, c := range idle.Items {
		idleAmt += c.MV
	}
	idle.Amount = round2(idleAmt)
	idle.N = len(idle.Items)
	if total > 0 {
		idle.Weight = round2(idleAmt / total * 100)
	}
	idle.Cost = round2(idleAmt * (idle.Target - reviewCashAnn) / 100)
	out.Idle = idle
	out.ExcludedAmt = round2(out.ExcludedAmt)

	// ---- 5) 业绩表现单一榜：持仓中 + 已平仓合并，按收益总额降序 ----
	perf := make([]reviewItem, 0, len(items)+len(closedItems))
	perf = append(perf, items...)
	perf = append(perf, closedItems...)
	for i := range perf {
		it := &perf[i]
		// 年化展示截断：只影响展示值，Gain 仍按真值算
		if it.Ann != nil && *it.Ann > reviewAnnCap {
			v := reviewAnnCap
			it.Ann = &v
			if it.Note == "" {
				it.Note = "年化超 " + trimFloat(reviewAnnCap) + "%，展示按上限截断"
			}
		}
	}
	sort.SliceStable(perf, func(i, j int) bool { return perf[i].Gain > perf[j].Gain })
	out.Perf = perf

	// ---- 6) 目标与缺口 ----
	goal := 0.0
	if cfg.GoalPct != nil {
		goal = *cfg.GoalPct
	} else {
		out.GoalFallback = true
		for _, t := range cfg.Targets {
			goal += t.Pct / 100 * t.Exp
		}
	}
	g := goal
	out.GoalPct = &g
	out.GapPP = round2(goal - out.Ann)
	out.GapAmt = round2(total * (goal - out.Ann) / 100)

	// ---- 7) 数据缺口提示（页面直接用，不自造文案）----
	if estN > 0 {
		out.Notes = append(out.Notes, "有 "+strconv.Itoa(estN)+" 只持仓标的缺少可计算的现金流（无交易流水/快照不足），年化按该类目标估算，组合年化可能偏高。")
	}
	if len(idle.Items) > 0 {
		out.Notes = append(out.Notes, "现金没有利息流水，实测年化按 0 估算：组合年化被略微拉低，闲置现金的「每年少赚」是相对目标年化算的。")
	}
	if out.ExcludedN > 0 {
		out.Notes = append(out.Notes, "已排除 "+strconv.Itoa(out.ExcludedN)+" 个日常开销账户（不计入闲置现金）。")
	}
	noData := closedSkip
	for _, it := range items {
		if it.Quality == "no_data" {
			noData++
		}
	}
	if noData > 0 {
		out.Notes = append(out.Notes, "有 "+strconv.Itoa(noData)+" 只标的数据不足，无法给出年化，不进业绩榜。")
	}
	return out
}

// reviewGet GET /api/review
func reviewGet(c *gin.Context) {
	c.JSON(200, computeReview(currentUserID(c)))
}
