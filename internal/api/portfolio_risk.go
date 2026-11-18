package api

// 组合级盈亏阈值（2026-11-18）
//
// 与 holdings.risk_plan 是两个层级，互不替代：
//   - risk_plan：逐只持仓的「价格」阈值（止损价 / 三档止盈 / 移动止盈 / 心理价），由技术面定价；
//   - 这里：整个组合的「盈亏」阈值（比例 + 金额），只回答「整体是不是该收手了」。
//
// 口径（同一段话也写进提醒正文，避免事后对不上账）：
//   纳入：股票 + 基金（未实现）+ 理财（累计收益）。
//   不纳入：现金 / 存款 / 负债 —— 没有成本概念，混进来会把比例稀释成看起来「很安全」。
//   已平仓持仓与已清仓理财不计：成本已不存在，算进分母会让收益率失真。
//   分母 = 证券成本（quantity × cost_price）+ 理财本金（amount − 累计收益）。
//   外币按当前汇率折 CNY；无汇率源的币种整只排除并记入 unpriced，不用内置常量硬算。
//
// 落库复用 alert_events（holding_id=0）：事件一进表，铃铛角标 / 今日待办 /
// 数据总览「需要留意」全都自动可见，不用再给前端加第二条数据链路。

import (
	"encoding/json"
	"fmt"
	"log"
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
	kindPortfolioTakeProfit = "portfolio_take_profit"
	kindPortfolioStop       = "portfolio_stop"
)

// PortfolioRiskPlan 组合级盈亏阈值方案，整块存 portfolio_settings(kind=portfolio_risk)。
// 阈值全是「可选」：只填比例就只看比例，只填金额就只看金额，都填则任一越过即触发。
type PortfolioRiskPlan struct {
	Enabled bool    `json:"enabled"`
	TPPct   float64 `json:"tp_pct"` // 止盈比例（%，相对成本），0 = 不启用
	SLPct   float64 `json:"sl_pct"` // 止损比例（%，正数存，比较时取负），0 = 不启用
	TPAmt   float64 `json:"tp_amt"` // 止盈金额阈值（CNY），0 = 不启用
	SLAmt   float64 `json:"sl_amt"` // 止损金额阈值（CNY，正数存），0 = 不启用
	// WarnRatio 预警档 = 阈值 × 该比例（默认 0.8）：-8% 时先说「接近 -10%」，
	// 不要等到硬线才第一次出现 —— 那时提醒只剩情绪价值，没有决策空间。
	WarnRatio float64 `json:"warn_ratio"`
	// Repeat once（默认，每档永久一次）| repeat（每档每天一次）
	Repeat string `json:"repeat"`
	// BaselineAt 方案最近一次保存后的首轮扫描时间。首轮只落库不外推，
	// 与 RiskPlan.BaselineAt 同因：刚设好阈值就把历史旧账按当前价推到手机是纯打扰。
	BaselineAt string `json:"baseline_at"`
	UpdatedAt  string `json:"updated_at"`
}

func defaultPortfolioRiskPlan() PortfolioRiskPlan {
	return PortfolioRiskPlan{WarnRatio: 0.8, Repeat: "once"}
}

// clampPct 百分比字段归一：负数当未设置，超上限夹到上限。
func clampPct(v, max float64) float64 {
	if v <= 0 {
		return 0
	}
	if v > max {
		return max
	}
	return round2(v)
}

// normalizePortfolioRiskPlan 校验并归一化。金额上限只做非负保护：
// 这里的金额是「盈亏到多少」的自定义线，没有业务上限可言。
func normalizePortfolioRiskPlan(p PortfolioRiskPlan) (PortfolioRiskPlan, error) {
	out := defaultPortfolioRiskPlan()
	out.Enabled = p.Enabled
	out.TPPct = clampPct(p.TPPct, 200)
	out.SLPct = clampPct(p.SLPct, 100)
	out.TPAmt = math.Max(0, round2(p.TPAmt))
	out.SLAmt = math.Max(0, round2(p.SLAmt))
	if p.WarnRatio >= 0.5 && p.WarnRatio < 1 {
		out.WarnRatio = round2(p.WarnRatio)
	}
	if p.Repeat == "repeat" {
		out.Repeat = "repeat"
	}
	out.BaselineAt = strings.TrimSpace(p.BaselineAt)
	if out.Enabled && out.TPPct <= 0 && out.SLPct <= 0 && out.TPAmt <= 0 && out.SLAmt <= 0 {
		return out, fmt.Errorf("启用组合提醒至少要设一项阈值（止盈 / 止损的比例或金额）")
	}
	return out, nil
}

// loadPortfolioRiskPlan 读当前账本的方案。读路径同样归一：手改过的越界值不参与比较。
func loadPortfolioRiskPlan(uid int64) (PortfolioRiskPlan, error) {
	payload, ok, err := db.GetSetting(settingPortfolioRisk, uid)
	if err != nil {
		return defaultPortfolioRiskPlan(), err
	}
	if !ok || strings.TrimSpace(payload) == "" {
		return defaultPortfolioRiskPlan(), nil
	}
	var p PortfolioRiskPlan
	if e := json.Unmarshal([]byte(payload), &p); e != nil {
		return defaultPortfolioRiskPlan(), nil
	}
	n, e := normalizePortfolioRiskPlan(p)
	if e != nil {
		// 存量里 enabled 但阈值全清空的脏数据：按关闭处理，别让扫描一直报错
		n.Enabled = false
	}
	return n, nil
}

// ---- 组合盈亏快照 ----

type PortfolioPnl struct {
	CostCNY   float64  `json:"cost_cny"`
	MvCNY     float64  `json:"mv_cny"`
	PnlCNY    float64  `json:"pnl_cny"`
	PnlPct    float64  `json:"pnl_pct"`
	EquityPnl float64  `json:"equity_pnl_cny"`
	WealthPnl float64  `json:"wealth_pnl_cny"`
	Holdings  int      `json:"holdings"`
	Products  int      `json:"products"`
	Skipped   int      `json:"skipped"`
	Unpriced  []string `json:"currency_unpriced"`
}

// computePortfolioPnl 一次算全组合的成本 / 市值 / 浮盈。
// 取数全部复用现有查询（不新建表、不缓存）：单账本几十只持仓，一次扫描的开销可以忽略，
// 而缓存会让「提醒里的数字」和「页面上看到的数字」各差一版。
func computePortfolioPnl(uid int64) (PortfolioPnl, error) {
	s := PortfolioPnl{Unpriced: []string{}}
	cnyRate, hkdRate, _ := market.FetchFXRates()
	unpriced := map[string]bool{}
	var eqCost, eqMv, wCost, wMv float64

	curOf := func(c string) string {
		c = strings.ToLower(strings.TrimSpace(c))
		if c == "" || c == "rmb" {
			return "cny"
		}
		return c
	}
	mark := func(c string) bool {
		if currentRateOf(c, cnyRate, hkdRate) == 0 {
			unpriced[strings.ToUpper(c)] = true
			return false
		}
		return true
	}

	hs, err := db.List(uid)
	if err != nil {
		return s, err
	}
	for _, h := range hs {
		if h.Closed || strings.EqualFold(strings.TrimSpace(h.Category), "cash") {
			continue
		}
		// 价格或成本缺失时整只跳过：按 0 算会得到「亏 100%」的假信号，
		// 这是提醒类功能最不能犯的错。
		if h.Quantity <= 0 || h.CurrentPrice <= 0 || h.CostPrice <= 0 {
			s.Skipped++
			continue
		}
		cur := curOf(h.Currency)
		if !mark(cur) {
			s.Skipped++
			continue
		}
		mv := h.Quantity * h.CurrentPrice
		cv := h.Quantity * h.CostPrice
		eqMv += fxToCNY(mv, cur, cnyRate, hkdRate)
		eqCost += fxToCNY(cv, cur, cnyRate, hkdRate)
		s.Holdings++
	}

	wps, err := db.ListWealth(uid)
	if err != nil {
		return s, err
	}
	for _, w := range wps {
		// 已清仓（archived）产品的最新快照金额被清零，本金反推失效，不计入
		if w.Archived {
			continue
		}
		_, amt, found, e := db.GetWealthLatest(w.ID)
		if e != nil || !found || amt <= 0.005 {
			s.Skipped++
			continue
		}
		cur := curOf(w.Currency)
		if !mark(cur) {
			s.Skipped++
			continue
		}
		// 累计收益与资产页同口径：手动编辑值优先，否则按每日快照累计；本金 = 金额 − 累计收益
		cum := round2(w.CumPnl)
		if cum == 0 {
			cum = round2(wealthCumPnl(w.ID))
		}
		principal := amt - cum
		if principal <= 0.005 {
			s.Skipped++
			continue
		}
		wMv += fxToCNY(amt, cur, cnyRate, hkdRate)
		wCost += fxToCNY(principal, cur, cnyRate, hkdRate)
		s.Products++
	}

	for c := range unpriced {
		s.Unpriced = append(s.Unpriced, c)
	}
	// 排序只为让推送正文稳定：map 遍历顺序随机，同一条提醒两次读到的字不一样很别扭
	sort.Strings(s.Unpriced)
	s.EquityPnl = round2(eqMv - eqCost)
	s.WealthPnl = round2(wMv - wCost)
	s.CostCNY = round2(eqCost + wCost)
	s.MvCNY = round2(eqMv + wMv)
	s.PnlCNY = round2(s.MvCNY - s.CostCNY)
	if s.CostCNY > 0.005 {
		s.PnlPct = round2(s.PnlCNY / s.CostCNY * 100)
	}
	return s, nil
}

// ---- 判定 ----

// moneyCN 把 CNY 金额写成推送里能读的形式：1 万以上用「万」，否则千分位两位小数。
// 提醒正文会同时进铃铛和钉钉/邮件，长串数字在那里读不出量级。
// 符号写在货币符之前（-¥2,291.38），不要把负号夹在 ¥ 后面 —— 那是账本里最容易读错的一处。
func moneyCN(v float64) string {
	sign := ""
	if v < 0 {
		sign, v = "-", -v
	}
	if v >= 10000 {
		return fmt.Sprintf("%s¥%.2f万", sign, v/10000)
	}
	return sign + "¥" + group2(v)
}

// group2 千分位 + 两位小数（1234.5 → 1,234.50）。
func group2(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	dot := strings.IndexByte(s, '.')
	if dot < 0 {
		dot = len(s)
	}
	ip, frac := s[:dot], s[dot:]
	var b strings.Builder
	for i, ch := range ip {
		if i > 0 && (len(ip)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	return b.String() + frac
}

// evaluatePortfolio 把「当前盈亏 vs 各阈值」翻译成待落库的事件。
// 两档（预警 / 触线）各占一个 level，去重键不同，所以「接近」和「越过」是两条独立提醒：
// 前者给决策时间，后者给执行信号。
func evaluatePortfolio(p PortfolioRiskPlan, s PortfolioPnl) []alertHit {
	if !p.Enabled || s.CostCNY <= 0.005 || s.PnlCNY == 0 {
		return nil
	}
	warn := p.WarnRatio
	if warn <= 0 || warn >= 1 {
		warn = 0.8
	}

	type cand struct {
		lv  int
		why string
	}
	better := func(c *cand, lv int, why string) {
		if lv > c.lv {
			c.lv, c.why = lv, why
		}
	}
	var tp, sl cand

	// 止盈：比例与金额任一越过即触发，取两者里更高的档
	if p.TPPct > 0 && s.PnlPct > 0 {
		switch {
		case s.PnlPct >= p.TPPct:
			better(&tp, 2, fmt.Sprintf("整体浮盈 %s，已达止盈线 %s", signedPctText(s.PnlPct), signedPctText(p.TPPct)))
		case s.PnlPct >= p.TPPct*warn:
			better(&tp, 1, fmt.Sprintf("整体浮盈 %s，接近止盈线 %s", signedPctText(s.PnlPct), signedPctText(p.TPPct)))
		}
	}
	if p.TPAmt > 0 && s.PnlCNY > 0 {
		switch {
		case s.PnlCNY >= p.TPAmt:
			better(&tp, 2, fmt.Sprintf("整体浮盈 %s，已达金额止盈线 %s", moneyCN(s.PnlCNY), moneyCN(p.TPAmt)))
		case s.PnlCNY >= p.TPAmt*warn:
			better(&tp, 1, fmt.Sprintf("整体浮盈 %s，接近金额止盈线 %s", moneyCN(s.PnlCNY), moneyCN(p.TPAmt)))
		}
	}
	// 止损：比例与金额同法，方向取负
	if p.SLPct > 0 && s.PnlPct < 0 {
		line := -p.SLPct
		switch {
		case s.PnlPct <= line:
			better(&sl, 2, fmt.Sprintf("整体浮亏 %s，已达止损线 %s", signedPctText(s.PnlPct), signedPctText(line)))
		case s.PnlPct <= line*warn:
			better(&sl, 1, fmt.Sprintf("整体浮亏 %s，接近止损线 %s", signedPctText(s.PnlPct), signedPctText(line)))
		}
	}
	if p.SLAmt > 0 && s.PnlCNY < 0 {
		loss := math.Abs(s.PnlCNY)
		switch {
		case loss >= p.SLAmt:
			better(&sl, 2, fmt.Sprintf("整体浮亏 %s，已达金额止损线 %s", moneyCN(loss), moneyCN(p.SLAmt)))
		case loss >= p.SLAmt*warn:
			better(&sl, 1, fmt.Sprintf("整体浮亏 %s，接近金额止损线 %s", moneyCN(loss), moneyCN(p.SLAmt)))
		}
	}
	if tp.lv == 0 && sl.lv == 0 {
		return nil
	}

	base := fmt.Sprintf("当前持仓成本 %s、市值 %s，浮动盈亏 %s（%s）。",
		moneyCN(s.CostCNY), moneyCN(s.MvCNY), moneyCN(s.PnlCNY), signedPctText(s.PnlPct))
	// 阈值与口径都写进正文：提醒可能被转发/几天后再看，光有数字没有口径等于没说
	var lines []string
	if p.TPPct > 0 {
		lines = append(lines, "止盈 "+signedPctText(p.TPPct))
	}
	if p.TPAmt > 0 {
		lines = append(lines, "止盈金额 "+moneyCN(p.TPAmt))
	}
	if p.SLPct > 0 {
		lines = append(lines, "止损 "+signedPctText(-p.SLPct))
	}
	if p.SLAmt > 0 {
		lines = append(lines, "止损金额 "+moneyCN(p.SLAmt))
	}
	setText := ""
	if len(lines) > 0 {
		setText = "设置：" + strings.Join(lines, " / ") + "。"
	}
	scope := "口径：股票 + 基金 + 理财；不含已平仓、现金与存款；外币按当前汇率折 CNY。"
	if len(s.Unpriced) > 0 {
		scope += fmt.Sprintf("未计价币种 %s 未计入。", strings.Join(s.Unpriced, "、"))
	}

	mkHit := func(kind string, c cand, target float64) alertHit {
		title := ""
		switch {
		case kind == kindPortfolioStop && c.lv >= 2:
			title = "组合浮亏触及止损线"
		case kind == kindPortfolioStop:
			title = "组合浮亏接近止损线"
		case c.lv >= 2:
			title = "组合浮盈触及止盈线"
		default:
			title = "组合浮盈接近止盈线"
		}
		return alertHit{
			Kind: kind, Level: c.lv, Price: 0, Target: round2(target),
			PnlPct: round2(s.PnlPct), NetAmount: round2(s.PnlCNY),
			Title: title, Body: c.why + "。" + base + setText + scope,
		}
	}

	var hits []alertHit
	// 亏损优先：同一轮里两条都命中时，先落库的是更该被看见的那条
	if sl.lv > 0 {
		hits = append(hits, mkHit(kindPortfolioStop, sl, p.SLPct))
	}
	if tp.lv > 0 {
		hits = append(hits, mkHit(kindPortfolioTakeProfit, tp, p.TPPct))
	}
	return hits
}

// ---- 扫描与落库 ----

// ScanPortfolioAlerts 评估一个账本的整体盈亏。dryRun 只算不落库（联调与验证用）。
// 与 ScanAlerts 分开导出：前者逐只持仓价格，后者组合盈亏，两者由同一轮扫描串联。
func ScanPortfolioAlerts(uid int64, dryRun bool) ([]gin.H, error) {
	if uid <= 0 {
		return nil, fmt.Errorf("缺少账本上下文")
	}
	plan, err := loadPortfolioRiskPlan(uid)
	if err != nil {
		return nil, err
	}
	if !plan.Enabled {
		return nil, nil
	}
	snap, err := computePortfolioPnl(uid)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	day := now.Format("2006-01-02")
	out := []gin.H{}
	firstRun := plan.BaselineAt == ""
	for _, hit := range evaluatePortfolio(plan, snap) {
		// 去重键必须带 uid：ux_alert_dedupe 是**单列全局唯一索引**，组合事件的
		// holding_id 恒为 0，不同账本会撞到同一个键，后落库的那条被静默丢弃。
		dedupe := fmt.Sprintf("p%d:%s:%d", uid, hit.Kind, hit.Level)
		if plan.Repeat == "repeat" {
			dedupe += ":" + day
		}
		row := gin.H{
			"holding_id": 0, "name": "组合", "symbol": "", "kind": hit.Kind,
			"level": hit.Level, "price": 0.0, "target": hit.Target,
			"pnl_pct": hit.PnlPct, "cost": round2(snap.CostCNY), "net_amount": hit.NetAmount,
			"title": hit.Title, "body": hit.Body, "scope": "portfolio",
		}
		if dryRun {
			out = append(out, row)
			continue
		}
		ae := &db.AlertEvent{
			UserID: uid, HoldingID: 0, Symbol: "", Name: "组合",
			Kind: hit.Kind, Level: hit.Level, Price: 0, Target: hit.Target,
			Cost: round2(snap.CostCNY), PnlPct: hit.PnlPct, FeePct: 0, NetAmount: hit.NetAmount,
			Title: hit.Title, Body: hit.Body, DedupeKey: dedupe, CreatedAt: now.Format("2006-01-02 15:04:05"),
		}
		inserted, ierr := db.InsertAlert(ae)
		row["inserted"] = inserted
		if ierr != nil {
			row["error"] = ierr.Error()
			out = append(out, row)
			continue
		}
		if !inserted {
			row["skipped"] = "duplicated"
			out = append(out, row)
			continue
		}
		if firstRun {
			// 基线轮：站内可见，不外推（见 PortfolioRiskPlan.BaselineAt）
			_ = db.SetAlertPushState(ae.ID, "baseline")
		} else {
			pushAlertToChannels(ae)
		}
		out = append(out, row)
	}
	// 基线时间写一次即可；没有命中也要写，否则「设好阈值 → 首次真触线」会被当成基线吞掉
	if firstRun && !dryRun {
		plan.BaselineAt = now.Format("2006-01-02 15:04:05")
		if raw, e := json.Marshal(plan); e == nil {
			_ = db.SaveSetting(settingPortfolioRisk, string(raw), uid)
		}
	}
	return out, nil
}

// portfolioRiskStatus GET /api/portfolio/risk
// 只读预览：当前方案 + 实时组合盈亏 + 若此刻扫描会命中什么（不落库）。
// 设置页与联调共用这个接口，前端不必自己按另一套口径重算一遍盈亏。
func portfolioRiskStatus(c *gin.Context) {
	uid := currentUserID(c)
	plan, err := loadPortfolioRiskPlan(uid)
	if err != nil {
		log.Printf("[portfolio-pnl] uid=%d 读取方案失败: %v", uid, err)
	}
	snap, perr := computePortfolioPnl(uid)
	if perr != nil {
		c.JSON(500, gin.H{"error": perr.Error()})
		return
	}
	hits := []gin.H{}
	for _, h := range evaluatePortfolio(plan, snap) {
		hits = append(hits, gin.H{"kind": h.Kind, "level": h.Level, "title": h.Title, "body": h.Body})
	}
	c.JSON(200, gin.H{"plan": plan, "pnl": snap, "preview": hits})
}
