package market

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// BuyPlanTier is one 补仓档位.
type BuyPlanTier struct {
	Action   string  `json:"Action"`   // buy=补仓/加仓, sell=止盈/减仓
	Label    string  `json:"Label"`    // 档位名，如 第一档(首选)
	Price    float64 `json:"Price"`    // 触发价（联接ETF价格，前复权）
	Drawdown float64 `json:"Drawdown"` // 买入:相对反弹顶回撤%; 卖出:相对当前涨幅%
	Amount   float64 `json:"Amount"`   // 建议每档投入金额（动态计算，元）
	Shares   float64 `json:"Shares"`   // 近似可补份额（金额 / 基金净值）
	Signal   string  `json:"Signal"`   // 触发信号说明
}

// BuyPlan holds the computed 补仓 plan for a fund whose linked_symbol is an ETF.
type BuyPlan struct {
	LinkedSymbol string        `json:"LinkedSymbol"` // 实际用于分析的联接ETF代码
	FundCost     float64       `json:"FundCost"`      // 基金持仓成本（净值口径）
	FundPrice    float64       `json:"FundPrice"`     // 基金当前净值
	ETFLatest    float64       `json:"ETFLatest"`     // 联接ETF最新价
	BOLLMid      float64       `json:"BOLLMid"`       // BOLL中轨
	BOLLUpper    float64       `json:"BOLLUpper"`     // BOLL上轨
	BOLLLower    float64       `json:"BOLLLower"`     // BOLL下轨
	SwingTop     float64       `json:"SwingTop"`      // 近60日反弹高点
	SwingBottom  float64       `json:"SwingBottom"`   // 近60日阶段底
	BottomPct    float64       `json:"BottomPct"`     // 当前价相对阶段底的回撤%
	Tiers        []BuyPlanTier `json:"Tiers"`          // 三档补仓计划
	AmmoCap      float64       `json:"AmmoCap"`       // 三档总投入上限（元）
	LossAmt      float64       `json:"LossAmt"`       // 浮动亏损额（元）
	HeldValue    float64       `json:"HeldValue"`     // 已持有市值（元）
	Note         string        `json:"Note"`           // 简短说明（非 holdings.note）
	ComputedAt   string        `json:"ComputedAt"`    // 计算时间
	HasData      bool          `json:"HasData"`       // 是否成功拿到K线
}

// ComputeLinkedETFBuyPlan derives the 三档补仓 plan for a fund by analyzing its
// linked ETF (联接ETF). It fetches the ETF's daily K-line, computes BOLL, and
// converts the ETF price levels into actionable 补仓档位 (动态补仓点位). The
// per-tier 投入金额 is computed dynamically from the holding's 已持有市值 and
// 浮动亏损 (亏损金额), using a pyramid allocation (越跌买越多). The plan is
// persisted into holdings.buy_plan by the caller on each net-value refresh; it
// is NOT written into holdings.note.
//
// cost/price/quantity come from the fund holding (净值口径).
func ComputeLinkedETFBuyPlan(linkedSymbol, fundSymbol, market string, cost, price, quantity float64) *BuyPlan {
	plan := &BuyPlan{
		LinkedSymbol: linkedSymbol,
		FundCost:     cost,
		FundPrice:    price,
		ComputedAt:   time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02 15:04:05"),
		HasData:      false,
	}
	if quantity <= 0 || price <= 0 {
		plan.Note = "（持仓数量或净值为空，无法计算补仓计划）"
		return plan
	}

	sym := resolveMarketSymbol(linkedSymbol, market)
	bars, err := FetchKline(sym)
	if err != nil || len(bars) < 30 {
		// 拿不到K线：只生成一句说明，不覆盖用户备注正文
		plan.Note = "（暂无可用的联接ETF日K线，补仓位未更新）"
		return plan
	}

	ind := CalculateIndicators(bars)
	if ind == nil {
		plan.Note = "（指标计算失败，补仓位未更新）"
		return plan
	}

	latest := bars[len(bars)-1].Close
	plan.ETFLatest = latest
	plan.BOLLMid = ind.BOLL.Mid
	plan.BOLLUpper = ind.BOLL.Upper
	plan.BOLLLower = ind.BOLL.Lower

	// 近60日 反弹顶 / 阶段底
	lo, hi := latest, latest
	n := len(bars)
	start := n - 60
	if start < 0 {
		start = 0
	}
	for i := start; i < n; i++ {
		if bars[i].Close > hi {
			hi = bars[i].Close
		}
		if bars[i].Close < lo {
			lo = bars[i].Close
		}
	}
	plan.SwingTop = hi
	plan.SwingBottom = lo
	if hi > 0 {
		plan.BottomPct = (latest - lo) / hi * 100
	}

	// 三档补仓价（基于联接ETF前复权价）
	// 第一档：BOLL下轨（触下轨+KDJ超卖为首选）
	// 第二档：近60日阶段底附近
	// 第三档：跌破阶段底（保底，破位需重估逻辑）
	tier1 := ind.BOLL.Lower
	tier2 := lo
	tier3 := lo * 0.97 // 阶段底再下探3%≈破位区间

	// ── 动态金额：基于 已持有市值 与 浮动亏损 ──
	// 已持有金额 = 当前净值 × 数量；亏损金额 = (成本−净值) × 数量（盈利则为0）
	heldValue := price * quantity
	loss := 0.0
	if cost > price {
		loss = (cost - price) * quantity
	}
	// 总预算以市值为锚，亏损越深越积极，但设上限避免越跌越补成重仓
	scale := 0.5 + math.Min(1, loss/heldValue)*0.5 // 0.5~1.0
	budget := heldValue * 0.4 * scale               // 三档总投入 ≈ 市值的 20%~40%
	// 金字塔分配：越跌买越多
	weights := []float64{0.25, 0.35, 0.40}
	labels := []string{"第一档(首选)", "第二档", "第三档(保底)"}
	signals := []string{
		"触及BOLL下轨且KDJ已超卖，性价比最高",
		"跌破下轨后到近60日阶段底支撑",
		"明确破位才考虑，破则逻辑需重估",
	}
	prices := []float64{tier1, tier2, tier3}

	plan.Tiers = make([]BuyPlanTier, 0, 3)
	for i := 0; i < 3; i++ {
		amt := budget * weights[i]
		shares := 0.0
		if price > 0 {
			shares = amt / price // 按基金净值估算可补份额
		}
		plan.Tiers = append(plan.Tiers, BuyPlanTier{
			Label:    labels[i],
			Price:    prices[i],
			Drawdown: pct(prices[i], hi),
			Amount:   amt,
			Shares:   shares,
			Signal:   signals[i],
		})
	}
	plan.AmmoCap = budget
	plan.LossAmt = loss
	plan.HeldValue = heldValue

	// ── 卖出档位（止盈/减仓）：价格从当前向上恢复时依次触发 ──
	// 回到BOLL中轨 → 触BOLL上轨 → 近60日反弹高点（越接近高位减得越多）
	sellPrices := []float64{ind.BOLL.Mid, ind.BOLL.Upper, hi}
	sellLabels := []string{"第一档(回本减仓)", "第二档(分批止盈)", "第三档(高位清仓)"}
	sellSignals := []string{
		"回到BOLL中轨附近，亏损已大幅收窄，可减仓降风险",
		"触及BOLL上轨，分批止盈锁定利润",
		"接近近60日反弹高点，清仓或大幅减仓",
	}
	sellWeights := []float64{0.25, 0.35, 0.40}
	for i := 0; i < 3; i++ {
		p := sellPrices[i]
		amt := heldValue * sellWeights[i]
		shares := 0.0
		if price > 0 {
			shares = amt / price
		}
		gain := 0.0
		if latest > 0 {
			gain = (p - latest) / latest * 100
		}
		plan.Tiers = append(plan.Tiers, BuyPlanTier{
			Action:   "sell",
			Label:    sellLabels[i],
			Price:    p,
			Drawdown: gain,
			Amount:   amt,
			Shares:   shares,
			Signal:   sellSignals[i],
		})
	}

	if loss <= 0 {
		plan.Note = "当前基金未亏损，已按市值基准给出参考档位；真跌出浮亏时补仓位会自动放大。"
	} else {
		plan.Note = fmt.Sprintf("浮动亏损 ¥%.0f；三档总投入上限 ≈¥%.0f（≈市值 %.0f%%）。跌得越深自动越积极，但请守住弹药上限。",
			loss, budget, budget/heldValue*100)
	}

	plan.HasData = true
	return plan
}

// resolveMarketSymbol converts a user symbol into the K-line API format, reusing
// the same prefix rules as the analysis flow.
func resolveMarketSymbol(symbol, market string) string {
	sym := strings.ToLower(strings.TrimSpace(symbol))
	if strings.HasPrefix(sym, "sh") || strings.HasPrefix(sym, "sz") || strings.HasPrefix(sym, "hk") {
		return sym
	}
	if len(sym) == 6 {
		switch sym[0] {
		case '6', '5', '9':
			return "sh" + sym
		case '0', '2', '3':
			return "sz" + sym
		}
	}
	return sym
}

func pct(price, top float64) float64 {
	if top <= 0 {
		return 0
	}
	return (price - top) / top * 100
}
