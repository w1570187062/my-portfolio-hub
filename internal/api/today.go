package api

// ===== 首页「今日待办」（2026-11-02）=====
//
// 首页此前只讲「过去」：净资产、收益曲线、最近流水 —— 今天该做什么散落在四处：
// 止盈止损触达在顶栏铃铛里、定投到期在定投计划弹框、待还款在资产页「收支」、存款到期在投资页「存款」。
//
// 这里把它们聚合成**一次请求**（而不是让首页再并发 4 个接口），前端只在 Hero 底部
// 渲染一条 strip：零项时整条不出现，有点击展开成组清单。
//
// 口径约定（与各自页面严格同源，避免两处数字对不上）：
//   - 止盈止损 = alert_events 里**未读**的条数（已读即视为处理过）；
//   - 定投 = 在投计划里 pending 期次数（与 /api/dca/plans 的 pending_total 同源）；
//   - 待还款 = 收支计划中 expense 且本月未完成、本月应还日已到的条数；
//   - 存款到期 = 未落袋且到期日在 7 天内（含已过期未确认）的笔数。

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// daysInMonth 当月天数：把「每月 31 号」这类计划在短月里落到月末，
// 否则 2 月永远没有 31 号，该计划整月不出现（且不报错）。
func daysInMonth(t time.Time) int {
	return time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
}

// todayItem 一条待办（前端只渲染两行文字 + 跳转，不在后端拼货币符号）。
type todayItem struct {
	Title  string  `json:"title"`
	Sub    string  `json:"sub"`
	Amount float64 `json:"amount"` // 本条折 CNY 金额（0 = 该类型无金额）
}

// todayGroup 一类待办。
type todayGroup struct {
	Key    string      `json:"key"` // alert | dca | repay | maturity
	Label  string      `json:"label"`
	Count  int         `json:"count"`
	Amount float64     `json:"amount"` // 折 CNY 合计；止盈止损没有金额，恒 0
	Items  []todayItem `json:"items"`
}

// alertKindCN 提醒类型的中文短名（与前端 alertKindMeta 的 tag 文案保持一致）。
func alertKindCN(kind string) string {
	switch kind {
	case "take_profit":
		return "止盈"
	case "stop_loss":
		return "止损"
	case "trailing":
		return "回落止盈"
	case "psych":
		return "心理价"
	case "fee_window":
		return "费率窗口"
	}
	return "提醒"
}

// todayBrief GET /api/today/brief
func todayBrief(c *gin.Context) {
	uid := currentUserID(c)
	now := time.Now().In(beijing)
	today := now.Format("2006-01-02")
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, beijing)
	cnyRate, hkdRate, _ := market.FetchFXRates()

	groups := make([]todayGroup, 0, 4)
	total := 0

	// ---- 1) 止盈止损触达：未读提醒 ----
	if as, err := db.ListAlerts(uid, 50, true); err == nil && len(as) > 0 {
		g := todayGroup{Key: "alert", Label: "止盈止损", Count: len(as), Items: make([]todayItem, 0, 4)}
		for i, a := range as {
			if i >= 4 {
				break
			}
			name := strings.TrimSpace(a.Name)
			if name == "" {
				name = strings.TrimSpace(a.Title)
			}
			sub := alertKindCN(a.Kind)
			if a.PnlPct != 0 {
				// 触达时相对成本的涨跌：止盈为正、止损为负，读的人不必再回列表查
				sub += " · " + signedPctText(a.PnlPct)
			}
			g.Items = append(g.Items, todayItem{Title: name, Sub: sub})
		}
		groups = append(groups, g)
		total += g.Count
	}

	// ---- 2) 定投待确认：在投计划的 pending 期次 ----
	// 先补期（与 /api/dca/plans 走同一个 EnsureDCARecords），否则今天到期的期次还没生成，
	// 首页会显示「没有待办」，而进定投页才看到 3 期等着确认。
	if _, err := db.EnsureDCARecords(uid); err == nil {
		if plans, err := db.ListDCAPlans(uid); err == nil {
			g := todayGroup{Key: "dca", Label: "定投待确认", Items: make([]todayItem, 0, 4)}
			for i := range plans {
				p := plans[i]
				fillDCAPlan(&p)
				if p.Status != "active" || p.PendingCount <= 0 {
					continue
				}
				g.Count += p.PendingCount
				amt := fxToCNY(p.Amount*float64(p.PendingCount), p.Currency, cnyRate, hkdRate)
				g.Amount += amt
				if len(g.Items) < 4 {
					name := strings.TrimSpace(p.HoldingName)
					if name == "" {
						name = strings.TrimSpace(p.HoldingSymbol)
					}
					g.Items = append(g.Items, todayItem{
						Title:  name,
						Sub:    strconv.Itoa(p.PendingCount) + " 期待确认",
						Amount: amt,
					})
				}
			}
			if g.Count > 0 {
				groups = append(groups, g)
				total += g.Count
			}
		}
	}

	// ---- 3) 待还款 + 未来收入：同一张 cashflow_plans 表，同时聚合 income / expense ----
	if plans, err := db.ListCashflowPlans(uid); err == nil {
		ym := now.Format("2006-01")
		done, derr := db.ListCashflowDoneMonth(uid, ym)
		if derr != nil {
			done = nil
		}

		// 3a) 待还款（expense）：本月应还日落在「今天 + 7 天」前瞻窗口且未完成
		gRepay := todayGroup{Key: "repay", Label: "待还款", Items: make([]todayItem, 0, 4)}
		// 3b) 未来收入（income）：未来 30 天内将入账（含一次性 + 本月/下月固定入账日未完成）
		horizon30 := now.AddDate(0, 0, 30).Format("2006-01-02")
		gIncome := todayGroup{Key: "income", Label: "未来收入", Items: make([]todayItem, 0, 4)}

		for _, p := range plans {
			if p.Enabled == 0 { // 暂停的计划不参与首页待办
				continue
			}
			if p.Type != "income" && p.Type != "expense" {
				continue
			}
			if done != nil && done[p.ID] != nil {
				continue // 本月已完成（已入账/已还款）
			}

			if p.Type == "expense" {
				due, sub := false, ""
				if p.Pattern == "one_time" {
					if p.OneTimeDate != "" && p.OneTimeDate <= horizon30 {
						due, sub = true, p.OneTimeDate+" 到期"
					}
				} else {
					if p.EndDate != "" && p.EndDate < today {
						continue
					}
					d := p.DayOfMonth
					if d < 1 {
						d = 1
					}
					if last := daysInMonth(now); d > last {
						d = last
					}
					dueDay := time.Date(now.Year(), now.Month(), d, 0, 0, 0, 0, beijing)
					days := int(dueDay.Sub(todayStart).Hours() / 24)
					switch {
					case days < 0:
						due, sub = true, "每月 "+strconv.Itoa(d)+" 号 · 已逾期 "+strconv.Itoa(-days)+" 天"
					case days == 0:
						due, sub = true, "每月 "+strconv.Itoa(d)+" 号 · 今天到期"
					case days <= 7:
						due, sub = true, "每月 "+strconv.Itoa(d)+" 号 · 还有 "+strconv.Itoa(days)+" 天"
					}
				}
				if !due {
					continue
				}
				gRepay.Count++
				amt := fxToCNY(p.Amount, p.Currency, cnyRate, hkdRate)
				gRepay.Amount += amt
				if len(gRepay.Items) < 4 {
					gRepay.Items = append(gRepay.Items, todayItem{Title: strings.TrimSpace(p.Title), Sub: sub, Amount: amt})
				}
			}

			if p.Type == "income" {
				// 未来 30 天内会到的收入：一次性日期在 horizon30 之内，或月固定日的 dueDay 在 horizon30 之内
				due, sub := false, ""
				if p.Pattern == "one_time" {
					if p.OneTimeDate != "" && p.OneTimeDate > today && p.OneTimeDate <= horizon30 {
						due, sub = true, p.OneTimeDate+" 到账"
					}
				} else {
					if p.EndDate != "" && p.EndDate < today {
						continue
					}
					d := p.DayOfMonth
					if d < 1 {
						d = 1
					}
					if last := daysInMonth(now); d > last {
						d = last
					}
					// 本月 + 下月两个月的固定日都在 30 天内：取下一个 dueDay
					dueDayThis := time.Date(now.Year(), now.Month(), d, 0, 0, 0, 0, beijing)
					var dueDay time.Time
					switch {
					case dueDayThis.After(now):
						dueDay = dueDayThis
					case dueDayThis.Equal(now):
						// 今天入账（但已完成检查过，所以还没入账 = 今天稍晚）
						dueDay = dueDayThis
					default:
						dueDay = time.Date(now.Year(), now.Month()+1, d, 0, 0, 0, 0, beijing)
					}
					if !dueDay.After(now) || dueDay.Format("2006-01-02") > horizon30 {
						continue
					}
					days := int(dueDay.Sub(todayStart).Hours() / 24)
					switch {
					case days <= 1:
						due, sub = true, "每月 "+strconv.Itoa(d)+" 号 · 最近 1-2 天"
					case days <= 30:
						due, sub = true, "每月 "+strconv.Itoa(d)+" 号 · 还有 "+strconv.Itoa(days)+" 天"
					default:
						continue
					}
				}
				if !due {
					continue
				}
				gIncome.Count++
				amt := fxToCNY(p.Amount, p.Currency, cnyRate, hkdRate)
				gIncome.Amount += amt
				if len(gIncome.Items) < 4 {
					gIncome.Items = append(gIncome.Items, todayItem{Title: strings.TrimSpace(p.Title), Sub: sub, Amount: amt})
				}
			}
		}
		if gRepay.Count > 0 {
			groups = append(groups, gRepay)
			total += gRepay.Count
		}
		if gIncome.Count > 0 {
			groups = append(groups, gIncome)
			total += gIncome.Count
		}
	}

	// ---- 4) 存款到期：7 天内（含已过期）且未落袋 ----
	if ds, err := db.ListDeposits(uid); err == nil {
		g := todayGroup{Key: "maturity", Label: "存款到期", Items: make([]todayItem, 0, 4)}
		horizon := now.AddDate(0, 0, 7).Format("2006-01-02")
		for _, d := range ds {
			if d.Status != "active" || d.EndDate == "" || d.EndDate > horizon {
				continue
			}
			g.Count++
			amt := fxToCNY(d.Amount, d.Currency, cnyRate, hkdRate)
			g.Amount += amt
			if len(g.Items) < 4 {
				sub := d.EndDate + " 到期"
				if d.EndDate <= today {
					sub = "已到期 · 待确认落袋"
				}
				g.Items = append(g.Items, todayItem{Title: strings.TrimSpace(d.Name), Sub: sub, Amount: amt})
			}
		}
		if g.Count > 0 {
			groups = append(groups, g)
			total += g.Count
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"date":   today,
		"total":  total,
		"groups": groups,
	})
}

// signedPctText 带符号的百分比文本（+12.3% / -4.1%），保留一位小数。
func signedPctText(v float64) string {
	s := strconv.FormatFloat(v, 'f', 1, 64)
	if v > 0 {
		return "+" + s + "%"
	}
	return s + "%"
}
