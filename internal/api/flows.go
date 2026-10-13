package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// 资产全景「流水」tab 的行内操作：修改 / 删除单条资金流水。
// 现金流水可改「归属子账户 + 金额（正=入账 / 负=出账）+ 备注」；
// 负债流水可改「类型（借入 / 还款）+ 金额 + 备注」。
// 所有改动都会同步对应账户 / 负债的当前余额，保证余额与流水明细始终一致。

// updateFlow PUT /api/asset/flows/:kind/:id
func updateFlow(c *gin.Context) {
	kind := strings.ToLower(strings.TrimSpace(c.Param("kind")))
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	switch kind {
	case "cash":
		var b struct {
			CashID int64   `json:"cash_id"`
			Amount float64 `json:"amount"`
			Note   string  `json:"note"`
		}
		if err := c.ShouldBindJSON(&b); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
			return
		}
		old, err := db.GetCashFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if old == nil || old.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		if b.CashID <= 0 {
			b.CashID = old.CashID
		}
		acc, err := db.GetCash(b.CashID)
		if err != nil || acc == nil || acc.UserID != uid {
			c.JSON(http.StatusForbidden, gin.H{"error": "子账户不存在或无权访问"})
			return
		}
		amount := math.Round(b.Amount*100) / 100
		if math.Abs(amount) < 0.005 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "金额不能为 0"})
			return
		}
		f, err := db.UpdateCashFlowRecord(id, b.CashID, amount, b.Note)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "flow": f})
	case "liability":
		var b struct {
			Type   string  `json:"type"`
			Amount float64 `json:"amount"`
			Note   string  `json:"note"`
		}
		if err := c.ShouldBindJSON(&b); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
			return
		}
		old, err := db.GetLiabilityFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if old == nil || old.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		if b.Amount == 0 {
			b.Amount = old.Amount
		}
		f, err := db.UpdateLiabilityFlowRecord(id, b.Type, b.Amount, b.Note)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "flow": f})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的流水类型"})
	}
}

// deleteFlow DELETE /api/asset/flows/:kind/:id
func deleteFlow(c *gin.Context) {
	kind := strings.ToLower(strings.TrimSpace(c.Param("kind")))
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	switch kind {
	case "cash":
		old, err := db.GetCashFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if old == nil || old.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		if err := db.DeleteCashFlowRecord(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	case "liability":
		old, err := db.GetLiabilityFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if old == nil || old.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		if err := db.DeleteLiabilityFlowRecord(id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的流水类型"})
	}
}

// rollbackFlow POST /api/asset/flows/:kind/:id/rollback
// 记一笔反向流水冲销该笔对账户 / 负债余额的影响，原流水记录保留（审计友好，区别于「删除」）。
func rollbackFlow(c *gin.Context) {
	kind := strings.ToLower(strings.TrimSpace(c.Param("kind")))
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	switch kind {
	case "cash":
		f, err := db.GetCashFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if f == nil || f.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		// 幂等保护：同一笔只允许回退一次，防止重复点击导致余额反冲两次
		if done, _ := db.HasCashRollback(uid, f.ID); done {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该流水已回退，请勿重复操作"})
			return
		}
		refLabel := f.RefName
		if refLabel == "" {
			refLabel = "流水#" + strconv.FormatInt(f.ID, 10)
		}
		detail := "回退：「" + refLabel + "」"
		if e := db.AddCashAmount(f.CashID, -f.Amount, "rollback", "rollback", f.ID, refLabel, detail); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		// 若这笔流水是「收支计划完成」产生的，回退余额的同时清除该计划的完成标记，
		// 否则首页收支卡片仍把该计划显示为「已完成」。纯账户扣款/入账按引用本流水定位，
		// 负债类计划（完成记录 ref_id 为负债ID）退化为按 计划ID + 流水月份 定位。
		if f.RefType == "cashflow_plan" {
			_ = db.DeleteCashflowDoneByFlowRef(uid, f.ID)
			if len(f.Date) >= 7 {
				_ = db.DeleteCashflowDoneByPlanYM(uid, f.RefID, f.Date[:7])
			}
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	case "liability":
		f, err := db.GetLiabilityFlow(id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if f == nil || f.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "流水不存在"})
			return
		}
		l, err := db.GetLiability(f.LiabilityID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if l == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "关联负债不存在"})
			return
		}
		// 反向类型：repay 反向为 loan（恢复债务），loan 反向为 repay（清偿）；同时还原负债余额
		eff := func(t string, a float64) float64 {
			if t == "loan" {
				return a
			}
			return -a
		}
		revType := "loan"
		if f.Type == "loan" {
			revType = "repay"
		}
		note := f.Note
		if note == "" {
			note = "流水#" + strconv.FormatInt(f.ID, 10)
		}
		bal := math.Round((l.Amount-eff(f.Type, f.Amount)+eff(revType, f.Amount))*100) / 100
		if _, e := db.InsertLiabilityFlow(&db.LiabilityFlow{
			UserID:      uid,
			LiabilityID: f.LiabilityID,
			Type:        revType,
			Amount:      f.Amount,
			Balance:     bal,
			Note:        "回退：「" + note + "」",
		}); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		if e := db.SetLiabilityAmount(f.LiabilityID, bal); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "不支持的流水类型"})
	}
}
