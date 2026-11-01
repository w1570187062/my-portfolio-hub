package api

// 止盈止损引擎（收盘价 + 技术指标，不含基本面）
//
// 设计要点：
//  1. 价位只由三样东西决定：成本、波动（ATR）、结构（MA60 / 近 20 日低点 / 近 60-120 日高点）。
//     不取整数关口当止损（那是心理位，不是风控位）。
//  2. 基金没有 high/low，ATR 走收盘价近似（见 market.ATRFromCloses）；
//     净值历史接口一次只给 120 天，故「持仓期最高」用 max(120 日高, 成本后高点) 兜底。
//  3. 赎回费是「卖出决策的隐性成本」：止损触发但扣费后仍是亏的，说明是杀在费率上，
//     降级成费率观察提醒而不是硬止损。158 天的 C 类早已是 0 费率，逻辑对老持仓无副作用。
//  4. 通知按 dedupe_key 永久去重（一个持仓的某一档只提醒一次），repeat 才按天重复，
//     避免「同一根 K 线刷十条消息」。

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// ---- 模型 ----

// FeeTier 赎回费率阶梯：持有满 Days 天，费率降为 Rate（%）。按 Days 升序。
type FeeTier struct {
	Days int     `json:"days"`
	Rate float64 `json:"rate"`
}

// RiskPlan 持仓级止盈止损方案，整块存 holdings.risk_plan。
type RiskPlan struct {
	Mode         string    `json:"mode"`   // auto（按预设算） | manual（手填价） | off（不止盈不止损）
	Preset       string    `json:"preset"` // steady | balanced | aggressive
	StopPrice    float64   `json:"stop_price"`
	TP1          float64   `json:"tp1"`
	TP2          float64   `json:"tp2"`
	TP3          float64   `json:"tp3"`
	TrailingPct  float64   `json:"trailing_pct"`   // 移动止盈：自持仓期高点回撤 % 触发
	BreakEvenPct float64   `json:"break_even_pct"` // 浮盈达到该值后止损抬到成本之上（保本）
	PsychPrice   float64   `json:"psych_price"`    // 心理价位：只提醒，不参与止损
	PsychNote    string    `json:"psych_note"`
	FeeClass     string    `json:"fee_class"` // C | A | custom（仅展示用）
	FeeTiers     []FeeTier `json:"fee_tiers"`
	// FeeOverride 实际赎回费率（%），>0 时直接覆盖阶梯查询结果。
	// 各基金公司的 C 类规则并不统一（有的 7 天后 0，有的 7-30 天仍收 0.5%），
	// 阶梯模板只能给典型值，用户查到自家产品的真实费率填这里即可。
	FeeOverride float64 `json:"fee_override"`
	Repeat       string    `json:"repeat"` // once（默认，永久一次） | repeat（每日一次）
	CooldownMin  int       `json:"cooldown_min"`
	MaxPerDay    int       `json:"max_per_day"`
	// BaselineAt 首次启用方案的时间。首次扫描只落库、不往钉钉/邮件推 ——
	// 否则用户点一次「全部启用」，历史旧账会按当前价一次性推到手机（实测 7 只持仓 11 条）。
	// 落库仍照做：铃铛里能看到「启用时这批持仓已经处于什么状态」，信息不丢、只是不打扰。
	BaselineAt string `json:"baseline_at"`
}

// RiskBasis 定价基准（技术面快照）：前端据此实时预览价位，避免每改一个数字打一次接口。
type RiskBasis struct {
	Cost        float64 `json:"cost"`
	Price       float64 `json:"price"`
	ATR         float64 `json:"atr"`
	ATRPct      float64 `json:"atr_pct"`
	MA5         float64 `json:"ma5"`
	MA10        float64 `json:"ma10"`
	MA20        float64 `json:"ma20"`
	MA60        float64 `json:"ma60"`
	RSI         float64 `json:"rsi"`
	BollUpper   float64 `json:"boll_upper"`
	BollMid     float64 `json:"boll_mid"`
	BollLower   float64 `json:"boll_lower"`
	High20      float64 `json:"high20"`
	High60      float64 `json:"high60"`
	High120     float64 `json:"high120"`
	Low20       float64 `json:"low20"`
	Peak        float64 `json:"peak"` // 持仓期最高收盘
	HoldingDays int     `json:"holding_days"`
	IsFund      bool    `json:"is_fund"` // 是否有赎回费概念（场外基金）；股票/场内为 false
	FeePct      float64 `json:"fee_pct"`
	NextTierDay int     `json:"next_tier_days"` // 距下一档降费还有几天（0 = 已最低档）
	NextTierPct float64 `json:"next_tier_rate"`
	Bars        int     `json:"bars"`
	Source      string  `json:"source"` // nav | kline
}

// RiskEval 引擎算出的实际价位 + 距离，供列表与弹框只读展示。
type RiskEval struct {
	StopPrice    float64 `json:"stop_price"`
	StopReason   string  `json:"stop_reason"`
	TP1          float64 `json:"tp1"`
	TP2          float64 `json:"tp2"`
	TP3          float64 `json:"tp3"`
	TrailingLine float64 `json:"trailing_line"`
	TrailingOn   bool    `json:"trailing_on"` // 回撤线是否有效（涨幅不足以支撑回撤止盈时为 false）
	ToStopPct    float64 `json:"to_stop_pct"`
	ToTP1Pct     float64 `json:"to_tp1_pct"`
	PnlPct       float64 `json:"pnl_pct"`
	Note         string  `json:"note"`
}

type presetParams struct {
	MaxLossPct   float64
	ATRK         float64
	TP1K, TP2K, TP3K float64
	TrailPct     float64
	BreakEvenPct float64
}

var riskPresets = map[string]presetParams{
	"steady":     {MaxLossPct: 8, ATRK: 1.5, TP1K: 1.2, TP2K: 2.0, TP3K: 3.0, TrailPct: 6, BreakEvenPct: 10},
	"balanced":   {MaxLossPct: 12, ATRK: 2.0, TP1K: 1.5, TP2K: 2.5, TP3K: 4.0, TrailPct: 8, BreakEvenPct: 15},
	"aggressive": {MaxLossPct: 18, ATRK: 2.5, TP1K: 2.0, TP2K: 3.5, TP3K: 5.5, TrailPct: 12, BreakEvenPct: 20},
}

var defaultCTiers = []FeeTier{{Days: 0, Rate: 1.5}, {Days: 7, Rate: 0}}

// noFeeTiers 表示「无赎回费」（股票 / 场内 ETF / 已付申购费的 A 类）。
// 必须是一档 0 费率而不是空数组：空数组会被 effectiveTiers 兜底成 C 类 1.5%。
var noFeeTiers = []FeeTier{{Days: 0, Rate: 0}}

// ---- 基准计算 ----

// riskSeries 取技术分析序列与 ATR。基金走净值历史（只有收盘，ATR 用收盘近似），
// 股票/ETF 走日线（有 high/low，ATR 用真实波幅，比收盘近似更贴近实际日内波动）。
func riskSeries(h db.Holding) (closes []float64, dates []string, atr float64, src string, err error) {
	if h.Category == "fund" && h.Market != "港股" {
		m, e := market.FetchFundNAVHistory(h.Symbol, 120)
		if e != nil {
			return nil, nil, 0, "", e
		}
		ds := make([]string, 0, len(m))
		for d := range m {
			ds = append(ds, d)
		}
		sort.Strings(ds)
		for _, d := range ds {
			dates = append(dates, d)
			closes = append(closes, m[d])
		}
		if len(closes) < 6 {
			return nil, nil, 0, "", fmt.Errorf("净值样本不足")
		}
		return closes, dates, market.ATRFromCloses(closes, 14), "nav", nil
	}
	// 股票/ETF：持仓里存的 symbol 可能是不带市场前缀的裸代码，必须走 resolveSymbol
	// （与 getAnalysis 同一入口），否则 fetchAShareKline 会直接报 invalid symbol。
	bars, e := market.FetchKline(resolveSymbol(h.Symbol, h.Market))
	if e != nil {
		return nil, nil, 0, "", e
	}
	for _, b := range bars {
		dates = append(dates, b.Date)
		closes = append(closes, b.Close)
	}
	if len(closes) < 6 {
		return nil, nil, 0, "", fmt.Errorf("K线样本不足")
	}
	return closes, dates, market.ATRFromBars(bars, 14), "kline", nil
}

// buildBasis 汇总技术面基准（含费率与持仓天数）。
func buildBasis(h db.Holding, plan *RiskPlan) (RiskBasis, error) {
	b := RiskBasis{Cost: h.CostPrice, Price: h.CurrentPrice, HoldingDays: db.CalcHoldingDays(h.BuyDate), IsFund: isFundHolding(h)}
	closes, dates, atr, src, err := riskSeries(h)
	if err != nil {
		return b, err
	}
	b.Source = src
	b.Bars = len(closes)
	if b.Price <= 0 {
		b.Price = closes[len(closes)-1]
	}
	b.ATR = atr
	if b.ATR <= 0 {
		b.ATR = b.Price * 0.01 // 兜底：1% 日波动
	}
	if b.Price > 0 {
		b.ATRPct = b.ATR / b.Price * 100
	}
	b.MA5 = smaTail(closes, 5)
	b.MA10 = smaTail(closes, 10)
	b.MA20 = smaTail(closes, 20)
	b.MA60 = smaTail(closes, 60)
	b.RSI = rsiTail(closes, 14)
	b.High20 = market.HighestClose(closes, 20)
	b.High60 = market.HighestClose(closes, 60)
	b.High120 = market.HighestClose(closes, 120)
	b.Low20 = market.LowestClose(closes, 20)
	b.BollMid, b.BollUpper, b.BollLower = bollTail(closes, 20, 2)
	b.Peak = b.High120
	// 持仓期最高收盘：买入日之后的最高价才有意义（买入前的涨幅与我的成本无关）
	if h.BuyDate != "" {
		best := 0.0
		for i, d := range dates {
			if d >= h.BuyDate && closes[i] > best {
				best = closes[i]
			}
		}
		if best > 0 {
			b.Peak = best
		}
	}
	b.FeePct, b.NextTierDay, b.NextTierPct = effectiveFee(plan, b.HoldingDays, isFundHolding(h))
	return b, nil
}

// isFundHolding 是否有赎回费概念：只有场外基金（含 ETF 联接）才按持有时间递减，
// 股票 / 场内 ETF / 美股都是卖出即成交，不存在赎回费。
func isFundHolding(h db.Holding) bool {
	if h.Category == "fund" {
		return true
	}
	return strings.TrimSpace(h.LinkedSymbol) != ""
}

// effectiveFee 优先用用户填报的实际费率（FeeOverride），否则查阶梯。
// 非基金一律 0：plan 里可能残留着早年套用的 C 类阶梯，若照此计算，
// 股票的提醒正文会出现「赎回费率 1.50%」这种不存在的信息。
func effectiveFee(plan *RiskPlan, days int, isFund bool) (rate float64, nextDays int, nextRate float64) {
	if !isFund {
		return 0, 0, 0
	}
	if plan != nil && plan.FeeOverride > 0 {
		return plan.FeeOverride, 0, plan.FeeOverride
	}
	return feeForDays(effectiveTiers(plan), days)
}

func effectiveTiers(plan *RiskPlan) []FeeTier {
	if plan != nil && len(plan.FeeTiers) > 0 {
		return plan.FeeTiers
	}
	return defaultCTiers
}

// feeForDays 返回当前费率、距下一档降费的天数与该档费率。
// 注意 tiers 必须升序（0/7/30/365…），否则按天数插入排序。
func feeForDays(tiers []FeeTier, days int) (rate float64, nextDays int, nextRate float64) {
	if len(tiers) == 0 {
		return 0, 0, 0
	}
	ts := append([]FeeTier(nil), tiers...)
	sort.Slice(ts, func(i, j int) bool { return ts[i].Days < ts[j].Days })
	rate = ts[0].Rate
	for i, t := range ts {
		if days >= t.Days {
			rate = t.Rate
			if i+1 < len(ts) {
				nextDays, nextRate = ts[i+1].Days-days, ts[i+1].Rate
			} else {
				nextDays, nextRate = 0, t.Rate
			}
		}
	}
	if days < ts[0].Days {
		nextDays, nextRate = ts[0].Days-days, ts[0].Rate
	}
	return rate, nextDays, nextRate
}

func smaTail(v []float64, n int) float64 {
	if len(v) == 0 || n <= 0 {
		return 0
	}
	start := len(v) - n
	if start < 0 {
		start = 0
	}
	s := 0.0
	for _, x := range v[start:] {
		s += x
	}
	return s / float64(len(v)-start)
}

func rsiTail(closes []float64, period int) float64 {
	if len(closes) < period+1 {
		return 50
	}
	gain, loss := 0.0, 0.0
	for i := len(closes) - period; i < len(closes); i++ {
		d := closes[i] - closes[i-1]
		if d >= 0 {
			gain += d
		} else {
			loss -= d
		}
	}
	if loss == 0 {
		return 100
	}
	rs := (gain / float64(period)) / (loss / float64(period))
	return 100 - 100/(1+rs)
}

func bollTail(closes []float64, period int, mult float64) (mid, upper, lower float64) {
	if len(closes) < period {
		return 0, 0, 0
	}
	seg := closes[len(closes)-period:]
	mid = smaTail(seg, period)
	var sd float64
	for _, v := range seg {
		sd += (v - mid) * (v - mid)
	}
	sd = math.Sqrt(sd / float64(period))
	return mid, mid + mult*sd, mid - mult*sd
}

// ---- 价位计算 ----

func (p presetParams) withPlan(plan *RiskPlan) presetParams {
	if plan.TrailingPct > 0 {
		p.TrailPct = plan.TrailingPct
	}
	if plan.BreakEvenPct > 0 {
		p.BreakEvenPct = plan.BreakEvenPct
	}
	return p
}

// computeEval 产出止损/三档止盈/移动止盈线。manual 模式下用户填的值优先，
// auto 模式下全部由基准推导；两者都受「单调递增 + 最小间距」约束，防止出现倒挂价位。
func computeEval(h db.Holding, plan *RiskPlan, b RiskBasis) RiskEval {
	ev := RiskEval{}
	cost := b.Cost
	if cost <= 0 || b.Price <= 0 {
		return ev
	}
	preset := plan.Preset
	if preset == "" {
		preset = "balanced"
	}
	pp, ok := riskPresets[preset]
	if !ok {
		pp = riskPresets["balanced"]
	}
	pp = pp.withPlan(plan)

	// 止损：ATR 锚与结构锚取「更宽」（更低）者 —— 止损太紧会被日常波动扫掉，
	// 再用最大容忍亏损兜底（不能为了不被扫而无限亏）。
	atrStop := cost - pp.ATRK*b.ATR
	structStop := 0.0
	if b.MA60 > 0 && b.Low20 > 0 {
		structStop = math.Min(b.MA60, b.Low20) * 0.99
	} else if b.Low20 > 0 {
		structStop = b.Low20 * 0.99
	} else if b.MA60 > 0 {
		structStop = b.MA60 * 0.99
	}
	stop := atrStop
	if structStop > 0 && structStop < stop {
		stop = structStop
	}
	costFloor := cost * (1 - pp.MaxLossPct/100)
	if stop < costFloor {
		stop = costFloor
	}
	if stop > cost*0.995 {
		stop = cost * 0.995
	}
	// 已浮盈到保本阈值：止损抬到成本 +0.1%（保本出局，不再让盈回吐）
	pnlPct := (b.Price - cost) / cost * 100
	if pnlPct >= pp.BreakEvenPct {
		if be := cost * 1.001; be > stop {
			stop = be
			ev.StopReason = "保本止损（浮盈已过阈值）"
		}
	}
	if ev.StopReason == "" {
		switch {
		case stop == costFloor:
			ev.StopReason = fmt.Sprintf("成本止损（最大容忍 %.0f%%）", pp.MaxLossPct)
		case structStop > 0 && structStop <= atrStop:
			ev.StopReason = "结构止损（MA60 / 近 20 日低点）"
		default:
			ev.StopReason = fmt.Sprintf("%.1f×ATR 波动止损", pp.ATRK)
		}
	}

	atrPct := b.ATRPct
	if atrPct <= 0 {
		atrPct = 1
	}
	// 第一档 = min(BOLL 上轨, 成本 + 1.5×ATR%)，但绝不低于成本 +2%：
	// 布林上轨在下跌通道里会跑到成本下方，若直接取 min 会把「止盈价」定成亏损价。
	tp1 := cost * (1 + pp.TP1K*atrPct/100)
	if b.BollUpper > cost && b.BollUpper < tp1 {
		tp1 = b.BollUpper
	}
	if tp1 < cost*1.02 {
		tp1 = cost * 1.02
	}
	tp2 := cost * (1 + pp.TP2K*atrPct/100)
	if b.High60 > cost {
		tp2 = math.Max(tp2, b.High60*1.02)
	}
	tp3 := cost * (1 + pp.TP3K*atrPct/100)
	if b.High120 > cost {
		tp3 = math.Max(tp3, b.High120*1.05)
	}
	// 心理价位若在 TP2 之上，直接顶替 TP3：用户自己的预期优先于机械公式
	if plan.PsychPrice > 0 && plan.PsychPrice > tp2 {
		tp3 = plan.PsychPrice
	}
	// 单调 + 最小间距（3% / 5%），避免三档挤在一起等于一次性清仓
	tp2 = math.Max(tp2, tp1*1.03)
	tp3 = math.Max(tp3, tp2*1.05)

	if plan.Mode == "manual" {
		if plan.StopPrice > 0 {
			ev.StopPrice = plan.StopPrice
			ev.StopReason = "手动止损价"
		}
		if plan.TP1 > 0 {
			tp1 = plan.TP1
		}
		if plan.TP2 > 0 {
			tp2 = plan.TP2
		}
		if plan.TP3 > 0 {
			tp3 = plan.TP3
		}
	}
	if ev.StopPrice <= 0 {
		ev.StopPrice = stop
	}
	ev.TP1, ev.TP2, ev.TP3 = tp1, tp2, tp3
	// 移动止盈线：自持仓期高点回撤 TrailingPct。
	// 只有当回撤线仍站在成本之上时它才是「止盈」——把线夹到成本的做法会让
	// 跌破成本的持仓也命中 trailing，于是一只亏损 8% 的票会推送「移动止盈，建议落袋」。
	// 涨幅不足以支撑回撤止盈时标记失效，这一段回撤交给止损线保护。
	ev.TrailingLine = b.Peak * (1 - pp.TrailPct/100)
	ev.TrailingOn = b.Peak > cost*1.02 && ev.TrailingLine > cost*1.005
	if b.Price > 0 {
		ev.ToStopPct = (ev.StopPrice - b.Price) / b.Price * 100
		ev.ToTP1Pct = (ev.TP1 - b.Price) / b.Price * 100
	}
	ev.PnlPct = pnlPct
	// 已经涨到三档之上：机械止盈档全在脚下，此时真正起作用的保护是移动止盈线，
	// 必须在 UI 上说清楚，否则用户看到「止盈 1 = 成本 +2%」会以为算错了。
	if b.Price >= tp3 && tp3 > 0 {
		if ev.TrailingOn {
			ev.Note = "现价已高于第 3 档止盈，浮盈改由移动止盈线保护"
		} else {
			ev.Note = "现价已高于第 3 档止盈"
		}
	}
	if b.Bars < 30 {
		if ev.Note != "" {
			ev.Note += "；"
		}
		ev.Note += "历史样本不足 30 日，价位参考性下降"
	}
	return ev
}

// ---- 触发判定 ----

type alertHit struct {
	Kind     string
	Level    int
	Price    float64
	Target   float64
	PnlPct   float64
	FeePct   float64
	NetAmount float64
	Title    string
	Body     string
}

// evaluateHolding 把「当前价 vs 各价位」翻译成待推送条目。
// 止盈只推「最靠上的已越过档」：一只浮盈 40% 的老持仓不会一次蹦出三条。
func evaluateHolding(h db.Holding, plan *RiskPlan, b RiskBasis, ev RiskEval) []alertHit {
	var hits []alertHit
	price := b.Price
	if price <= 0 || b.Cost <= 0 {
		return nil
	}
	fee := b.FeePct
	netAmt := h.Quantity * price * (1 - fee/100)
	// 金额一律不带 +/-（那是涨跌的语义），只保留币种符号与千分位
	netText := curSymbol(h.Currency) + fmt.Sprintf("%.2f", netAmt)
	pnl := (price - b.Cost) / b.Cost * 100
	netPnlPct := ((price*(1-fee/100) - b.Cost) / b.Cost) * 100
	// 股票 / 场内 ETF 没有赎回费：正文里不能出现「赎回费率」，那是假信息。
	// 费率为 0 也不写 —— 「赎回费率 0.00%」是纯噪音，读者只会去找那个不存在的成本。
	isFund := isFundHolding(h)
	feeText := ""
	if isFund && fee > 0 {
		feeText = fmt.Sprintf("赎回费率 %.2f%%，", fee)
	}
	mk := func(kind string, level int, target float64) alertHit {
		return alertHit{Kind: kind, Level: level, Price: price, Target: target, PnlPct: pnl,
			FeePct: fee, NetAmount: netAmt}
	}

	// 1) 止损：扣费后仍亏才叫止损；否则只改文案（降级为费率观察），
	//    kind 仍用 stop_loss —— 若改成 fee_window，会和真正的「费率即将下调」抢同一个去重键。
	if ev.StopPrice > 0 && price <= ev.StopPrice {
		hit := mk("stop_loss", 1, ev.StopPrice)
		if fee >= 0.5 && netPnlPct < 0 {
			hit.Title = fmt.Sprintf("止损被赎回费拖累：%s", h.Name)
			hit.Body = fmt.Sprintf("现价 %.4f 已跌破止损线 %.4f，但当前赎回费率 %.2f%%，扣费后仍是 %.2f%%。建议再持有 %d 天等费率降至 %.2f%% 再决定。",
				price, ev.StopPrice, fee, netPnlPct, b.NextTierDay, b.NextTierPct)
		} else {
			hit.Title = fmt.Sprintf("止损触发：%s", h.Name)
			hit.Body = fmt.Sprintf("现价 %.4f 跌破止损线 %.4f，%s。相对成本 %.4f 跌 %.2f%%，%s当前市值约 %s。",
				price, ev.StopPrice, ev.StopReason, b.Cost, math.Abs(pnl), feeText, netText)
		}
		hits = append(hits, hit)
	}

	// 2) 止盈：从高到低找第一个已越过的档
	tps := []float64{ev.TP1, ev.TP2, ev.TP3}
	for i := len(tps) - 1; i >= 0; i-- {
		if tps[i] > 0 && price >= tps[i] {
			portions := []string{"1/3", "1/3", "尾仓"}
			hit := mk("take_profit", i+1, tps[i])
			hit.Title = fmt.Sprintf("第 %d 档止盈：%s", i+1, h.Name)
			hit.Body = fmt.Sprintf("现价 %.4f 触及第 %d 档止盈线 %.4f。成本 %.4f，相对成本 %+.2f%%，%s建议减仓 %s（当前市值约 %s）。",
				price, i+1, tps[i], b.Cost, pnl, feeText, portions[i], netText)
			hits = append(hits, hit)
			break
		}
	}

	// 3) 移动止盈：还必须仍站在成本之上 —— 跌破成本的「回撤」是亏损失控，
	//    该由止损处理；把亏损持仓写成「落袋」是最容易误导人的一类提醒。
	if ev.TrailingOn && price <= ev.TrailingLine && price > b.Cost && price > ev.StopPrice {
		hit := mk("trailing", 1, ev.TrailingLine)
		hit.Title = fmt.Sprintf("移动止盈：%s", h.Name)
		hit.Body = fmt.Sprintf("自持仓期高点 %.4f 回撤至 %.4f，已跌破移动止盈线 %.4f。相对成本 %+.2f%%，建议清尾仓落袋。",
			b.Peak, price, ev.TrailingLine, pnl)
		hits = append(hits, hit)
	}

	// 4) 心理价位：只提醒，不做风控
	if plan.PsychPrice > 0 && price >= plan.PsychPrice {
		hit := mk("psych", 1, plan.PsychPrice)
		hit.Title = fmt.Sprintf("到达心理价位：%s", h.Name)
		note := plan.PsychNote
		if note == "" {
			note = "由你设定的目标价"
		}
		hit.Body = fmt.Sprintf("现价 %.4f 触及心理价位 %.4f（%s）。相对成本 %+.2f%%，是否减仓由你判断。", price, plan.PsychPrice, note, pnl)
		hits = append(hits, hit)
	}

	// 5) 费率窗：距下一档降费 ≤3 天，提前提醒（老持仓已 0 费率时不出现）
	if fee > 0 && b.NextTierDay > 0 && b.NextTierDay <= 3 {
		hit := mk("fee_window", 1, 0)
		hit.Title = fmt.Sprintf("费率即将下调：%s", h.Name)
		hit.Body = fmt.Sprintf("持有 %d 天，当前赎回费率 %.2f%%；再持有 %d 天降至 %.2f%%。若无紧急减仓需求，建议跨过该时点。",
			b.HoldingDays, fee, b.NextTierDay, b.NextTierPct)
		hits = append(hits, hit)
	}
	return hits
}

// ---- 扫描与落库 ----

type basisCacheEntry struct {
	basis RiskBasis
	at    time.Time
}

var (
	basisCacheMu sync.Mutex
	basisCache   = map[string]basisCacheEntry{}
)

func basisCacheTTL(h db.Holding) time.Duration {
	if h.Category == "fund" {
		return 2 * time.Hour // 基金净值一天一变
	}
	return 10 * time.Minute
}

func cachedBasis(h db.Holding, plan *RiskPlan) (RiskBasis, error) {
	key := fmt.Sprintf("%d:%s", h.ID, h.Symbol)
	basisCacheMu.Lock()
	e, ok := basisCache[key]
	basisCacheMu.Unlock()
	if ok && time.Since(e.at) < basisCacheTTL(h) {
		b := e.basis
		// 价格与费率随实时行情/持仓天数变，缓存只缓存技术面部分
		b.Price = h.CurrentPrice
		b.Cost = h.CostPrice
		b.HoldingDays = db.CalcHoldingDays(h.BuyDate)
		b.IsFund = isFundHolding(h)
		b.FeePct, b.NextTierDay, b.NextTierPct = effectiveFee(plan, b.HoldingDays, isFundHolding(h))
		return b, nil
	}
	b, err := buildBasis(h, plan)
	if err != nil {
		return b, err
	}
	basisCacheMu.Lock()
	basisCache[key] = basisCacheEntry{basis: b, at: time.Now()}
	basisCacheMu.Unlock()
	return b, nil
}

// ScanAlerts 评估一个账本下所有持仓。dryRun 只算不落库不推送（用于联调与验证）。
func ScanAlerts(uid int64, dryRun bool) ([]gin.H, error) {
	// 无账本上下文时不能扫：db.List(0) 返回的是「全部账本」，会把 A 账本的持仓
	// 以 user_id=0 落进提醒表，既串账又查不出来（AUTH_MODE=off 且未带 header 时会出现）。
	if uid <= 0 {
		return nil, fmt.Errorf("缺少账本上下文")
	}
	hs, err := db.List(uid)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	day := now.Format("2006-01-02")
	out := []gin.H{}
	sentToday := map[int64]int{}
	for _, h := range hs {
		if h.Closed || h.RiskPlan == "" || h.Category == "cash" {
			continue
		}
		var plan RiskPlan
		if e := json.Unmarshal([]byte(h.RiskPlan), &plan); e != nil {
			continue
		}
		if plan.Mode == "" || plan.Mode == "off" {
			continue
		}
		b, e := cachedBasis(h, &plan)
		if e != nil {
			log.Printf("[alert] %s 基准计算失败: %v", h.Symbol, e)
			continue
		}
		ev := computeEval(h, &plan, b)
		hits := evaluateHolding(h, &plan, b, ev)
		// 首次启用：本轮只落库、不推外部渠道（见 RiskPlan.BaselineAt 注释）
		firstRun := plan.BaselineAt == ""
		for _, hit := range hits {
			dedupe := fmt.Sprintf("%d:%s:%d", h.ID, hit.Kind, hit.Level)
			if plan.Repeat == "repeat" {
				dedupe += ":" + day
			}
			row := gin.H{
				"holding_id": h.ID, "name": h.Name, "symbol": h.Symbol, "kind": hit.Kind,
				"level": hit.Level, "price": roundF(hit.Price, 4), "target": roundF(hit.Target, 4),
				"pnl_pct": roundF(hit.PnlPct, 2), "fee_pct": roundF(hit.FeePct, 3),
				"net_amount": roundF(hit.NetAmount, 2), "title": hit.Title, "body": hit.Body,
			}
			if dryRun {
				out = append(out, row)
				continue
			}
			// 冷却：同持仓同类型在冷却窗口内不再提醒
			if plan.CooldownMin > 0 {
				if last := db.LastAlertAt(uid, h.ID, hit.Kind); !last.IsZero() && now.Sub(last) < time.Duration(plan.CooldownMin)*time.Minute {
					row["skipped"] = "cooldown"
					out = append(out, row)
					continue
				}
			}
			// 每日条数总闸
			maxPerDay := plan.MaxPerDay
			if maxPerDay <= 0 {
				maxPerDay = 3
			}
			if sentToday[h.ID] >= maxPerDay {
				row["skipped"] = "daily_limit"
				out = append(out, row)
				continue
			}
			ae := &db.AlertEvent{
				UserID: uid, HoldingID: h.ID, Symbol: h.Symbol, Name: h.Name,
				Kind: hit.Kind, Level: hit.Level, Price: hit.Price, Target: hit.Target,
				Cost: b.Cost, PnlPct: hit.PnlPct, FeePct: hit.FeePct, NetAmount: hit.NetAmount,
				Title: hit.Title, Body: hit.Body, DedupeKey: dedupe, CreatedAt: now.Format("2006-01-02 15:04:05"),
			}
			inserted, ierr := db.InsertAlert(ae)
			row["inserted"] = inserted
			if ierr != nil {
				row["error"] = ierr.Error()
				out = append(out, row)
				continue
			}
			if inserted {
				sentToday[h.ID]++
				if firstRun {
					// 基线轮：标记为 baseline，站内可见但不外推
					_ = db.SetAlertPushState(ae.ID, "baseline")
				} else {
					pushAlertToChannels(ae)
				}
			} else {
				row["skipped"] = "duplicated"
			}
			out = append(out, row)
		}
		// 基线时间只需写一次，之后所有轮次都按「新变化才推」处理
		if firstRun && !dryRun {
			plan.BaselineAt = now.Format("2006-01-02 15:04:05")
			if raw, e := json.Marshal(plan); e == nil {
				_ = db.UpdateRiskPlan(h.ID, string(raw))
			}
		}
	}
	return out, nil
}

func roundF(v float64, dec int) float64 {
	p := math.Pow(10, float64(dec))
	return math.Round(v*p) / p
}

// pushAlertToChannels 独立渠道推送：止盈止损消息不走净值推送的频率策略，
// 用自己的 alerts 开关（inbox 常开，钉钉/邮件可选），避免被「仅收盘后」策略吞掉。
func pushAlertToChannels(a *db.AlertEvent) {
	go func() {
		cfg, err := loadNotifyConfig()
		if err != nil {
			log.Printf("[alert] 读取通知配置失败: %v", err)
			return
		}
		wantDing := cfg.Alerts != nil && cfg.Alerts.Dingtalk && cfg.Dingtalk.Enabled && cfg.Dingtalk.Webhook != ""
		wantMail := cfg.Alerts != nil && cfg.Alerts.Email && cfg.Email.Enabled
		if !wantDing && !wantMail {
			_ = db.SetAlertPushState(a.ID, "none")
			return
		}
		title := a.Title
		md := fmt.Sprintf("## %s\n\n%s\n\n> 持仓侠 · 止盈止损提醒", title, a.Body)
		if wantDing {
			if e := sendDingtalk(cfg.Dingtalk, title, md); e != nil {
				log.Printf("[alert] 钉钉推送失败: %v", e)
				_ = db.SetAlertPushState(a.ID, "failed")
			} else {
				_ = db.SetAlertPushState(a.ID, "sent")
			}
		}
		if wantMail {
			if e := sendEmail(cfg.Email, title, stripMarkdown(md)); e != nil {
				log.Printf("[alert] 邮件推送失败: %v", e)
			}
		}
	}()
}

// scanAlertsAllUsers 定时任务：逐账本扫描。
func scanAlertsAllUsers(label string) {
	users, err := db.ListUsers()
	if err != nil {
		log.Printf("[alert] %s 读取账本失败: %v", label, err)
		return
	}
	for _, u := range users {
		rows, e := ScanAlerts(u.ID, false)
		if e != nil {
			log.Printf("[alert] %s uid=%d 扫描失败: %v", label, u.ID, e)
			continue
		}
		if len(rows) > 0 {
			log.Printf("[alert] %s uid=%d 命中 %d 条", label, u.ID, len(rows))
		}
	}
}

// ScheduleAlertScan 三个时点各扫一次，全部落在「收盘价确定之后」：
// 15:20 A股/ETF 收盘、21:10 基金净值公布、07:10 美股收盘。
func ScheduleAlertScan() {
	scheduleAt(15, 20, "A股收盘提醒", func(string) { scanAlertsAllUsers("A股收盘") })
	scheduleAt(21, 10, "基金净值提醒", func(string) { scanAlertsAllUsers("基金净值") })
	scheduleAt(7, 10, "美股收盘提醒", func(string) { scanAlertsAllUsers("美股收盘") })
}

// ---- HTTP ----

func alertsList(c *gin.Context) {
	uid := currentUserID(c)
	limit := 50
	if v := c.Query("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	unreadOnly := c.Query("unread") == "1"
	items, err := db.ListAlerts(uid, limit, unreadOnly)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	n, _ := db.CountUnreadAlerts(uid)
	c.JSON(200, gin.H{"items": items, "unread": n})
}

func alertsRead(c *gin.Context) {
	uid := currentUserID(c)
	var req struct {
		IDs []int64 `json:"ids"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := db.MarkAlertsRead(uid, req.IDs); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	n, _ := db.CountUnreadAlerts(uid)
	c.JSON(200, gin.H{"ok": true, "unread": n})
}

// alertsScan 手动跑一轮；dry=1 时只回预览不落库（联调用）。
func alertsScan(c *gin.Context) {
	uid := currentUserID(c)
	dry := c.Query("dry") == "1"
	rows, err := ScanAlerts(uid, dry)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"items": rows, "dry": dry})
}

// riskPreview 只算不存：持仓弹框实时预览用（新建持仓还没有 id，走不了 /holdings/:id）。
func riskPreview(c *gin.Context) {
	var req struct {
		db.Holding
		Plan RiskPlan `json:"plan"`
	}
	if e := c.ShouldBindJSON(&req); e != nil {
		c.JSON(400, gin.H{"error": "参数格式错误"})
		return
	}
	h := req.Holding
	if h.CostPrice <= 0 {
		c.JSON(200, gin.H{"basis": nil, "eval": nil, "error": "缺少成本价"})
		return
	}
	b, err := buildBasis(h, &req.Plan)
	if err != nil {
		c.JSON(200, gin.H{"basis": nil, "eval": nil, "error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"basis": b, "eval": computeEval(h, &req.Plan, b)})
}

// alertsApplyAll 一键给「还没设过方案」的持仓套用自动定价（已设过的不动，避免覆盖手动价位）。
// 存在的理由：默认 off 是为了不给存量持仓强加机械止损，但让用户逐个去开 20 只也太重。
func alertsApplyAll(c *gin.Context) {
	uid := currentUserID(c)
	preset := c.Query("preset")
	if _, ok := riskPresets[preset]; !ok {
		preset = "balanced"
	}
	hs, err := db.List(uid)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	pp := riskPresets[preset]
	n := 0
	for _, h := range hs {
		if h.Closed || h.CostPrice <= 0 {
			continue
		}
		var plan RiskPlan
		if strings.TrimSpace(h.RiskPlan) != "" {
			_ = json.Unmarshal([]byte(h.RiskPlan), &plan)
		}
		if plan.Mode != "" && plan.Mode != "off" {
			continue // 已启用：不动
		}
		plan = RiskPlan{
			Mode: "auto", Preset: preset,
			TrailingPct: pp.TrailPct, BreakEvenPct: pp.BreakEvenPct,
			Repeat: "once", MaxPerDay: 3,
		}
		// 只有场外基金按 C 类阶梯算持有成本；股票/场内 ETF 写「无赎回费」，
		// 免得 plan 里留一份用不上的 1.5% 档，日后误读。
		if isFundHolding(h) {
			plan.FeeClass, plan.FeeTiers = "c", defaultCTiers
		} else {
			plan.FeeClass, plan.FeeTiers = "none", noFeeTiers
		}
		raw, _ := json.Marshal(plan)
		if e := db.UpdateRiskPlan(h.ID, string(raw)); e == nil {
			n++
		}
	}
	c.JSON(200, gin.H{"ok": true, "updated": n, "preset": preset})
}

func holdingRiskPlanGet(c *gin.Context) {
	uid := currentUserID(c)
	id := parseID(c.Param("id"))
	h, err := db.Get(id)
	if err != nil || h.UserID != uid {
		c.JSON(404, gin.H{"error": "持仓不存在"})
		return
	}
	plan := RiskPlan{Mode: "off", Preset: "balanced"}
	if strings.TrimSpace(h.RiskPlan) != "" {
		_ = json.Unmarshal([]byte(h.RiskPlan), &plan)
	}
	// 股票 / 场内 ETF 没有赎回费：回显一律「无赎回费」，覆盖掉历史 plan 里残留的 C 类阶梯
	if !isFundHolding(*h) {
		plan.FeeClass, plan.FeeTiers = "none", noFeeTiers
	} else if plan.FeeTiers == nil {
		plan.FeeTiers = defaultCTiers
	}
	b, berr := buildBasis(*h, &plan)
	if berr != nil {
		c.JSON(200, gin.H{"plan": plan, "basis": nil, "eval": nil, "error": berr.Error()})
		return
	}
	ev := computeEval(*h, &plan, b)
	c.JSON(200, gin.H{"plan": plan, "basis": b, "eval": ev})
}

func holdingRiskPlanPut(c *gin.Context) {
	uid := currentUserID(c)
	id := parseID(c.Param("id"))
	h, err := db.Get(id)
	if err != nil || h.UserID != uid {
		c.JSON(404, gin.H{"error": "持仓不存在"})
		return
	}
	var plan RiskPlan
	if e := c.ShouldBindJSON(&plan); e != nil {
		c.JSON(400, gin.H{"error": "参数格式错误"})
		return
	}
	switch plan.Mode {
	case "auto", "manual", "off":
	default:
		plan.Mode = "off"
	}
	if _, ok := riskPresets[plan.Preset]; !ok {
		plan.Preset = "balanced"
	}
	if plan.TrailingPct <= 0 || plan.TrailingPct > 40 {
		plan.TrailingPct = riskPresets[plan.Preset].TrailPct
	}
	if plan.BreakEvenPct < 0 || plan.BreakEvenPct > 100 {
		plan.BreakEvenPct = riskPresets[plan.Preset].BreakEvenPct
	}
	if plan.MaxPerDay <= 0 || plan.MaxPerDay > 20 {
		plan.MaxPerDay = 3
	}
	if plan.CooldownMin < 0 {
		plan.CooldownMin = 0
	}
	if plan.Repeat != "repeat" {
		plan.Repeat = "once"
	}
	if len(plan.PsychNote) > 60 {
		plan.PsychNote = plan.PsychNote[:60]
	}
	// 非基金没有赎回费：不管前端传了什么档位，落库一律「无赎回费」，
	// 否则股票正文又会冒出「赎回费率 1.50%」。
	if !isFundHolding(*h) {
		plan.FeeClass, plan.FeeTiers = "none", noFeeTiers
	} else if len(plan.FeeTiers) == 0 {
		plan.FeeTiers = defaultCTiers
	}
	// 改了方案就重设基线：否则按旧方案算出的「已触发」去重记录会挡住新价位的第一条提醒
	plan.BaselineAt = ""
	raw, _ := json.Marshal(plan)
	if err := db.UpdateRiskPlan(id, string(raw)); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	h.RiskPlan = string(raw)
	b, _ := buildBasis(*h, &plan)
	c.JSON(200, gin.H{"ok": true, "plan": plan, "basis": b, "eval": computeEval(*h, &plan, b)})
}
