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
