package db

import (
	"math"
	"strings"
	"time"
)

// ---- 收支语义分类（fin category）----
// 与流水「操作类型 type」（manual/dividend/cf_income…表示钱怎么动的）不同，
// category 表达「这是什么钱」：工资 / 消费 / 资本开支 / 投资分红……
// 分三组：
//   income  收入类——计入月度/年度收入与被动收入；
//   expense 支出类——计入月度/年度支出；
//   neutral 中性类——投资活动（存入/赎回）与内部划转（转账）/融资借贷，
//           不计入收入支出，财务页单独列「投资活动现金流」小计。
const (
	// 收入类
	CatSalary    = "salary"     // 工资薪金
	CatBusiness  = "business"   // 经营收入
	CatInvestDiv = "invest_div" // 投资分红
	CatInvestInt = "invest_int" // 投资利息（含存款/理财派息）
	CatGain      = "gain"       // 已落袋投资收益（减仓/平仓实现的盈利）
	CatOtherIn   = "other_in"   // 其他收入

	// 支出类
	CatLiving     = "living"     // 日常消费
	CatHousing    = "housing"    // 居住支出（房租/物业/水电）
	CatCapex      = "capex"      // 资本开支（大额耐用购置：家电/数码/车辆）
	CatDebt       = "debt"       // 负债偿还（房贷月供/信用卡还款）
	CatTax        = "tax"        // 税费
	CatInsurance  = "insurance"  // 保险保障
	CatEduHealth  = "edu_health" // 教育医疗
	CatFee        = "fee"        // 投资费用（手续费/佣金）
	CatOtherOut   = "other_out"  // 其他支出

	// 中性类（不计收支）
	CatInvest    = "invest"    // 投资活动（加仓/减仓/定投/理财申赎/存款本息本金）
	CatTransfer  = "transfer"  // 内部划转（子账户间转账）
	CatFinancing = "financing" // 融资借贷（借入/贷款）
)

// FinCatDef 是内置分类定义（前端另有一份同款 JS 常量，改这里同步改 web/app.js FIN_CATS）。
type FinCatDef struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Dir   string `json:"dir"` // income | expense | neutral
}

// BuiltinFinCats 内置分类全集（顺序即选择器展示顺序）。
var BuiltinFinCats = []FinCatDef{
	{CatSalary, "工资薪金", "income"},
	{CatBusiness, "经营收入", "income"},
	{CatInvestDiv, "投资分红", "income"},
	{CatInvestInt, "投资利息", "income"},
	{CatGain, "落袋收益", "income"},
	{CatOtherIn, "其他收入", "income"},
	{CatLiving, "日常消费", "expense"},
	{CatHousing, "居住支出", "expense"},
	{CatCapex, "资本开支", "expense"},
	{CatDebt, "负债偿还", "expense"},
	{CatTax, "税费", "expense"},
	{CatInsurance, "保险保障", "expense"},
	{CatEduHealth, "教育医疗", "expense"},
	{CatFee, "投资费用", "expense"},
	{CatOtherOut, "其他支出", "expense"},
	{CatInvest, "投资活动", "neutral"},
	{CatTransfer, "内部划转", "neutral"},
	{CatFinancing, "融资借贷", "neutral"},
}

var builtinFinCatSet = func() map[string]FinCatDef {
	m := make(map[string]FinCatDef, len(BuiltinFinCats))
	for _, c := range BuiltinFinCats {
		m[c.Key] = c
	}
	return m
}()

// IsKnownFinCat 判断是否为内置分类 key。
func IsKnownFinCat(key string) bool {
	_, ok := builtinFinCatSet[key]
	return ok
}

// FinCatDir 返回分类方向（income/expense/neutral）；未知 key 按 neutral 处理。
func FinCatDir(key string) string {
	if c, ok := builtinFinCatSet[key]; ok {
		return c.Dir
	}
	return "neutral"
}

// autoCategoryByType 按流水操作类型推导语义分类（写流水时 category 为空即用此默认值）。
// delta 仅用于 manual 类按方向兜底；note 参与 manual 的关键词启发式（存量回填同款规则）。
func autoCategoryByType(typ string, delta float64, note string) string {
	switch typ {
	case "dividend", "mcp_dividend":
		return CatInvestDiv
	case "fee":
		return CatFee
	case "interest", "deposit_interest":
		return CatInvestInt
	case "adjust_buy", "adjust_sell", "dca_buy", "mcp_buy", "mcp_sell":
		return CatInvest
	case "wealth_deposit", "wealth_redeem", "wealth_clear", "wealth_reverse", "mcp_subscribe", "mcp_redeem":
		return CatInvest
	case "deposit_out", "deposit_back":
		return CatInvest
	case "transfer_in", "transfer_out", "transfer_rollback":
		return CatTransfer
	case "loan":
		return CatFinancing
	case "repay":
		return CatDebt
	case "cf_income":
		return CatOtherIn
	case "cf_repay", "cf_reverse":
		return CatOtherOut
	}
	// manual / manual_adjust / deposit / mcp_deposit / mcp_withdraw / revert / rollback 等：
	// 先按备注关键词启发式，再按方向兜底。
	if c := categoryByNote(note); c != "" {
		return c
	}
	if delta >= 0 {
		return CatOtherIn
	}
	return CatOtherOut
}

// categoryByNote 备注关键词启发式（仅 manual 类使用；存量 manual 流水回填同样走这里）。
var noteKeywordRules = []struct {
	cat   string
	words []string
}{
	{CatSalary, []string{"工资", "薪水", "薪资", "薪酬", "年终奖", "奖金", "劳务费"}},
	{CatBusiness, []string{"经营", "副业", "营收", "营业额"}},
	{CatInvestInt, []string{"利息", "派息"}},
	{CatInvestDiv, []string{"分红", "股息"}},
	{CatCapex, []string{"资本开支", "购置", "家电", "数码", "电脑", "手机", "车辆", "买车", "家具"}},
	{CatHousing, []string{"房租", "租金", "物业", "水电", "燃气", "房贷月供"}},
	{CatDebt, []string{"还款", "还贷", "信用卡", "花呗", "借呗", "白条"}},
	{CatTax, []string{"税"}},
	{CatInsurance, []string{"保险", "保费"}},
	{CatEduHealth, []string{"学费", "培训", "医疗", "药品", "看病"}},
	{CatOtherIn, []string{"报销", "红包", "退款", "礼金"}},
}

func categoryByNote(note string) string {
	n := strings.TrimSpace(note)
	if n == "" {
		return ""
	}
	for _, r := range noteKeywordRules {
		for _, w := range r.words {
			if w != "" && strings.Contains(n, w) {
				return r.cat
			}
		}
	}
	return ""
}

// AutoCategory 对外暴露的自动分类入口：type 为空时按方向兜底。
func AutoCategory(typ string, delta float64, note string) string {
	if strings.TrimSpace(typ) == "" {
		if delta >= 0 {
			return CatOtherIn
		}
		return CatOtherOut
	}
	return autoCategoryByType(typ, delta, note)
}

// ExpectedInterest 计算存款预计利息：amount × rate% × 天数/365（单利，闰年差异忽略）。
func ExpectedInterest(amount, rate float64, startDate, endDate string) float64 {
	if amount <= 0 || rate <= 0 {
		return 0
	}
	days := daysBetween(startDate, endDate)
	if days <= 0 {
		return 0
	}
	return math.Round(amount*(rate/100)*(float64(days)/365.0)*100) / 100
}

// daysBetween 两个 YYYY-MM-DD 日期之间的天数；任一无效应返回 0。
func daysBetween(a, b string) int {
	ta, ea := time.Parse("2006-01-02", a)
	tb, eb := time.Parse("2006-01-02", b)
	if ea != nil || eb != nil || !tb.After(ta) {
		return 0
	}
	return int(tb.Sub(ta).Hours() / 24)
}
