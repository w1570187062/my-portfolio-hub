package api

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// 月度待入账/待还款计划：首页紧凑卡片 + 资产全景「收支计划」编辑入口 + 待还款定时提醒。
// 完成时把真实的出入账记入现金账户（income 入账 / expense 还款扣款），若关联负债则同步记一笔还款流水。

func listCashflowPlans(c *gin.Context) {
	uid := currentUserID(c)
	plans, err := db.ListCashflowPlans(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ym := c.Query("month")
	if !isValidYm(ym) {
		ym = time.Now().Format("2006-01")
	}
	doneMap, e := db.ListCashflowDoneMonth(uid, ym)
	if e != nil {
		log.Printf("[cashflow] 读取完成记录失败(uid=%d): %v", uid, e)
		doneMap = map[int64]*db.CashflowDone{}
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans, "done": doneMap, "month": ym})
}

// isValidYm 校验 YYYY-MM 格式
func isValidYm(ym string) bool {
	if len(ym) != 7 || ym[4] != '-' {
		return false
	}
	_, err := time.Parse("2006-01", ym)
	return err == nil
}

func createCashflowPlan(c *gin.Context) {
	var p db.CashflowPlan
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "标题不能为空"})
		return
	}
	if p.Type != "income" && p.Type != "expense" {
		p.Type = "income"
	}
	cat, err := resolvePlanCategory(c, p.Category, p.Type)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p.Category = cat
	// 归一化发生模式与负债方式（模式已简化为 每月 recurring_fixed / 一次性 one_time；
	// 历史 recurring_variable 并入「每月」，保存时统一收敛为 recurring_fixed）
	switch p.Pattern {
	case "one_time":
		// ok
	default:
		p.Pattern = "recurring_fixed"
	}
	if p.Type == "expense" {
		if p.LiabilityMode != "incur" {
			p.LiabilityMode = "repay"
		}
	} else {
		p.LiabilityMode = "" // 入账不涉及负债方式
	}
	if p.Pattern == "one_time" {
		// 一次性计划必须有具体归属日期（YYYY-MM-DD）
		if p.OneTimeDate == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "一次性计划需填写具体日期"})
			return
		}
		if _, e := time.Parse("2006-01-02", p.OneTimeDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式应为 YYYY-MM-DD"})
			return
		}
	} else {
		if p.DayOfMonth < 1 || p.DayOfMonth > 31 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "每月日期需在 1-31 之间"})
			return
		}
	}
	if p.Currency == "" {
		p.Currency = "cny"
	}
	if p.EndDate != "" {
		if _, e := time.Parse("2006-01-02", p.EndDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "截止日期格式应为 YYYY-MM-DD"})
			return
		}
	}
	// 产生新负债（incur）必须关联一个子账户，用于归属该笔负债的来源
	if p.Type == "expense" && p.LiabilityMode == "incur" && p.AccountID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "产生新负债需关联一个子账户"})
		return
	}
	p.UserID = currentUserID(c)
	id, err := db.CreateCashflowPlan(&p)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	p.ID = id
	c.JSON(http.StatusOK, gin.H{"plan": p})
}

func updateCashflowPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var p db.CashflowPlan
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "标题不能为空"})
		return
	}
	if p.Type != "income" && p.Type != "expense" {
		p.Type = "income"
	}
	cat, err := resolvePlanCategory(c, p.Category, p.Type)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p.Category = cat
	switch p.Pattern {
	case "one_time":
	default:
		p.Pattern = "recurring_fixed"
	}
	if p.Type == "expense" {
		if p.LiabilityMode != "incur" {
			p.LiabilityMode = "repay"
		}
	} else {
		p.LiabilityMode = ""
	}
	if p.Pattern == "one_time" {
		if p.OneTimeDate == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "一次性计划需填写具体日期"})
			return
		}
		if _, e := time.Parse("2006-01-02", p.OneTimeDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式应为 YYYY-MM-DD"})
			return
		}
	} else {
		if p.DayOfMonth < 1 || p.DayOfMonth > 31 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "每月日期需在 1-31 之间"})
			return
		}
	}
	if p.Currency == "" {
		p.Currency = "cny"
	}
	if p.EndDate != "" {
		if _, e := time.Parse("2006-01-02", p.EndDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "截止日期格式应为 YYYY-MM-DD"})
			return
		}
	}
	if p.Type == "expense" && p.LiabilityMode == "incur" && p.AccountID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "产生新负债需关联一个子账户"})
		return
	}
	p.ID = id
	uid := currentUserID(c)
	// 校验归属：仅允许编辑自己的计划，避免越权改写他人数据。
	if existing, e := db.GetCashflowPlan(id); e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	} else if existing == nil || existing.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	p.UserID = uid
	if err := db.UpdateCashflowPlan(&p); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": p})
}

func deleteCashflowPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteCashflowPlan(id, currentUserID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// completeCashflowPlan 勾选完成：把真实出入账记入账户/负债，并落库完成记录（幂等：同 plan+ym 只记一次）。
func completeCashflowPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	p, err := db.GetCashflowPlan(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	ym := strings.TrimSpace(c.Query("ym"))
	if ym == "" {
		// 一次性计划以归属日期所在月为 key，其余用当前月
		if p.Pattern == "one_time" && p.OneTimeDate != "" {
			ym = p.OneTimeDate[:7]
		} else {
			ym = time.Now().Format("2006-01")
		}
	}
	if existing, e := db.GetCashflowDone(uid, id, ym); e == nil && existing != nil {
		c.JSON(http.StatusOK, gin.H{"done": existing, "already": true})
		return
	}
	var body struct {
		ActualAmount  float64 `json:"actual_amount"`
		CashAccountID int64   `json:"cash_account_id"`
		Note          string  `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	// 完成计划统一由前端确认实际金额（预填计划金额，可改）；金额 0 = 本月跳过，不记账。
	// 不再按 pattern 回退计划金额（模式已简化为 每月/一次性，行为一致）。
	actual := math.Round(body.ActualAmount*100) / 100
	refType, refID, e := "", int64(0), error(nil)
	if actual != 0 {
		refType, refID, e = recordPlanTransaction(uid, p, actual, body.CashAccountID)
		if e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
			return
		}
	}
	done := &db.CashflowDone{
		UserID:       uid,
		PlanID:       id,
		YM:           ym,
		ActualAmount: actual,
		RefType:      refType,
		RefID:        refID,
		Note:         strings.TrimSpace(body.Note),
	}
	if e := db.UpsertCashflowDone(done); e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"done": done})
}

// uncompleteCashflowPlan 取消完成：反向记账撤销当初的真实出入账，并删除完成记录。
func uncompleteCashflowPlan(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	p, err := db.GetCashflowPlan(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if p == nil || p.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "计划不存在"})
		return
	}
	ym := strings.TrimSpace(c.Query("ym"))
	if ym == "" {
		if p.Pattern == "one_time" && p.OneTimeDate != "" {
			ym = p.OneTimeDate[:7]
		} else {
			ym = time.Now().Format("2006-01")
		}
	}
	done, e := db.GetCashflowDone(uid, id, ym)
	if e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	}
	if done == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	if e := reversePlanTransaction(uid, done, p); e != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
	}
	if e := db.DeleteCashflowDone(uid, id, ym); e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// resolvePlanCategory 校验收支计划的语义分类：空=按方向兜底（income→other_in / expense→other_out）；
// 方向必须与计划类型一致（收入计划只能选收入类、支出计划只能选支出类）。
func resolvePlanCategory(c *gin.Context, raw, planType string) (string, error) {
	cat := strings.TrimSpace(raw)
	if cat == "" {
		if planType == "expense" {
			return db.CatOtherOut, nil
		}
		return db.CatOtherIn, nil
	}
	wantDir := "income"
	if planType == "expense" {
		wantDir = "expense"
	}
	if db.IsKnownFinCat(cat) {
		if db.FinCatDir(cat) != wantDir {
			return "", fmt.Errorf("收支分类与计划方向不一致")
		}
		return cat, nil
	}
	defs, err := loadFlowCategories(currentUserID(c))
	if err != nil {
		return "", err
	}
	for _, d := range defs {
		if d.Key == cat {
			if d.Dir != wantDir {
				return "", fmt.Errorf("收支分类与计划方向不一致")
			}
			return cat, nil
		}
	}
	return "", fmt.Errorf("未知的收支分类：%s", cat)
}

// planFlowCategory 计划完成入账时使用的语义分类：计划自带优先，空则按方向兜底。
func planFlowCategory(p *db.CashflowPlan, dir string) string {
	if strings.TrimSpace(p.Category) != "" {
		return p.Category
	}
	if dir == "expense" {
		return db.CatOtherOut
	}
	return db.CatOtherIn
}

// recordPlanTransaction 完成计划时记一笔真实出入账，返回落账流水的类型与 id（供撤销时反向记账）。
// cashAccountID 为非 0 时覆盖计划默认的入账/还款账户（完成弹窗里让用户即时选择还款来源）。
func recordPlanTransaction(uid int64, p *db.CashflowPlan, actual float64, cashAccountID int64) (refType string, refID int64, err error) {
	accID := cashAccountID
	if accID == 0 {
		accID = p.AccountID
	}
	if p.Type == "income" {
		acc, e := resolveCashAccount(uid, accID, 0, p.Currency)
		if e != nil {
			return "", 0, e
		}
		detail := "待入账「" + p.Title + "」入账"
		if e := db.AddCashAmountCat(acc.ID, actual, "cf_income", "cashflow_plan", p.ID, p.Title, detail, planFlowCategory(p, "income")); e != nil {
			return "", 0, e
		}
		if f, e2 := db.GetLatestCashFlowByRef("cashflow_plan", p.ID); e2 == nil && f != nil {
			return "cash", f.ID, nil
		}
		return "cash", acc.ID, nil
	}
	// expense：产生新负债（incur）—— 直接新建一笔负债并记"增加"流水，不扣现金（你欠下了，后续再还）。
	if p.LiabilityMode == "incur" {
		var srcID int64
		if acc, e := db.GetCash(accID); e == nil && acc != nil {
			srcID = acc.SourceID
		}
		lb := &db.Liability{
			UserID:   uid,
			SourceID: srcID,
			Name:     p.Title,
			Type:     "购物负债",
			Amount:   actual,
			Currency: p.Currency,
			Note:     "一次性购物负债「" + p.Title + "」",
		}
		lid, e := db.CreateLiability(lb)
		if e != nil {
			return "", 0, e
		}
		bal := actual
		if _, e2 := db.InsertLiabilityFlow(&db.LiabilityFlow{
			UserID:       uid,
			LiabilityID:  lid,
			Type:         "loan",
			Amount:       actual,
			Balance:      bal,
			Note:         "一次性购物负债产生「" + p.Title + "」",
		}); e2 != nil {
			return "", 0, e2
		}
		// refType=liability_new：撤销时若尚未还过款则删除该负债
		return "liability_new", lid, nil
	}
	// expense 待还款：负债侧记一笔还款（欠款下降）；关联子账户即「还款账户」，
	// 同步扣款并记一笔资金流水 —— 负债与子账户两侧都必须留痕。
	if p.LiabilityID > 0 {
		l, e := db.GetLiability(p.LiabilityID)
		if e != nil {
			return "", 0, e
		}
		if l == nil || l.UserID != uid {
			return "", 0, errLiabilityNotFound
		}
		bal := math.Round((l.Amount-actual)*100) / 100 // 还款后债务余额下降
		if _, e2 := db.InsertLiabilityFlow(&db.LiabilityFlow{
			UserID:       uid,
			LiabilityID:  p.LiabilityID,
			Type:         "repay",
			Amount:       actual,
			Balance:      bal,
			Note:         "待还款完成「" + p.Title + "」",
		}); e2 != nil {
			return "", 0, e2
		}
		if e := db.SetLiabilityAmount(p.LiabilityID, bal); e != nil {
			return "", 0, e
		}
		// 还款账户扣款：delta 记负数（出账），与负债侧的还款流水成对
		acc, e3 := resolveCashAccount(uid, accID, 0, p.Currency)
		if e3 != nil {
			return "", 0, e3
		}
		if e3 := db.AddCashAmountCat(acc.ID, -actual, "cf_repay", "cashflow_plan", p.ID, p.Title,
			"待还款「"+p.Title+"」还款扣款（还款至"+l.Name+"）", planFlowCategory(p, "expense")); e3 != nil {
			return "", 0, e3
		}
		// 记住负债 id；撤销时据此还原债务余额，并按 cashflow_plan 反查流水冲回子账户扣款
		return "liability_repay", p.LiabilityID, nil
	}
	// 纯账户扣款（未关联负债）
	acc, e := resolveCashAccount(uid, accID, 0, p.Currency)
	if e != nil {
		return "", 0, e
	}
	detail := "待还款「" + p.Title + "」扣款"
	if e := db.AddCashAmountCat(acc.ID, -actual, "cf_repay", "cashflow_plan", p.ID, p.Title, detail, planFlowCategory(p, "expense")); e != nil {
		return "", 0, e
	}
	if f, e2 := db.GetLatestCashFlowByRef("cashflow_plan", p.ID); e2 == nil && f != nil {
		return "cash", f.ID, nil
	}
	return "cash", acc.ID, nil
}

// reversePlanTransaction 撤销完成时反向记账（写一笔相反方向流水并还原余额）。
func reversePlanTransaction(uid int64, done *db.CashflowDone, p *db.CashflowPlan) error {
	actual := done.ActualAmount
	if actual == 0 {
		actual = p.Amount
	}
	if done.RefType == "liability_new" {
		// 撤销"产生新负债"：仅当该负债只有一条"产生"流水（尚未还过款）时才安全删除，
		// 否则保留负债、仅删除完成记录，交由用户在负债页自行处理。
		l, e := db.GetLiability(done.RefID)
		if e != nil {
			return e
		}
		if l == nil {
			return nil
		}
		flows, e := db.ListLiabilityFlows(uid, done.RefID)
		if e != nil {
			return e
		}
		if len(flows) == 1 && flows[0].Type == "loan" {
			if e := db.DeleteLiability(done.RefID); e != nil {
				return e
			}
		}
		return nil
	}
	// 待还款还原：liability_repay（现记录）两侧都要还原；liability（历史记录）只有负债侧
	if done.RefType == "liability" || done.RefType == "liability_repay" {
		l, e := db.GetLiability(done.RefID)
		if e != nil {
			return e
		}
		if l != nil {
			newBal := math.Round((l.Amount+actual)*100) / 100 // 撤销还款：债务余额回升
			if _, e := db.InsertLiabilityFlow(&db.LiabilityFlow{
				UserID:       uid,
				LiabilityID:  done.RefID,
				Type:         "loan",
				Amount:       actual,
				Balance:      newBal,
				Note:         "撤销待还款「" + p.Title + "」",
			}); e != nil {
				return e
			}
			if e := db.SetLiabilityAmount(done.RefID, newBal); e != nil {
				return e
			}
		}
		if done.RefType != "liability_repay" {
			return nil
		}
		// 冲回当初记在还款账户上的扣款：反查该计划最近一条资金流水并反向记账
		f, e := db.GetLatestCashFlowByRef("cashflow_plan", p.ID)
		if e != nil {
			return e
		}
		if f == nil {
			return nil
		}
		acc, e := db.GetCash(f.CashID)
		if e != nil || acc == nil {
			return e
		}
		return db.AddCashAmountCat(acc.ID, -f.Amount, "cf_reverse", "cashflow_plan", p.ID, p.Title,
			"撤销待还款「"+p.Title+"」还款扣款", f.Category)
	}
	// cash：反向记账到原账户（沿用原流水分类，保证统计口径冲正抵消）
	f, e := db.GetCashFlow(done.RefID)
	if e != nil {
		return e
	}
	if f == nil {
		return nil
	}
	acc, e := db.GetCash(f.CashID)
	if e != nil || acc == nil {
		return e
	}
	detail := "撤销「" + p.Title + "」"
	return db.AddCashAmountCat(acc.ID, -f.Amount, "cf_reverse", "cashflow_plan", p.ID, p.Title, detail, f.Category)
}

var errLiabilityNotFound = errString("关联负债不存在")

type errString string

func (e errString) Error() string { return string(e) }
