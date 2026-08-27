package market

import (
	"fmt"
	"math"
	"strings"
)

// ProbabilityResult contains the computed up/down probability and signals.
type ProbabilityResult struct {
	UpPct      float64  `json:"up_pct"`
	DownPct    float64  `json:"down_pct"`
	Confidence int      `json:"confidence"` // 1-5, higher = more confident
	Signals    []Signal `json:"signals"`
	Summary    string   `json:"summary"`
}

// Signal is an individual indicator signal.
type Signal struct {
	Indicator string  `json:"indicator"` // "MA", "MACD", "RSI", "KDJ", "BOLL"
	Direction string  `json:"direction"` // "bullish", "bearish", "neutral"
	Score     float64 `json:"score"`     // -1 to 1
	Reason    string  `json:"reason"`
}

// Score weights for each indicator.
const (
	weightMA   = 0.25
	weightMACD = 0.25
	weightRSI  = 0.20
	weightKDJ  = 0.15
	weightBOLL = 0.15
)

// CalculateProbability evaluates the probability of an upward move from indicators.
func CalculateProbability(ind *IndicatorsResult) *ProbabilityResult {
	if ind == nil {
		return &ProbabilityResult{
			UpPct:   50,
			DownPct: 50,
			Summary: "数据不足，无法评估",
		}
	}

	result := &ProbabilityResult{}
	var signals []Signal

	// MA signal: price position relative to MA5/MA10/MA20
	maSignal, maScore := evalMA(ind)
	signals = append(signals, maSignal)

	// MACD signal
	macdSignal, macdScore := evalMACD(ind)
	signals = append(signals, macdSignal)

	// RSI signal
	rsiSignal, rsiScore := evalRSI(ind)
	signals = append(signals, rsiSignal)

	// KDJ signal
	kdjSignal, kdjScore := evalKDJ(ind)
	signals = append(signals, kdjSignal)

	// BOLL signal
	bollSignal, bollScore := evalBOLL(ind)
	signals = append(signals, bollSignal)

	result.Signals = signals

	// Weighted total score: -1 to 1
	totalScore := maScore*weightMA + macdScore*weightMACD + rsiScore*weightRSI + kdjScore*weightKDJ + bollScore*weightBOLL

	// Convert to probability: score 0 -> 50%, score 1 -> 90%, score -1 -> 10%
	upPct := 50 + totalScore*40
	upPct = math.Max(10, math.Min(90, upPct))
	result.UpPct = math.Round(upPct*10) / 10
	result.DownPct = math.Round((100-upPct)*10) / 10

	// Confidence: how many signals agree
	agree := 0
	for _, s := range signals {
		if (totalScore > 0 && s.Score > 0) || (totalScore < 0 && s.Score < 0) {
			agree++
		}
	}
	result.Confidence = agree // 1-5

	// Generate summary
	var dir string
	switch {
	case totalScore > 0.5:
		dir = "强烈看涨"
	case totalScore > 0.2:
		dir = "偏多"
	case totalScore > -0.2:
		dir = "震荡整理"
	case totalScore > -0.5:
		dir = "偏空"
	default:
		dir = "强烈看跌"
	}

	// Collect key reasons
	var reasons []string
	for _, s := range signals {
		if s.Direction != "neutral" {
			reasons = append(reasons, s.Reason)
		}
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "各项指标无明显信号")
	}
	// Limit to top 3
	if len(reasons) > 3 {
		reasons = reasons[:3]
	}

	result.Summary = fmt.Sprintf("【%s】技术面看涨指数：%.1f（满值 90）。主要依据：%s",
		dir, upPct, strings.Join(reasons, "；"))

	return result
}

func evalMA(ind *IndicatorsResult) (Signal, float64) {
	p := ind.Price
	if p == 0 || ind.MA5 == 0 || ind.MA10 == 0 || ind.MA20 == 0 {
		return Signal{Indicator: "MA", Direction: "neutral", Score: 0, Reason: "数据不足"}, 0
	}

	above5 := p > ind.MA5
	above10 := p > ind.MA10
	above20 := p > ind.MA20
	ma5above10 := ind.MA5 > ind.MA10
	ma10above20 := ind.MA10 > ind.MA20

	score := 0.0
	if above5 {
		score += 0.3
	} else {
		score -= 0.3
	}
	if above10 {
		score += 0.3
	} else {
		score -= 0.3
	}
	if above20 {
		score += 0.2
	} else {
		score -= 0.2
	}
	if ma5above10 {
		score += 0.1
	}
	if ma10above20 {
		score += 0.1
	}

	var dir, reason string
	switch {
	case above5 && above10 && above20 && ma5above10 && ma10above20:
		dir = "bullish"
		reason = "多头排列，价格站上所有均线"
	case above5 && above10 && above20:
		dir = "bullish"
		reason = "价格站上 MA5/10/20，但均线未完全多头排列"
	case !above5 && !above10 && !above20 && !ma5above10:
		dir = "bearish"
		reason = "空头排列，价格跌破所有均线"
	case above5 && !above20:
		dir = "bullish"
		reason = "短期均线向上，价格在MA5上方"
	case !above5 && above20:
		dir = "bearish"
		reason = "短期回调，价格跌破MA5但仍在MA20上方"
	default:
		dir = "neutral"
		reason = "均线交织，趋势不明朗"
	}

	return Signal{
		Indicator: "MA",
		Direction: dir,
		Score:     score,
		Reason:    reason,
	}, score
}

func evalMACD(ind *IndicatorsResult) (Signal, float64) {
	dif := ind.MACD.DIF
	dea := ind.MACD.DEA
	hist := ind.MACD.HIST
	price := ind.Price

	if dif == 0 && dea == 0 {
		return Signal{Indicator: "MACD", Direction: "neutral", Score: 0, Reason: "数据不足"}, 0
	}

	// 用相对股价的比例把"贴零轴的微正"和"强势多头"区分开：
	// DIF/HIST 达到股价 0.3% 才算"显著"，否则按比例打折，避免 dif=0.0008 这种拿满分。
	rel := func(v float64) float64 {
		if price > 0 {
			return math.Abs(v) / price
		}
		return 0
	}
	const sig = 0.003

	score := 0.0
	if dif > 0 {
		score += 0.3 * math.Min(1, rel(dif)/sig)
	} else {
		score -= 0.3 * math.Min(1, rel(dif)/sig)
	}
	if dif > dea {
		score += 0.3
	} else {
		score -= 0.3
	}
	if hist > 0 {
		score += 0.4 * math.Min(1, rel(hist)/sig)
	} else {
		score -= 0.4 * math.Min(1, rel(hist)/sig)
	}
	score = math.Max(-1, math.Min(1, score))

	// "刚翻红"上限约束：金叉但红柱/动能尚弱（相对强度未达 sig）时，不应给满分——
	// 这类状态极易回踩，历史上（如邮储）曾因此拿 0.74 高分却次日下跌。
	// 显著翻红（强度>=sig）才保留原分；刚翻红则把总分压到不超过刚翻红上限。
	justTurnedRed := dif > 0 && dif > dea && hist > 0 && rel(hist) < sig && rel(dif) < sig
	const justRedCap = 0.55
	if justTurnedRed && score > justRedCap {
		score = justRedCap
	}

	var dir, reason string
	switch {
	case dif > 0 && dif > dea && hist > 0:
		if rel(hist) >= sig && rel(dif) >= sig {
			dir, reason = "bullish", "MACD金叉，红柱明显放大"
		} else {
			dir, reason = "bullish", "MACD刚翻红，动能尚弱"
		}
	case dif > 0 && dif > dea && hist < 0:
		dir = "bullish"
		reason = "MACD多头但动能减弱"
	case dif < 0 && dif < dea && hist < 0:
		dir = "bearish"
		reason = "MACD死叉状态，绿柱增长"
	case dif < 0 && dif < dea && hist > 0:
		dir = "bearish"
		reason = "MACD空头但动能减弱"
	case dif > dea:
		dir = "bullish"
		reason = "MACD金叉向上"
	default:
		dir = "bearish"
		reason = "MACD死叉向下"
	}

	return Signal{
		Indicator: "MACD",
		Direction: dir,
		Score:     score,
		Reason:    reason,
	}, score
}

func evalRSI(ind *IndicatorsResult) (Signal, float64) {
	rsi := ind.RSI
	if rsi == 0 {
		return Signal{Indicator: "RSI", Direction: "neutral", Score: 0, Reason: "数据不足"}, 0
	}

	var dir, reason string
	var score float64

	switch {
	case rsi >= 80:
		dir = "bearish"
		score = -0.8
		reason = fmt.Sprintf("RSI=%.1f，严重超买，回调风险高", rsi)
	case rsi >= 70:
		dir = "bearish"
		score = -0.4
		reason = fmt.Sprintf("RSI=%.1f，超买区域", rsi)
	case rsi >= 65:
		dir = "neutral"
		score = 0
		reason = fmt.Sprintf("RSI=%.1f，接近超买，谨慎", rsi)
	case rsi > 50:
		dir = "bullish"
		score = 0.3
		reason = fmt.Sprintf("RSI=%.1f，偏强区域", rsi)
	case rsi > 30:
		dir = "bearish"
		score = -0.3
		reason = fmt.Sprintf("RSI=%.1f，偏弱区域", rsi)
	case rsi > 20:
		dir = "bullish"
		score = 0.4
		reason = fmt.Sprintf("RSI=%.1f，超卖区域", rsi)
	default:
		dir = "bullish"
		score = 0.8
		reason = fmt.Sprintf("RSI=%.1f，严重超卖，反弹概率高", rsi)
	}

	return Signal{
		Indicator: "RSI",
		Direction: dir,
		Score:     score,
		Reason:    reason,
	}, score
}

func evalKDJ(ind *IndicatorsResult) (Signal, float64) {
	k := ind.KDJ.K
	d := ind.KDJ.D
	jval := ind.KDJ.J

	if k == 0 && d == 0 {
		return Signal{Indicator: "KDJ", Direction: "neutral", Score: 0, Reason: "数据不足"}, 0
	}

	score := 0.0
	// 高位超买区判定：K 进入超买区(>75)或 J 超买(>80)即视为高位，此时"金叉"是风险信号而非买入信号
	overbought := k > 75 || jval > 80
	if k > d && !overbought {
		score += 0.4
	} else if k < d {
		score -= 0.4
	}
	// 高位超买惩罚：K 进入超买区(>80)直接扣分，避免"高位金叉"被误判为买入信号
	if k > 80 {
		score -= 0.3
	}
	if jval < 0 {
		score += 0.4
	} else if jval > 100 {
		score -= 0.6
	} else if jval > 80 {
		score -= 0.4
	} else if jval < 20 {
		score += 0.2
	}

	var dir, reason string
	switch {
	case jval > 100:
		dir = "bearish"
		reason = fmt.Sprintf("KDJ高位钝化(J=%.1f)，超买回撤风险高", jval)
	case overbought:
		dir = "bearish"
		reason = fmt.Sprintf("KDJ高位超买(K=%.1f,J=%.1f)，回撤风险高", k, jval)
	case k > d && jval < 20:
		dir = "bullish"
		reason = "KDJ低位金叉，反弹信号"
	case k > d:
		dir = "bullish"
		reason = "KDJ金叉向上"
	case k < d:
		dir = "bearish"
		reason = "KDJ死叉向下"
	default:
		dir = "neutral"
		reason = "KDJ中性区域"
	}

	return Signal{
		Indicator: "KDJ",
		Direction: dir,
		Score:     score,
		Reason:    reason,
	}, score
}

func evalBOLL(ind *IndicatorsResult) (Signal, float64) {
	p := ind.Price
	upper := ind.BOLL.Upper
	lower := ind.BOLL.Lower

	if upper == 0 || lower == 0 {
		return Signal{Indicator: "BOLL", Direction: "neutral", Score: 0, Reason: "数据不足"}, 0
	}

	// Position within band: 0 (at lower) to 1 (at upper)
	bandRange := upper - lower
	var pos float64
	if bandRange > 0 {
		pos = (p - lower) / bandRange
	}

	var dir, reason string
	var score float64

	switch {
	case pos > 0.9:
		dir = "bearish"
		score = -0.5
		reason = "价格接近布林上轨，超买压力"
	case pos > 0.7:
		dir = "bullish"
		score = 0.3
		reason = "价格在布林中上轨，偏强"
	case pos > 0.3:
		dir = "neutral"
		score = 0
		reason = "价格在布林中轨附近"
	case pos > 0.1:
		dir = "bearish"
		score = -0.3
		reason = "价格在布林中下轨，偏弱"
	default:
		dir = "bullish"
		score = 0.5
		reason = "价格接近布林下轨，超卖支撑"
	}

	// Adjust for bandwidth
	width := ind.BOLL.Width
	if width > 20 {
		// Wide band: breakout potential - amplify
		score *= 1.3
	} else if width < 5 {
		// Narrow band: squeeze, about to breakout
		reason += "，带宽收窄，即将变盘"
	}

	return Signal{
		Indicator: "BOLL",
		Direction: dir,
		Score:     score,
		Reason:    reason,
	}, score
}
