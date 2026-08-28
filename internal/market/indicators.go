package market

import "math"

// IndicatorsResult holds all computed technical indicators.
type IndicatorsResult struct {
	MA5  float64 `json:"ma5"`
	MA10 float64 `json:"ma10"`
	MA20 float64 `json:"ma20"`
	MA60 float64 `json:"ma60"`
	MACD struct {
		DIF      float64 `json:"dif"`
		DEA      float64 `json:"dea"`
		HIST     float64 `json:"hist"`
		HistPrev float64 `json:"hist_prev"` // 上一交易日柱体值（用于判断红/绿柱增减趋势）
	} `json:"macd"`
	RSI float64 `json:"rsi"`
	KDJ struct {
		K float64 `json:"k"`
		D float64 `json:"d"`
		J float64 `json:"j"`
	} `json:"kdj"`
	BOLL struct {
		Upper float64 `json:"upper"`
		Mid   float64 `json:"mid"`
		Lower float64 `json:"lower"`
		Width float64 `json:"width"` // (upper-lower)/mid * 100
	} `json:"boll"`
	Price float64 `json:"price"` // latest close price
}

// CalculateIndicators computes all indicators from K-line bars.
func CalculateIndicators(bars []KlineBar) *IndicatorsResult {
	if len(bars) < 2 {
		return nil
	}

	closes := make([]float64, len(bars))
	highs := make([]float64, len(bars))
	lows := make([]float64, len(bars))
	for i, b := range bars {
		closes[i] = b.Close
		highs[i] = b.High
		lows[i] = b.Low
	}

	result := &IndicatorsResult{Price: closes[len(closes)-1]}

	result.MA5 = smaLast(closes, 5)
	result.MA10 = smaLast(closes, 10)
	result.MA20 = smaLast(closes, 20)
	result.MA60 = smaLast(closes, 60)

	// MACD
	dif, dea, hist := macd(closes)
	if len(dif) > 0 {
		result.MACD.DIF = dif[len(dif)-1]
	}
	if len(dea) > 0 {
		result.MACD.DEA = dea[len(dea)-1]
	}
	if len(hist) > 0 {
		result.MACD.HIST = hist[len(hist)-1]
		if len(hist) > 1 {
			result.MACD.HistPrev = hist[len(hist)-2]
		}
	}

	// RSI (14)
	result.RSI = rsiLast(closes, 14)

	// KDJ (9,3,3)
	k, d, j := kdj(highs, lows, closes, 9, 3, 3)
	if len(k) > 0 {
		result.KDJ.K = k[len(k)-1]
		result.KDJ.D = d[len(d)-1]
		result.KDJ.J = j[len(j)-1]
	}

	// BOLL (20, 2)
	upper, mid, lower := boll(closes, 20, 2.0)
	if len(mid) > 0 {
		result.BOLL.Mid = mid[len(mid)-1]
		result.BOLL.Upper = upper[len(upper)-1]
		result.BOLL.Lower = lower[len(lower)-1]
		if result.BOLL.Mid > 0 {
			result.BOLL.Width = (result.BOLL.Upper - result.BOLL.Lower) / result.BOLL.Mid * 100
		}
	}

	return result
}

func smaLast(data []float64, period int) float64 {
	if period <= 0 || period > len(data) {
		return 0
	}
	sum := 0.0
	for i := len(data) - period; i < len(data); i++ {
		sum += data[i]
	}
	return sum / float64(period)
}

func ema(data []float64, period int) []float64 {
	if period <= 0 || period > len(data) {
		return nil
	}
	result := make([]float64, len(data))
	mult := 2.0 / (float64(period) + 1)
	// First value is SMA
	sum := 0.0
	for i := 0; i < period; i++ {
		sum += data[i]
	}
	ema := sum / float64(period)
	result[period-1] = ema
	for i := period; i < len(data); i++ {
		ema = (data[i]-ema)*mult + ema
		result[i] = ema
	}
	return result
}

func macd(closes []float64) (dif, dea, hist []float64) {
	if len(closes) < 26 {
		return nil, nil, nil
	}
	n := len(closes)
	ema12 := ema(closes, 12)
	ema26 := ema(closes, 26)
	dif = make([]float64, n)
	for i := 0; i < n; i++ {
		if ema12[i] != 0 && ema26[i] != 0 {
			dif[i] = cmplxRound(ema12[i]-ema26[i], 4)
		}
	}
	dea = make([]float64, n)
	hist = make([]float64, n)
	// DEA starts at period 25 (26-1) for ema26, but we need 9 bars of DIF
	start := 25 // first valid DIF
	if start+9 > n {
		return dif, dea, hist
	}
	// First DEA = SMA of first 9 valid DIFs
	sum := 0.0
	for i := start; i < start+9; i++ {
		sum += dif[i]
	}
	dea[start+8] = cmplxRound(sum/9.0, 4)
	mult := 2.0 / 10.0 // (9+1)
	for i := start + 9; i < n; i++ {
		dea[i] = cmplxRound((dif[i]-dea[i-1])*mult+dea[i-1], 4)
	}
	for i := 0; i < n; i++ {
		if dea[i] != 0 {
			hist[i] = cmplxRound((dif[i]-dea[i])*2.0, 4)
		}
	}
	return
}

func rsiLast(closes []float64, period int) float64 {
	if period <= 0 || len(closes) < period+1 {
		return 50
	}
	gain, loss := 0.0, 0.0
	for i := len(closes) - period; i < len(closes); i++ {
		diff := closes[i] - closes[i-1]
		if diff > 0 {
			gain += diff
		} else {
			loss -= diff
		}
	}
	avgGain := gain / float64(period)
	avgLoss := loss / float64(period)
	if avgLoss == 0 {
		return 100
	}
	rs := avgGain / avgLoss
	return 100.0 - (100.0 / (1.0 + rs))
}

func kdj(highs, lows, closes []float64, n, m1, m2 int) (k, d, j []float64) {
	length := len(closes)
	if length < n {
		return nil, nil, nil
	}
	k = make([]float64, length)
	d = make([]float64, length)
	j = make([]float64, length)

	// RSV for each period
	rsv := make([]float64, length)
	for i := n - 1; i < length; i++ {
		high := highs[i]
		low := lows[i]
		for t := i - n + 1; t <= i; t++ {
			if highs[t] > high {
				high = highs[t]
			}
			if lows[t] < low {
				low = lows[t]
			}
		}
		if high-low == 0 {
			rsv[i] = 100
		} else {
			rsv[i] = (closes[i] - low) / (high - low) * 100
		}
	}

	// Initialize K, D with 50 at period start
	k[n-1] = 50
	d[n-1] = 50
	j[n-1] = 50

	a1 := 1.0 / float64(m1)
	a2 := 1.0 / float64(m2)

	for i := n; i < length; i++ {
		prevK := k[i-1]
		if prevK == 0 {
			prevK = 50
		}
		k[i] = prevK + a1*(rsv[i]-prevK)

		prevD := d[i-1]
		if prevD == 0 {
			prevD = 50
		}
		d[i] = prevD + a2*(k[i]-prevD)

		j[i] = 3*k[i] - 2*d[i]
	}

	return k, d, j
}

func boll(closes []float64, period int, multiplier float64) (upper, mid, lower []float64) {
	n := len(closes)
	if n < period {
		return nil, nil, nil
	}
	upper = make([]float64, n)
	mid = make([]float64, n)
	lower = make([]float64, n)

	for i := period - 1; i < n; i++ {
		// Calculate SMA
		sum := 0.0
		for t := i - period + 1; t <= i; t++ {
			sum += closes[t]
		}
		mid[i] = sum / float64(period)

		// Calculate standard deviation
		variance := 0.0
		for t := i - period + 1; t <= i; t++ {
			diff := closes[t] - mid[i]
			variance += diff * diff
		}
		std := math.Sqrt(variance / float64(period))

		upper[i] = mid[i] + multiplier*std
		lower[i] = mid[i] - multiplier*std
	}

	return
}

func cmplxRound(v float64, decimals int) float64 {
	pow := math.Pow(10, float64(decimals))
	return math.Round(v*pow) / pow
}
