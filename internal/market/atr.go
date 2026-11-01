package market

import "math"

// ATR / 区间极值：止盈止损定价的波动锚。
//
// 为什么必须单独算：项目原有的 indicators.go 只有 MA/MACD/RSI/KDJ/BOLL，
// 这些描述「趋势与位置」，但没有「日常波动幅度」，而止损位必须由波动幅度定，
// 否则同一个百分比止损在债基上永不触发、在行业主题上一天被扫穿。

// ClosesOf 抽取收盘价序列。
func ClosesOf(bars []KlineBar) []float64 {
	out := make([]float64, len(bars))
	for i, b := range bars {
		out[i] = b.Close
	}
	return out
}

// ATRFromBars Wilder ATR(period)：先算 TR，再取首值 SMA、其后递推平滑。
// bars 不足 period+1 根时回落到「已有一根以上就用全部样本」，仍不足返回 0。
func ATRFromBars(bars []KlineBar, period int) float64 {
	if period <= 0 {
		period = 14
	}
	if len(bars) < 2 {
		return 0
	}
	trs := make([]float64, 0, len(bars)-1)
	for i := 1; i < len(bars); i++ {
		h, l, pc := bars[i].High, bars[i].Low, bars[i-1].Close
		tr := math.Max(h-l, math.Max(math.Abs(h-pc), math.Abs(l-pc)))
		if tr <= 0 { // 数据源缺 high/low（个别接口只给收盘）时退化为收盘波幅
			tr = math.Abs(bars[i].Close - pc)
		}
		trs = append(trs, tr)
	}
	return wilderSmooth(trs, period)
}

// ATRFromCloses 仅收盘序列的 ATR（基金净值没有 high/low，用 |Δ| 近似真实波幅）。
// 这是本项目基金持仓的默认路径：FetchFundNAVHistory 只返回每日净值。
func ATRFromCloses(closes []float64, period int) float64 {
	if len(closes) < 2 {
		return 0
	}
	trs := make([]float64, 0, len(closes)-1)
	for i := 1; i < len(closes); i++ {
		trs = append(trs, math.Abs(closes[i]-closes[i-1]))
	}
	return wilderSmooth(trs, period)
}

func wilderSmooth(trs []float64, period int) float64 {
	if len(trs) == 0 {
		return 0
	}
	if period <= 0 {
		period = 14
	}
	n := period
	if n > len(trs) {
		n = len(trs)
	}
	sum := 0.0
	for i := 0; i < n; i++ {
		sum += trs[i]
	}
	atr := sum / float64(n)
	for i := n; i < len(trs); i++ {
		atr = (atr*float64(period-1) + trs[i]) / float64(period)
	}
	return atr
}

// HighestClose 最近 n 根的最高收盘（n 超过样本量则用全部）。
func HighestClose(closes []float64, n int) float64 {
	if len(closes) == 0 {
		return 0
	}
	start := len(closes) - n
	if n <= 0 || start < 0 {
		start = 0
	}
	best := closes[start]
	for _, v := range closes[start:] {
		if v > best {
			best = v
		}
	}
	return best
}

// LowestClose 最近 n 根的最低收盘。
func LowestClose(closes []float64, n int) float64 {
	if len(closes) == 0 {
		return 0
	}
	start := len(closes) - n
	if n <= 0 || start < 0 {
		start = 0
	}
	worst := closes[start]
	for _, v := range closes[start:] {
		if v > 0 && v < worst {
			worst = v
		}
	}
	return worst
}

// ChangePctBetween 两价涨跌幅（second 相对 first），用于 trailing 回撤。
func ChangePctBetween(first, second float64) float64 {
	if first <= 0 {
		return 0
	}
	return (second - first) / first * 100
}
