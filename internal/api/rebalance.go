package api

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"
	"portfolio/internal/mcp"

	"github.com/gin-gonic/gin"
)

// ===== 资产再平衡（2026-10-27 重新引入）=====
// 口径（经确认）：只到 股票 / 基金 / 理财 / 现金 四大类，不再细分到 asset_type 行业标签。
// 理由：再平衡管的是资产大类纪律（权益/固收/现金的比例），行业层调仓属于择时，不该混进来；
// 且四类能直接映射到 holdings.category + wealth_products + cash_accounts，无需额外打标。
//
// 计算约定：
//   total  = 股票 + 基金 + 理财 + 现金（全部折 CNY，均取现值）
//   weight = 该类市值 / total × 100
//   drift  = weight − target（正=超配，负=低配）
//   amount = drift/100 × total（正=应卖出，负=应买入）
// 目标权重合计恒为 100%，所以 Σamount 恒为 0 —— 卖出所得正好够买低配，天然配平。
// 负债不参与：负债不是可配置资产，用净资产做分母会让「现金占净资产」失真。
const (
	rbClassStock  = "stock"
	rbClassFund   = "fund"
	rbClassWealth = "wealth"
	rbClassCash   = "cash"
)

// rbClassOrder 决定前端展示顺序：先权益（股票→基金），再固收（理财），最后流动资金（现金）。
var rbClassOrder = []string{rbClassStock, rbClassFund, rbClassWealth, rbClassCash}

var rbClassLabels = map[string]string{
	rbClassStock:  "股票",
	rbClassFund:   "基金",
	rbClassWealth: "理财",
	rbClassCash:   "现金",
}

// rbDefaultDriftAlert 默认调仓 / 提醒阈值（百分点）。
// 2026-10-27 起「是否调仓」与「是否提醒」合并为同一个参数：此前 TOL 硬编码 0.5、
// drift_alert 只用于提醒，导致文案说「超过 5pp」却把 3pp 的项也列进清单，自相矛盾。
const rbDefaultDriftAlert = 1.0

// rbDefaultExp 各类资产的默认预期年化收益（%）。
// 只是「配置参数」不是行情，用户可在设置里改；首次访问时落库，之后一律以库为准。
var rbDefaultExp = map[string]float64{
	rbClassStock:  8.0,
	rbClassFund:   6.0,
	rbClassWealth: 2.8,
	rbClassCash:   1.2,
}

// rbDefaultVol 各类资产的默认预期年化波动率（%）。
// 注意：组合波动率按权重简单加权，未计相关性 —— 会系统性高估（权益与固收相关性低时
// 实际组合波动明显更小）。因此只作「方向参考」，不参与任何结论判断。
var rbDefaultVol = map[string]float64{
	rbClassStock:  22.0,
	rbClassFund:   16.0,
	rbClassWealth: 2.0,
	rbClassCash:   0.6,
}

// rbTargetItem 单个类别的配置：目标权重 + 该类预期年化收益 + 预期年化波动率。
// key 只允许四大类固定值（后端校验，防脏数据）。
type rbTargetItem struct {
	Key string  `json:"key"`
	Pct float64 `json:"pct"`
	Exp float64 `json:"exp"` // 预期年化收益 %
	Vol float64 `json:"vol"` // 预期年化波动率 %
}

// rbConfig 再平衡配置，整体作为 settings kind = rebalance_targets 的 payload 存储。
type rbConfig struct {
	Targets    []rbTargetItem `json:"targets"`
	Freq       string         `json:"freq"`        // monthly | quarterly | manual
	DriftAlert float64        `json:"drift_alert"` // 偏离 / 提醒阈值（百分点）
	// GoalPct 用户自设的年度收益目标（%）。nil = 不设，页面只看配置内生的预期收益。
	GoalPct   *float64 `json:"goal_pct"`
	UpdatedAt string   `json:"updated_at"`
}

// defaultRebalanceConfig 默认偏保守的 15/30/40/15：股票+基金=45 权益，理财 40 固收，现金 15 弹药。
// 首次访问时落库。之所以不用经典的 60/40：本应用的用户资产以理财为主，
// 默认若把权益给到 60%，一进页面就会显示「赎回 6 万理财去买股票」，容易被当成错误建议。
// 页面会在配置仍为默认值时提示用户自行调整。
func defaultRebalanceConfig() rbConfig {
	out := rbConfig{Freq: "monthly", DriftAlert: rbDefaultDriftAlert}
	for _, k := range rbClassOrder {
		pct := map[string]float64{
			rbClassStock: 15, rbClassFund: 30, rbClassWealth: 40, rbClassCash: 15,
		}[k]
		out.Targets = append(out.Targets, rbTargetItem{
			Key: k, Pct: pct, Exp: rbDefaultExp[k], Vol: rbDefaultVol[k],
		})
	}
	return out
}

// normalizeRebalanceConfig 校验并归一化：只保留四大类、去重、百分比夹到 [0,100]、
// 合计必须为 100（容差 0.01，防 33.33×3+0.01 这类浮点误差）。
func normalizeRebalanceConfig(in rbConfig) (rbConfig, error) {
	out := defaultRebalanceConfig()
	seen := map[string]bool{}
	pcts := map[string]float64{}
	exps := map[string]float64{}
	vols := map[string]float64{}
	sum, expSum, volSum := 0.0, 0.0, 0.0

	// clampF 把异常值收进 [lo, hi]：NaN / 负数一律按 lo 处理，避免脏数据把收益算成天文数字。
	clampF := func(v, lo, hi float64) float64 {
		if math.IsNaN(v) || v < lo {
			return lo
		}
		if v > hi {
			return hi
		}
		return v
	}

	for _, t := range in.Targets {
		k := strings.ToLower(strings.TrimSpace(t.Key))
		if _, ok := rbClassLabels[k]; !ok {
			return out, errBadRebalance("未知的资产类别：" + t.Key)
		}
		if seen[k] {
			continue
		}
		seen[k] = true
		pcts[k] = math.Round(clampF(t.Pct, 0, 100)*100) / 100
		sum += pcts[k]
		exps[k] = math.Round(clampF(t.Exp, 0, 50)*10) / 10
		expSum += exps[k]
		vols[k] = math.Round(clampF(t.Vol, 0, 80)*10) / 10
		volSum += vols[k]
	}
	if math.Abs(sum-100) > 0.01 {
		return out, errBadRebalance("目标权重合计必须为 100%（当前 " + trimFloat(sum) + "%）")
	}
	// 整组全 0 说明是「加字段之前存下的旧配置」或用户清空，回落默认假设 ——
	// 不逐项判断，因为 0 也是合法输入（例如把现金的预期收益设成 0）。
	if expSum == 0 {
		for k := range exps {
			exps[k] = rbDefaultExp[k]
		}
	}
	if volSum == 0 {
		for k := range vols {
			vols[k] = rbDefaultVol[k]
		}
	}

	out.Targets = make([]rbTargetItem, 0, 4)
	for _, k := range rbClassOrder {
		out.Targets = append(out.Targets, rbTargetItem{Key: k, Pct: pcts[k], Exp: exps[k], Vol: vols[k]})
	}
	switch strings.ToLower(strings.TrimSpace(in.Freq)) {
	case "monthly", "quarterly", "manual":
		out.Freq = strings.ToLower(strings.TrimSpace(in.Freq))
	default:
		out.Freq = "monthly"
	}
	if in.DriftAlert >= 0.5 && in.DriftAlert <= 50 {
		out.DriftAlert = math.Round(in.DriftAlert*10) / 10
	}
	if out.DriftAlert < 0.5 {
		out.DriftAlert = rbDefaultDriftAlert
	}
	// 年度收益目标：nil 或非正数视为不设；上限 50% 防手滑多打一个 0。
	if in.GoalPct != nil {
		g := *in.GoalPct
		if !math.IsNaN(g) && g > 0 && g <= 50 {
			g = math.Round(g*100) / 100
			out.GoalPct = &g
		}
	}
	out.UpdatedAt = time.Now().In(beijing).Format("2006-01-02 15:04:05")
	return out, nil
}

// rbErr 便于 handler 区分「用户输入问题(400)」与「服务端问题(500)」。
type rbErr string

func (e rbErr) Error() string { return string(e) }
func errBadRebalance(msg string) error { return rbErr(msg) }

func trimFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// loadRebalanceConfig 读配置；无记录或解析失败一律回退默认（不阻塞页面）。
func loadRebalanceConfig(uid int64) rbConfig {
	payload, ok, err := db.GetSetting(settingRebalanceTargets, uid)
	if err != nil || !ok {
		return defaultRebalanceConfig()
	}
	var cfg rbConfig
	if e := json.Unmarshal([]byte(payload), &cfg); e != nil {
		return defaultRebalanceConfig()
	}
	// 存量配置可能缺字段：补齐类别、修正合计
	norm, e := normalizeRebalanceConfig(cfg)
	if e != nil {
		return defaultRebalanceConfig()
	}
	norm.UpdatedAt = cfg.UpdatedAt // 保留原始更新时间，避免每次读取都刷新
	return norm
}

// rbBucket 单个类别的实测结果，直接作为 API 输出单元。
type rbBucket struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	MarketValue float64 `json:"market_value"` // 折 CNY
	Weight      float64 `json:"weight"`       // 实际占比 %
	Target      float64 `json:"target"`       // 目标占比 %
	Exp         float64 `json:"exp"`          // 该类预期年化收益 %
	Vol         float64 `json:"vol"`          // 该类预期年化波动率 %
	Drift       float64 `json:"drift"`        // 实际 − 目标
	Amount      float64 `json:"amount"`       // 偏离金额（正=卖出，负=买入）
	// Contrib 收益影响（元/年）= (实际权重 − 目标权重) × 总市值 × 该类预期年化。
	// 四类相加恒等于组合的「超额收益金额」—— 因此能直接回答「这一类拖累了多少收益」。
	Contrib float64 `json:"contrib"`
	Action  string  `json:"action"` // sell | buy | none
	Count   int     `json:"count"`  // 包含几只/几笔
}

// rbSnapshot 一次计算的完整结果：四类明细 + 总市值 + 收益 / 风险聚合。
// 收益三项（目标 / 实际 / 超额）都是「权重 × 各类预期年化」的加权结果，
// 没有复利、税费、申赎费调整 —— 是配置层的期望值，不是对未来的预测。
type rbSnapshot struct {
	Total     float64
	Buckets   []rbBucket
	RetTarget float64 // 目标配置加权年化 %
	RetActual float64 // 实际配置加权年化 %
	VolTarget float64 // 目标配置加权波动 %（简单加权，忽略相关性）
	VolActual float64 // 实际配置加权波动 %
	ExcessPct float64 // 超额收益率（pp）= 实际 − 目标
	TgtAmt    float64 // 目标配置预期年化收益（元/年）
	CurAmt    float64 // 实际配置预期年化收益（元/年）
	ExcessAmt float64 // 超额收益金额（元/年）
	GoalPct   *float64
	GoalAmt   *float64
	GapAmt    *float64 // 收益目标 − 目标配置预期（正数=目标配置达不到你的目标）
	Pending   []rbBucket
	Need      float64 // 待调整金额：Σ|amount| / 2（买卖两侧等额，一半才是真正要动的钱）
	// 日常开销账户（cash_accounts.excluded=1）不参与口径，这里只记录被剔除的规模，
	// 供页面明示「现金为什么比账户页少」——不透明的话用户会以为算漏了。
	CashExcludedN   int
	CashExcludedAmt float64
}

// computeRebalance 按四大类聚合市值并计算偏离与收益口径。
// 输出顺序固定 rbClassOrder。
//
// 容差语义（2026-10-27 修正）：|drift| <= cfg.DriftAlert 时 Action 记为 none（不进调整清单），
// 但 Amount 仍然保留 drift×total。此前把金额一并清零，会让 Σamount 不再为 0，
// 表格明明「买卖配平」却对不上账；保留金额则每行都等于 drift×总市值，可逐行验算。
func computeRebalance(uid int64, cfg rbConfig) rbSnapshot {
	cnyRate, hkdRate, _ := market.FetchFXRates()
	mv := map[string]float64{}
	cnt := map[string]int{}
	var snapExclN int
	var snapExclAmt float64

	// 1) 股票 / 基金：按 holdings.category 分流（closed=0 才算在持）
	hs, _ := db.List(uid)
	for _, h := range hs {
		if h.Closed {
			continue // 已清仓标的市值已归零，不参与配置
		}
		v := enrich(h, uid)
		cmv := fxToCNY(v.MarketValue, h.Currency, cnyRate, hkdRate)
		if cmv == 0 {
			continue
		}
		key := rbClassFund
		if strings.EqualFold(strings.TrimSpace(h.Category), "stock") {
			key = rbClassStock
		}
		mv[key] += cmv
		cnt[key]++
	}

	// 2) 理财：最新快照金额（archived 已清仓归档，不再计入）
	if wps, e := db.ListWealth(uid); e == nil {
		for _, w := range wps {
			if w.Archived {
				continue
			}
			_, amt, found, _ := db.GetWealthLatest(w.ID)
			if !found || amt == 0 {
				continue
			}
			mv[rbClassWealth] += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
			cnt[rbClassWealth]++
		}
	}

	// 3) 现金：全部子账户余额，但**日常开销账户（excluded）不参与**。
	//    生活费不是「可配置资产」：既不该算作超配的现金（否则会建议把下个月的开销转出去），
	//    也不该计入总市值分母（否则股票/基金的低配会被系统性夸大）。
	if cs, e := db.ListCash(uid); e == nil {
		for _, cc := range cs {
			if cc.Amount == 0 {
				continue
			}
			amt := fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
			if cc.Excluded {
				snapExclN++
				snapExclAmt += amt
				continue
			}
			mv[rbClassCash] += amt
			cnt[rbClassCash]++
		}
	}

	total := 0.0
	for _, k := range rbClassOrder {
		total += mv[k]
	}
	byKey := map[string]rbTargetItem{}
	for _, t := range cfg.Targets {
		byKey[t.Key] = t
	}
	tol := cfg.DriftAlert
	if tol < 0.5 {
		tol = rbDefaultDriftAlert
	}

	snap := rbSnapshot{Total: round2(total)}
	snap.CashExcludedN = snapExclN
	snap.CashExcludedAmt = round2(snapExclAmt)
	snap.Buckets = make([]rbBucket, 0, len(rbClassOrder))
	for _, k := range rbClassOrder {
		t := byKey[k]
		b := rbBucket{
			Key:         k,
			Label:       rbClassLabels[k],
			MarketValue: round2(mv[k]),
			Target:      t.Pct,
			Exp:         t.Exp,
			Vol:         t.Vol,
			Count:       cnt[k],
		}
		// 金额与收益影响一律用「未舍入」的权重 / 偏离计算，只对展示值 round2。
		// 若拿 round2 后的 Drift 再算金额，每类会被放大 up to 0.005pp×总市值（约 15 元），
		// 四类累积后 Σamount 出现几十元的假残差，表尾「买卖配平」就对不上了。
		rawWeight := 0.0
		rawDrift := 0.0
		if total > 0 {
			rawWeight = mv[k] / total * 100
			rawDrift = rawWeight - t.Pct
			b.Weight = round2(rawWeight)
			b.Drift = round2(rawDrift)
			b.Amount = round2(rawDrift / 100 * total)
			b.Contrib = round2(rawDrift / 100 * total * t.Exp / 100)
		}
		switch {
		case b.Drift > tol:
			b.Action = "sell"
		case b.Drift < -tol:
			b.Action = "buy"
		default:
			b.Action = "none"
		}
		snap.Buckets = append(snap.Buckets, b)

		snap.RetTarget += t.Pct / 100 * t.Exp
		snap.RetActual += rawWeight / 100 * t.Exp
		snap.VolTarget += t.Pct / 100 * t.Vol
		snap.VolActual += rawWeight / 100 * t.Vol
		if b.Action != "none" {
			snap.Pending = append(snap.Pending, b)
			snap.Need += math.Abs(b.Amount)
		}
	}
	snap.Need = round2(snap.Need / 2)
	// 金额必须用「未舍入」的收益率折算：先 round2 到 3.48 再乘总市值，会把 0.0035pp 的
	// 差额放大成 8 元的假误差，表尾「收益影响合计」与 KPI 的「超额收益金额」就差上了。
	rawRetT, rawRetA := snap.RetTarget, snap.RetActual
	snap.RetTarget = round2(rawRetT)
	snap.RetActual = round2(rawRetA)
	snap.VolTarget = round2(snap.VolTarget)
	snap.VolActual = round2(snap.VolActual)
	snap.ExcessPct = round2(rawRetA - rawRetT)
	snap.TgtAmt = round2(total * rawRetT / 100)
	snap.CurAmt = round2(total * rawRetA / 100)
	snap.ExcessAmt = round2(total * (rawRetA - rawRetT) / 100)

	if cfg.GoalPct != nil {
		gp := *cfg.GoalPct
		ga := round2(total * gp / 100)
		gap := round2(ga - snap.TgtAmt)
		snap.GoalPct = &gp
		snap.GoalAmt = &ga
		snap.GapAmt = &gap
	}
	return snap
}

// rbLog 对外输出的历史记录（JSON 字段名与 db 层保持前端友好）。
type rbLogOut struct {
	ID         int64          `json:"id"`
	Date       string         `json:"date"`
	TotalCNY   float64        `json:"total_cny"`
	Targets    []rbTargetItem `json:"targets"`
	Actual     []rbTargetItem `json:"actual"`
	Actions    []rbActionItem `json:"actions"`
	MaxDrift   float64        `json:"max_drift"`
	// 收益快照：回看时用的是「当时存下的假设」，不是今天的配置假设。
	RetTarget float64 `json:"ret_target"`
	RetActual float64 `json:"ret_actual"`
	VolTarget float64 `json:"vol_target"`
	VolActual float64 `json:"vol_actual"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at"`
}

type rbActionItem struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Action string  `json:"action"`
	Amount float64 `json:"amount"`
}

func toRebalanceLogOut(l db.RebalanceLog) rbLogOut {
	o := rbLogOut{
		ID:        l.ID,
		Date:      l.Date,
		TotalCNY:  l.TotalCNY,
		MaxDrift:  l.MaxDrift,
		RetTarget: l.RetTarget,
		RetActual: l.RetActual,
		VolTarget: l.VolTarget,
		VolActual: l.VolActual,
		Note:      l.Note,
		CreatedAt: l.CreatedAt,
	}
	_ = json.Unmarshal([]byte(l.TargetsJSON), &o.Targets)
	_ = json.Unmarshal([]byte(l.ActualJSON), &o.Actual)
	_ = json.Unmarshal([]byte(l.ActionsJSON), &o.Actions)
	if o.Targets == nil {
		o.Targets = []rbTargetItem{}
	}
	if o.Actual == nil {
		o.Actual = []rbTargetItem{}
	}
	if o.Actions == nil {
		o.Actions = []rbActionItem{}
	}
	return o
}

// rebalancePayload 组装再平衡快照（= GET /api/rebalance 的响应体）。
// 抽成独立函数是为了让内置 AI 助手 / MCP 工具复用同一份计算与字段：
// 两套实现各算一遍必然会口径漂移，而本口径的红线是 Σamount=0、Σcontrib=超额收益。
func rebalancePayload(uid int64) map[string]interface{} {
	cfg := loadRebalanceConfig(uid)
	snap := computeRebalance(uid, cfg)

	// 最大偏离（按绝对值取最大；全达标时返回 nil，前端显示「已在目标区间」）
	var maxDrift *rbBucket
	for i := range snap.Buckets {
		b := snap.Buckets[i]
		if b.Action == "none" {
			continue
		}
		if maxDrift == nil || math.Abs(b.Drift) > math.Abs(maxDrift.Drift) {
			maxDrift = &snap.Buckets[i]
		}
	}

	// returns 单独成组：收益三项与「比例」是两套口径，混在顶层容易和 weight 混淆。
	returns := gin.H{
		"ret_target": snap.RetTarget,
		"ret_actual": snap.RetActual,
		"tgt_amt":    snap.TgtAmt,
		"cur_amt":    snap.CurAmt,
		"excess_pct": snap.ExcessPct,
		"excess_amt": snap.ExcessAmt,
		"vol_target": snap.VolTarget,
		"vol_actual": snap.VolActual,
		"goal_pct":   snap.GoalPct,
		"goal_amt":   snap.GoalAmt,
		"gap_amt":    snap.GapAmt,
	}
	resp := gin.H{
		"total_cny":     snap.Total,
		"buckets":       snap.Buckets,
		"config":        cfg,
		"max_drift":     maxDrift,
		"returns":       returns,
		"pending_count": len(snap.Pending),
		"need_cny":      snap.Need,
		// 已剔除的日常开销账户规模：页面必须显示，否则用户会以为现金算漏了
		"cash_excluded_n":   snap.CashExcludedN,
		"cash_excluded_amt": snap.CashExcludedAmt,
	}
	if l, ok, _ := db.LastRebalanceLog(uid); ok {
		out := toRebalanceLogOut(*l)
		resp["last_log"] = out
		days := daysBetweenDates(l.Date, time.Now().In(beijing).Format("2006-01-02"))
		resp["days_since"] = days
		interval := rbIntervalDays(cfg.Freq)
		resp["interval_days"] = interval
		resp["overdue"] = interval > 0 && days > interval
	} else {
		resp["last_log"] = nil
		resp["days_since"] = -1
		resp["interval_days"] = rbIntervalDays(cfg.Freq)
		resp["overdue"] = true
	}
	return resp
}

// ---------------------------------------------------------------------------
// AI 助手 / MCP 接入
// ---------------------------------------------------------------------------

// rebalanceOverview GET /api/rebalance
// 一次返回前端所需全部数据：配置 + 实测四类 + 最大偏离 + 上次记录距今。
func rebalanceOverview(c *gin.Context) {
	c.JSON(http.StatusOK, rebalancePayload(currentUserID(c)))
}

// init 把再平衡查询注入 mcp 包（内置 AI 助手通过 mcp.ChatToolDefs 拿到 get_rebalance）。
// 方向是 api → mcp，与既有的 aichat 依赖一致；mcp 侧只声明函数变量，不反向 import api。
func init() {
	mcp.RebalanceProvider = func(uid int64) (map[string]interface{}, error) {
		if uid <= 0 {
			return nil, errors.New("无效用户")
		}
		return rebalanceForAI(uid), nil
	}
}

// rebalanceForAI 把完整响应裁剪成「模型够用且不啰嗦」的形状：
// 去掉 config 的原始 targets 与 last_log 的整段历史快照（几十行 JSON 会挤占上下文且与问题无关），
// 只保留四类明细 + 收益三项 + 待调整 + 距上次再平衡。
// 金额一律人民币元；drift/weight/target 为百分比，amount 正=应卖出、负=应买入，Σamount 恒为 0。
func rebalanceForAI(uid int64) map[string]interface{} {
	full := rebalancePayload(uid)
	out := map[string]interface{}{
		"total_cny":         full["total_cny"],
		"buckets":           full["buckets"],
		"returns":           full["returns"],
		"pending_count":     full["pending_count"],
		"need_cny":          full["need_cny"],
		"days_since":        full["days_since"],
		"interval_days":     full["interval_days"],
		"overdue":           full["overdue"],
		"cash_excluded_n":   full["cash_excluded_n"],
		"cash_excluded_amt": full["cash_excluded_amt"],
		"unit":              "金额=人民币元；weight/target/drift 与 returns 中带 pct 的字段=百分比(pp)；drift>0 为超配(应卖出)，amount>0 为卖出、<0 为买入，四类 amount 相加恒为 0",
	}
	if cfg, ok := full["config"].(rbConfig); ok {
		out["freq"] = cfg.Freq
		out["drift_alert"] = cfg.DriftAlert
		out["config_updated_at"] = cfg.UpdatedAt
	}
	if ll, ok := full["last_log"]; ok && ll != nil {
		if v, isOut := ll.(rbLogOut); isOut {
			out["last_rebalance_date"] = v.Date
			out["last_rebalance_ret_actual"] = v.RetActual
			out["last_rebalance_ret_target"] = v.RetTarget
		}
	}
	return out
}

// rbIntervalDays 频率对应的建议间隔天数（manual=0 表示不按时间提醒）。
func rbIntervalDays(freq string) int {
	switch freq {
	case "monthly":
		return 30
	case "quarterly":
		return 91
	default:
		return 0
	}
}

// rebalanceLogPost POST /api/rebalance/log
// 把「本次看到的配置 + 勾选的行动」存一份快照。目标和实际都由服务端重算，
// 不接受前端传入的金额——避免用户改了页面状态后存进不一致的历史。
func rebalanceLogPost(c *gin.Context) {
	uid := currentUserID(c)
	var req struct {
		Actions []rbActionItem `json:"actions"` // 只取勾选的类别，金额仍以服务端算出的为准
		Note    string         `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)

	cfg := loadRebalanceConfig(uid)
	snap := computeRebalance(uid, cfg)
	total := snap.Total
	if total <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "组合市值为 0，暂无可记录的再平衡"})
		return
	}

	// 勾选集合：未传时视为全部偏离项都执行
	picked := map[string]bool{}
	for _, a := range req.Actions {
		picked[strings.ToLower(strings.TrimSpace(a.Key))] = true
	}
	actions := make([]rbActionItem, 0, 4)
	targets := make([]rbTargetItem, 0, 4)
	actual := make([]rbTargetItem, 0, 4)
	maxDrift := 0.0
	for _, b := range snap.Buckets {
		// 目标项连同期收益假设一起存：回看时要能回答「当时按什么假设算出 4.30%」。
		targets = append(targets, rbTargetItem{Key: b.Key, Pct: b.Target, Exp: b.Exp, Vol: b.Vol})
		actual = append(actual, rbTargetItem{Key: b.Key, Pct: b.Weight})
		if math.Abs(b.Drift) > math.Abs(maxDrift) {
			maxDrift = b.Drift
		}
		if b.Action == "none" {
			continue
		}
		if len(picked) > 0 && !picked[b.Key] {
			continue
		}
		actions = append(actions, rbActionItem{Key: b.Key, Label: b.Label, Action: b.Action, Amount: b.Amount})
	}
	if len(actions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有勾选任何调整项，无需记录"})
		return
	}

	tj, _ := json.Marshal(targets)
	aj, _ := json.Marshal(actual)
	acj, _ := json.Marshal(actions)
	log := db.RebalanceLog{
		UserID:      uid,
		Date:        time.Now().In(beijing).Format("2006-01-02"),
		TotalCNY:    total,
		TargetsJSON: string(tj),
		ActualJSON:  string(aj),
		ActionsJSON: string(acj),
		MaxDrift:    round2(maxDrift),
		RetTarget:   snap.RetTarget,
		RetActual:   snap.RetActual,
		VolTarget:   snap.VolTarget,
		VolActual:   snap.VolActual,
		Note:        strings.TrimSpace(req.Note),
	}
	id, err := db.CreateRebalanceLog(&log)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	log.ID = id
	c.JSON(http.StatusOK, gin.H{"ok": true, "log": toRebalanceLogOut(log)})
}

// rebalanceHistoryGet GET /api/rebalance/history?limit=24
func rebalanceHistoryGet(c *gin.Context) {
	uid := currentUserID(c)
	limit := 24
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	logs, err := db.ListRebalanceLogs(uid, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]rbLogOut, 0, len(logs))
	for _, l := range logs {
		out = append(out, toRebalanceLogOut(l))
	}
	// 按日期升序输出交给前端反转也行；这里保持「最近的在前」与 db 一致
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date > out[j].Date })
	c.JSON(http.StatusOK, gin.H{"logs": out})
}

// rebalanceLogDelete DELETE /api/rebalance/log/:id
func rebalanceLogDelete(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id 非法"})
		return
	}
	if e := db.DeleteRebalanceLog(id, uid); e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
