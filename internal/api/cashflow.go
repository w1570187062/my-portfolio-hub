package api

import (
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
	ym := time.Now().Format("2006-01")
	doneMap, e := db.ListCashflowDoneMonth(uid, ym)
	if e != nil {
		log.Printf("[cashflow] 读取完成记录失败(uid=%d): %v", uid, e)
		doneMap = map[int64]*db.CashflowDone{}
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans, "done": doneMap, "month": ym})
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
	if p.DayOfMonth < 1 || p.DayOfMonth > 31 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "每月日期需在 1-31 之间"})
		return
	}
	if p.Currency == "" {
		p.Currency = "rmb"
	}
	if p.EndDate != "" {
		if _, e := time.Parse("2006-01-02", p.EndDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "截止日期格式应为 YYYY-MM-DD"})
			return
		}
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
	if p.DayOfMonth < 1 || p.DayOfMonth > 31 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "每月日期需在 1-31 之间"})
		return
	}
	if p.Currency == "" {
		p.Currency = "rmb"
	}
	if p.EndDate != "" {
		if _, e := time.Parse("2006-01-02", p.EndDate); e != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "截止日期格式应为 YYYY-MM-DD"})
			return
		}
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
		ym = time.Now().Format("2006-01")
	}
	if existing, e := db.GetCashflowDone(uid, id, ym); e == nil && existing != nil {
		c.JSON(http.StatusOK, gin.H{"done": existing, "already": true})
		return
	}
	var body struct {
		ActualAmount float64 `json:"actual_amount"`
		Note         string  `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	actual := body.ActualAmount
	if actual == 0 {
		actual = p.Amount
	}
	actual = math.Round(actual*100) / 100
	refType, refID, e := recordPlanTransaction(uid, p, actual)
	if e != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": e.Error()})
		return
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
		ym = time.Now().Format("2006-01")
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

// recordPlanTransaction 完成计划时记一笔真实出入账，返回落账流水的类型与 id（供撤销时反向记账）。
func recordPlanTransaction(uid int64, p *db.CashflowPlan, actual float64) (refType string, refID int64, err error) {
	if p.Type == "income" {
		acc, e := resolveCashAccount(uid, p.AccountID, 0, p.Currency)
		if e != nil {
			return "", 0, e
		}
		detail := "待入账「" + p.Title + "」入账"
		if e := db.AddCashAmount(acc.ID, actual, "cf_income", "cashflow_plan", p.ID, p.Title, detail); e != nil {
			return "", 0, e
		}
		if f, e2 := db.GetLatestCashFlowByRef("cashflow_plan", p.ID); e2 == nil && f != nil {
			return "cash", f.ID, nil
		}
		return "cash", acc.ID, nil
	}
	// expense 待还款：优先记一笔负债还款流水
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
		// 记住负债 id，撤销时据此还原债务余额
		return "liability", p.LiabilityID, nil
	}
	// 纯账户扣款（未关联负债）
	acc, e := resolveCashAccount(uid, p.AccountID, 0, p.Currency)
	if e != nil {
		return "", 0, e
	}
	detail := "待还款「" + p.Title + "」扣款"
	if e := db.AddCashAmount(acc.ID, -actual, "cf_repay", "cashflow_plan", p.ID, p.Title, detail); e != nil {
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
	if done.RefType == "liability" {
		l, e := db.GetLiability(done.RefID)
		if e != nil {
			return e
		}
		if l == nil {
			return nil
		}
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
		return db.SetLiabilityAmount(done.RefID, newBal)
	}
	// cash：反向记账到原账户
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
	return db.AddCashAmount(acc.ID, -f.Amount, "cf_reverse", "cashflow_plan", p.ID, p.Title, detail)
}

var errLiabilityNotFound = errString("关联负债不存在")

type errString string

func (e errString) Error() string { return string(e) }
