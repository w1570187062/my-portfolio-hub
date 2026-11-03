package api

import (
	"net/http"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// 跨账本越权（2026-11-03）：多账本体系下，凡是按自增 id 解析用户资源的接口，
// 都必须校验该资源属于当前账本，否则任一已配对设备都能读写别的账本的数据。
// owned 做统一判定：不属于当前账本时按「不存在」返回 404，不泄漏资源是否存在。
func owned(c *gin.Context, ownerID int64) bool {
	if ownerID == currentUserID(c) {
		return true
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "对象不存在"})
	return false
}

// canAccessUser 判断当前请求能否访问指定账本（用于账本维度的接口，如统计）。
// 免认证/只读模式没有会话，与 AuthGuard 口径保持一致：dev 全放行，只读仅首个账本。
func canAccessUser(c *gin.Context, uid int64) bool {
	if authModeOff() {
		return true
	}
	if readOnlyMode() {
		return uid == firstUserID()
	}
	sid := currentSessionID(c)
	return sid > 0 && db.SessionHasUser(sid, uid)
}
