package api

// ===== 复盘页「收益归因」区间接口（2026-11-02）=====
//
// 只统计**权益标的**（股票 + 基金），排除理财和现金（两者差一个数量级，混读不了）。
//
// 口径：区间收益 = 今日市值 − 区间起点市值 + 区间内净现金流 + 区间内分红 − 区间内手续费
//   - 区间起点市值：从 position_tx 里按日期切片算起点前的累计投入（BUY − SELL − DIV − FEE）
//     加上起点前已结清的 realized_pnl（因为 realized_pnl 已经扣了成本）
//   - 今日市值 = holding.quantity × holding.current_price
//   - 所有金额按原币折 CNY
//   - 区间内的 BUY 算"净追加"（负项），SELL 算"净回流"（正项），DIV 算"分红回流"
//   - 已清仓：今日市值 = 0，区间收益 = 区间内净已实现盈亏
//   - 没有任何 position_tx 历史的老持仓（早于流水功能上线）：退回用 holding.cost_price 反推起点，前端标"估算"

import (
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
	MV         float64 `json:"mv_cny"`          // 今日市值（CNY）
	StartMV    float64 `json:"start_mv_cny"`    // 区间起点市值（CNY，估算时标 estimated=true）
	InvestedRange float64 `json:"invested_range_cny"` // 区间内净投入（BUY − SELL − FEE，负 = 净追加）
	Days       int     `json:"days_in_range"`    // 区间内覆盖天数（≤0 表示整个区间都持有）
	Quality    string  `json:"quality"`          // ok | estimated | no_data
	Note       string  `json:"note,omitempty"`
}

type breakdownResp struct {
	Range  gin.H           `json:"range"`
	Items  []breakdownItem `json:"items"`
	Total  float64         `json:"total_gain_cny"`
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

	hs, _ := db.List(uid)
	for _, h := range hs {
		// 只算股票和基金（权益），排除理财和现金
		cat := strings.ToLower(strings.TrimSpace(h.Category))
		if cat != "stock" && cat != "fund" {
			continue
		}
		// 清仓跳过（已平仓不计入"当前归因"，用户已卖出）
		if h.Closed {
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

		// 逐笔流水按日期切片
		txs, _ := db.ListPositionTx(h.ID)
		var sumBefore float64       // 起点前净投入（BUY − SELL − FEE）
		var sumRealizedBefore float64 // 起点前已实现盈亏（SELL.realized_pnl 累计）
		var investedInRange float64 // 区间内净投入（BUY − SELL − FEE）
		var divInRange float64      // 区间内分红（正项 = 钱回流）
		var oldestDate, newestDate string
		hasTx := false

		for _, t := range txs {
			if t.Reverted == 1 {
				continue
			}
			d := strings.TrimSpace(t.CreatedAt)
			if len(d) > 10 {
				d = d[:10]
			}
			if d == "" {
				continue
			}
			hasTx = true
			if oldestDate == "" || d < oldestDate {
				oldestDate = d
			}
			if newestDate == "" || d > newestDate {
				newestDate = d
			}
			switch t.TxType {
			case "BUY":
				amt := t.Amount + t.Fee
				if fromDate != "" && d < fromDate {
					sumBefore += amt // 起点前投入
				} else {
					investedInRange += amt // 区间内投入（正 = 追加）
				}
			case "SELL":
				net := t.Amount - t.Fee
				if fromDate != "" && d < fromDate {
					sumBefore -= net               // 起点前卖出回流
					sumRealizedBefore += t.RealizedPnl // 起点前已实现盈亏
				} else {
					investedInRange -= net         // 区间内卖出（负 = 回流，会减少 investedInRange 使它变小）
				}
			case "DIV":
				if fromDate != "" && d < fromDate {
					sumBefore -= t.Amount          // 起点前分红回流
				} else {
					divInRange += t.Amount         // 区间内分红
				}
			}
		}

		// 区间起点市值 = 起点前净投入 + 起点前已实现盈亏
		// realized_pnl 已经包含了成本结转，所以起点前的卖出"投入−回流"差就是 realized_pnl
		var startMV float64
		estimated := false
		if hasTx {
			startMV = sumBefore + sumRealizedBefore
		} else {
			// 没有 BUY 流水（老数据早于流水功能上线）：退回用成本价算全持有期投入
			cost := h.Quantity * h.CostPrice
			startMV = cost
			estimated = true
		}
		// 如果区间起点在买入日之前：起点市值从 0 开始（从买入日到今天是全持有期）
		if fromDate != "" && oldestDate != "" && fromDate < oldestDate {
			startMV = 0
		}

		nativeMV := h.Quantity * h.CurrentPrice
		todayMV := fxToCNY(nativeMV, cur, cnyRate, hkdRate)
		investedInRangeCNY := fxToCNY(investedInRange, cur, cnyRate, hkdRate)
		startMVCNY := fxToCNY(startMV, cur, cnyRate, hkdRate)
		divInRangeCNY := fxToCNY(divInRange, cur, cnyRate, hkdRate)

		// 区间收益 = 今日市值 − 区间起点市值 − 区间内净投入 + 区间内分红
		// investedInRange 正 = 区间内追加了投入，所以减去它（因为今日市值里包含了新投入的部分）
		gain := todayMV - startMVCNY - investedInRangeCNY + divInRangeCNY
		// 等价理解：gain = 区间内的市值变动（today − start）+ 区间内的净贡献（SELL − BUY + DIV − FEE）
		// 这两种理解是一致的。

		daysCovered := 0
		if fromDate != "" && oldestDate != "" && oldestDate > fromDate {
			daysCovered = daysBetweenDates(fromDate, oldestDate)
		}

		item := breakdownItem{
			HoldingID:     h.ID,
			Key:           key,
			Name:          h.Name,
			Symbol:        h.Symbol,
			State:         "holding",
			Label:         rbClassLabels[key],
			GainRange:     round2(gain),
			MV:            round2(todayMV),
			StartMV:       round2(startMVCNY),
			InvestedRange: round2(investedInRangeCNY),
			Days:          daysCovered,
			Quality:       "ok",
		}
		if estimated {
			item.Quality = "estimated"
			item.Note = "无买入流水，起点市值按成本价估算"
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

// breakdownGet GET /api/review/breakdown?range=1y（1m/3m/6m/1y/all）
func breakdownGet(c *gin.Context) {
	rng := c.Query("range")
	c.JSON(200, computeBreakdown(currentUserID(c), rng))
}
