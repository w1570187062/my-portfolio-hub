package api

import (
	"net/http"
	"strconv"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// listManualClosed 返回当前用户全部手动已平仓记录。
func listManualClosed(c *gin.Context) {
	uid := currentUserID(c)
	items, err := db.ListManualClosed(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []db.ManualClosed{}
	}
	c.JSON(http.StatusOK, gin.H{"records": items})
}

// createManualClosed 新增一条手动已平仓记录（纯记录，不入账）。
func createManualClosed(c *gin.Context) {
	uid := currentUserID(c)
	var m db.ManualClosed
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	m.UserID = uid
	if m.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写名称"})
		return
	}
	id, err := db.CreateManualClosed(&m)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	m.ID = id
	c.JSON(http.StatusOK, gin.H{"ok": true, "record": m})
}

// updateManualClosed 修改手动记录（金额/天数/名称/备注/来源/类型/清仓时间）。
func updateManualClosed(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var m db.ManualClosed
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}
	m.ID = id
	m.UserID = uid
	if err := db.UpdateManualClosed(&m); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "record": m})
}

// deleteManualClosed 删除手动记录（仅本人）。
func deleteManualClosed(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if err := db.DeleteManualClosed(uid, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// reopenHolding 撤销清仓/重开持仓：用清仓前快照还原份额与成本并取消 closed 标记。
// 与已平仓视图「回退」按钮对应；理财类回退复用 /api/asset/wealth/:id/enable。
func reopenHolding(c *gin.Context) {
	uid := currentUserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	h, err := db.ReopenHolding(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h == nil || h.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "持仓不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "holding": h})
}
