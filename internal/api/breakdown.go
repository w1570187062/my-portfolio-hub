package api

// ===== 复盘页「收益归因」区间接口（2026-11-03 改版：账本口径）=====
//
// 只统计**权益标的**（股票 + 基金），排除理财和现金（两者差一个数量级，混读不了）。
//
// 主口径：直接累加盈亏日历（pnl_daily.detail.by_symbol.pnl_cny），
// 不再从 position_tx + 市值重算一遍 —— 与首页区间盈亏曲线 / 盈亏日历完全同源，
// 杜绝两套算法各算各的、数字对不上。
//
// 唯一补充：pnl_daily 有账本起始日（快照功能上线日）。当区间起点早于账本首日
// （6m/1y/all 常见）时，缺口窗口 [max(区间起点, 建仓首笔), 账本首日) 的收益按
// 「账本首日前收盘市值 − 缺口起点市值代理 − 缺口窗口净流入」补一段；
// 市值用 price_daily 真实价格，补不出来（无价格/无起点数量）则不计并标「估算」。

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// breakdownItem 归因条目中的一行。
type breakdownItem struct {
	HoldingID  int64   `json:"hid"`
	Key        string  `json:"key"`   // rbClassStock | rbClassFund
	Name       string  `json:"name"`
	Symbol     string  `json:"symbol"`
	State      string  `json:"state"` // holding | closed
	Label      string  `json:"label"` // 类别中文名（股票/基金）
	// 核心：区间真实收益（CNY）。不是全持有期，是指定区间内的贡献。
	GainRange  float64 `json:"gain_range_cny"`
	// 支撑字段（前端按需展示或调试）
	MV         float64 `json:"mv_cny"`       // 今日市值（CNY，已清仓为 0）
	StartMV    float64 `json:"start_mv_cny"` // 区间起点市值（CNY，取不到真实价时为 0，前端收益率显示 —）
	InvestedRange float64 `json:"invested_range_cny"` // 区间内净投入（账本口径暂不提供，保留字段兼容）
	Days       int     `json:"days_in_range"`
	Quality    string  `json:"quality"` // ok | estimated
	Note       string  `json:"note,omitempty"`
	// 收益率 %：手动补录平仓记录直接带用户填的值（或 盈亏÷本金），其余条目由前端按 start_mv 算
	RetPct *float64 `json:"ret_pct,omitempty"`
}

type breakdownResp struct {
	Range  gin.H           `json:"range"`
	Items  []breakdownItem `json:"items"`
	Total  float64         `json:"total_gain_cny"`
}

// pnlBySym / pnlDetail：pnl_daily.detail 的 by_symbol 明细（只取需要的字段）。
type pnlBySym struct {
	Symbol string  `json:"symbol"`
	PnlCNY float64 `json:"pnl_cny"` // 早期快照可能缺省（当日为 0）
}

type pnlDetail struct {
	BySymbol []pnlBySym `json:"by_symbol"`
}

// txSliceSum：某日期之前（不含当日）的流水切片汇总。
type txSliceSum struct {
	SumBefore float64 // ΣBUY(amt+fee) − ΣSELL(amt−fee) − ΣDIV（净流入累计）
	Realized  float64 // ΣSELL.realized_pnl
	Qty       float64 // ΣBUY.qty − ΣSELL.qty（起点剩余数量）
	First     string  // 切片内最早一笔日期（"" = 切片为空）
}

func sliceTxsBefore(txs []db.PositionTx, before string) txSliceSum {
	var s txSliceSum
	if before == "" {
		return s
	}
	for _, t := range txs {
		if t.Reverted == 1 {
			continue
		}
		d := strings.TrimSpace(t.CreatedAt)
		if len(d) > 10 {
			d = d[:10]
		}
		if d == "" || d >= before {
			continue
		}
		if s.First == "" || d < s.First {
			s.First = d
		}
		switch t.TxType {
		case "BUY":
			s.SumBefore += t.Amount + t.Fee
			s.Qty += t.Quantity
		case "SELL":
			s.SumBefore -= t.Amount - t.Fee
			s.Qty -= t.Quantity
			s.Realized += t.RealizedPnl
		case "DIV":
			s.SumBefore -= t.Amount
		}
	}
	return s
}

// computeBreakdown 区间权益收益归因。rangeStr: 1m/3m/6m/1y/all，默认 1y。
func computeBreakdown(uid int64, rangeStr string) breakdownResp {
	now := time.Now().In(beijing)
	days, ok := benchRangeMap[rangeStr]
	if !ok {
		days = 365
		rangeStr = "1y"
	}
	var fromDate string
	if days > 0 {
		fromDate = now.AddDate(0, 0, -days).Format("2006-01-02")
	} // fromDate 为空 = all（不设起点）

	cnyRate, hkdRate, _ := market.FetchFXRates()
	out := breakdownResp{
		Range: gin.H{"key": rangeStr, "days": days},
		Items: make([]breakdownItem, 0, 8),
	}

	// 1) 主口径：盈亏日历按 symbol 累加（pnl_cny 已折 CNY）
	ledger := map[string]float64{}
	// 全局账本起点（不受查询区间过滤影响），缺口补偿与「估算」判定都用它
	ledgerStart := db.FirstPnlDate(uid)
	var firstDayPnl map[string]float64 // 账本首日各 symbol 的当日盈亏（反推前收市值用）
	rows, _ := db.ListPnlDailyFrom(fromDate, uid)
	for _, r := range rows {
		var d pnlDetail
		if json.Unmarshal([]byte(r.Detail), &d) != nil {
			continue
		}
		if r.Date == ledgerStart {
			firstDayPnl = make(map[string]float64, len(d.BySymbol))
			for _, x := range d.BySymbol {
				firstDayPnl[x.Symbol] = x.PnlCNY
			}
		}
		for _, x := range d.BySymbol {
			ledger[x.Symbol] += x.PnlCNY
		}
	}

	needGap := ledgerStart != "" && (fromDate == "" || fromDate < ledgerStart)

	hs, _ := db.List(uid)
	for _, h := range hs {
		// 只算股票和基金（权益），排除理财和现金
		cat := strings.ToLower(strings.TrimSpace(h.Category))
		if cat != "stock" && cat != "fund" {
			continue
		}
		cur := strings.ToLower(strings.TrimSpace(h.Currency))
		if cur == "rmb" {
			cur = "cny"
		}
		key := rbClassStock
		if cat == "fund" {
			key = rbClassFund
		}

		gain := ledger[h.Symbol]
		note := ""
		estimated := false

		// 2) 缺口补偿：区间起点早于账本首日的部分
		if needGap {
			txs, _ := db.ListPositionTx(h.ID)
			sFD := sliceTxsBefore(txs, fromDate)    // 缺口起点前（"" = 全历史 → 空切片）
			sLS := sliceTxsBefore(txs, ledgerStart) // 账本首日前
			gap, gapOK := preLedgerGap(h, uid, txs, fromDate, ledgerStart, sFD, sLS, firstDayPnl, cnyRate, hkdRate)
			if gapOK {
				gain += gap
			} else if sLS.First != "" || (h.BuyDate != "" && h.BuyDate < ledgerStart) {
				// 账本首日时确实已持仓（有起点前流水，或建仓日早于账本起点），但缺口补不出来 → 明示「估算」
				estimated = true
				note = "账本起点（" + ledgerStart + "）前收益未计入"
			}
		}

		// 已清仓且区间内零贡献：不占榜
		if h.Closed && math.Abs(gain) < 0.005 {
			continue
		}

		// 今日市值（已清仓为 0）
		var todayMV float64
		if !h.Closed {
			todayMV = fxToCNY(h.Quantity*h.CurrentPrice, cur, cnyRate, hkdRate)
		}

		// 区间起点市值（展示收益率用）：起点剩余数量 × 起点日真实收盘价
		var startMV float64
		if fromDate != "" && !h.Closed {
			txs, _ := db.ListPositionTx(h.ID)
			sFD := sliceTxsBefore(txs, fromDate)
			qtyFD := sFD.Qty
			if sFD.First == "" && h.BuyDate != "" && h.BuyDate < fromDate {
				// 区间起点前无流水但建仓更早（老数据）：数量沿用当前持仓
				qtyFD = h.Quantity
			}
			if qtyFD > 0 {
				if p, ok, _ := db.GetCloseOnOrBefore(h.Symbol, fromDate, uid); ok {
					startMV = fxToCNY(qtyFD*p.Close, cur, cnyRate, hkdRate)
				}
			}
		}

		item := breakdownItem{
			HoldingID: h.ID,
			Key:       key,
			Name:      h.Name,
			Symbol:    h.Symbol,
			State:     "holding",
			Label:     rbClassLabels[key],
			GainRange: round2(gain),
			MV:        round2(todayMV),
			StartMV:   round2(startMV),
			Quality:   "ok",
			Note:      note,
		}
		if h.Closed {
			item.State = "closed"
		}
		if estimated {
			item.Quality = "estimated"
		}
		out.Items = append(out.Items, item)
		out.Total += item.GainRange
	}

	// 3) 手动补录的平仓记录（不入账、不在盈亏日历里）：清仓时间落在区间内即计入。
	// 只收股票/基金（理财补录与「仅权益标的」口径一致，排除）。
	mcs, _ := db.ListManualClosed(uid)
	for _, m := range mcs {
		k := strings.ToLower(strings.TrimSpace(m.Kind))
		if k != "stock" && k != "fund" {
			continue
		}
		d := strings.TrimSpace(m.RealizedAt)
		if fromDate != "" && (d == "" || d < fromDate) {
			continue
		}
		key := rbClassStock
		if k == "fund" {
			key = rbClassFund
		}
		cur := strings.ToLower(strings.TrimSpace(m.Currency))
		if cur == "" {
			cur = "cny"
		}
		gain := fxToCNY(m.Amount, cur, cnyRate, hkdRate)
		item := breakdownItem{
			HoldingID: -m.ID, // 负 id 与持仓表区分
			Key:       key,
			Name:      m.Name,
			Symbol:    m.Code,
			State:     "closed",
			Label:     rbClassLabels[key],
			GainRange: round2(gain),
			Quality:   "ok",
		}
		// 收益率：用户填的优先，缺省按 盈亏÷本金 推算
		if m.ReturnRate != nil {
			v := round2(*m.ReturnRate)
			item.RetPct = &v
		} else if m.Principal != nil && *m.Principal > 0 {
			v := round2(m.Amount / *m.Principal * 100)
			item.RetPct = &v
		}
		out.Items = append(out.Items, item)
		out.Total += item.GainRange
	}

	// 按 |gain_range| 降序（贡献/拖累最大的排前面）
	sort.SliceStable(out.Items, func(i, j int) bool {
		return math.Abs(out.Items[i].GainRange) > math.Abs(out.Items[j].GainRange)
	})
	return out
}

// preLedgerGap 补账本首日之前的缺口收益（CNY）。
// 记 G(t) = 市值(t) − 此前净流入（= 截至 t 的累计收益），缺口窗口收益：
//
//	gap = G(账本首日) − G(缺口起点)
//
// G(账本首日)：市值用 price_daily 收盘价（price_daily 往往恰好从账本首日才开始记录，
// 此时用「首日收盘市值 − 首日当日盈亏」反推前收市值，与快照首日口径一致）；
// 净流入优先用流水切片，无流水记录的老持仓（早于流水功能）按成本反推：
// 持仓中用 qty×成本价，已清仓用卖出流水反推（净回款 − 已实现盈亏 = 卖出份额成本）。
// G(缺口起点)：有流水时 = 起点前已实现盈亏（成本代理下未实现部分相消为 0）；
// 缺口起点早于建仓（或全历史）时为 0。
func preLedgerGap(h db.Holding, uid int64, txs []db.PositionTx, fromDate, ledgerStart string, sFD, sLS txSliceSum, firstDayPnl map[string]float64, cnyRate, hkdRate float64) (float64, bool) {
	// 账本首日时的持仓数量
	qtyLS := sLS.Qty
	if sLS.First == "" {
		// 账本首日前无流水：当前数量减去账本期内净买入倒推（含已清仓者的卖出）
		var tradedAfter float64
		for _, t := range txs {
			if t.Reverted == 1 {
				continue
			}
			d := strings.TrimSpace(t.CreatedAt)
			if len(d) > 10 {
				d = d[:10]
			}
			if d == "" || d < ledgerStart {
				continue
			}
			switch t.TxType {
			case "BUY":
				tradedAfter += t.Quantity
			case "SELL":
				tradedAfter -= t.Quantity
			}
		}
		qtyLS = h.Quantity - tradedAfter
	}
	if qtyLS <= 0 {
		return 0, false
	}
	// 账本首日前的净流入
	flowsLS := sLS.SumBefore
	if sLS.First == "" && h.BuyDate != "" && h.BuyDate < ledgerStart {
		// 无流水记录的老持仓：净流入按成本反推
		if !h.Closed && h.CostPrice > 0 {
			flowsLS = qtyLS * h.CostPrice
		} else if h.Closed {
			// 已清仓：成本 = 卖出净回款 − 已实现盈亏（前提：账本期内纯卖出、无再买入）
			var sellNet, realizedAfter, qtyBuyAfter float64
			for _, t := range txs {
				if t.Reverted == 1 {
					continue
				}
				d := strings.TrimSpace(t.CreatedAt)
				if len(d) > 10 {
					d = d[:10]
				}
				if d == "" || d < ledgerStart {
					continue
				}
				switch t.TxType {
				case "BUY":
					qtyBuyAfter += t.Quantity
				case "SELL":
					sellNet += t.Amount - t.Fee
					realizedAfter += t.RealizedPnl
				}
			}
			if qtyBuyAfter == 0 && qtySoldAfterQty(txs, ledgerStart) > 0 {
				flowsLS = sellNet - realizedAfter
			}
		}
	}
	if flowsLS <= 0 && sLS.First == "" {
		return 0, false // 成本反推不出来（如清仓后成本清零），宁可不计也不虚增
	}
	// 账本首日前收市值
	pd, ok, _ := db.GetCloseOnOrBefore(h.Symbol, ledgerStart, uid)
	if !ok || pd.Close <= 0 {
		return 0, false
	}
	cur := strings.ToLower(strings.TrimSpace(h.Currency))
	if cur == "rmb" {
		cur = "cny"
	}
	gLS := fxToCNY(qtyLS*pd.Close, cur, cnyRate, hkdRate) - fxToCNY(flowsLS, cur, cnyRate, hkdRate)
	if pd.Date == ledgerStart {
		// 首日收盘市值 − 首日当日盈亏（CNY）= 首日前收市值
		gLS -= firstDayPnl[h.Symbol]
	}
	// G(缺口起点)
	gFD := 0.0
	if fromDate != "" && sFD.First != "" {
		gFD = fxToCNY(sFD.Realized, cur, cnyRate, hkdRate)
	}
	return gLS - gFD, true
}

// qtySoldAfterQty 统计账本首日之后卖出的总数量。
func qtySoldAfterQty(txs []db.PositionTx, ledgerStart string) float64 {
	var n float64
	for _, t := range txs {
		if t.Reverted == 1 || t.TxType != "SELL" {
			continue
		}
		d := strings.TrimSpace(t.CreatedAt)
		if len(d) > 10 {
			d = d[:10]
		}
		if d != "" && d >= ledgerStart {
			n += t.Quantity
		}
	}
	return n
}

// breakdownGet GET /api/review/breakdown?range=1y（1m/3m/6m/1y/all）
func breakdownGet(c *gin.Context) {
	rng := c.Query("range")
	c.JSON(200, computeBreakdown(currentUserID(c), rng))
}
