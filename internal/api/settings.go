package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

const (
	settingAssetTypeLabels = "asset_type_labels"
)

// defaultAssetTypeLabels 返回内置默认资产类型标签（首次访问设置时落库）。
func defaultAssetTypeLabels() []string {
	return []string{"红利价值", "成长科技", "消费", "医药", "未分类"}
}

// loadAssetTypeLabels 读取当前用户的资产类型标签定义；无记录时回退内置默认（不落库）。
func loadAssetTypeLabels(uid int64) ([]string, error) {
	payload, ok, err := db.GetSetting(settingAssetTypeLabels, uid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return defaultAssetTypeLabels(), nil
	}
	var ls []string
	if e := json.Unmarshal([]byte(payload), &ls); e != nil {
		return defaultAssetTypeLabels(), nil
	}
	return ls, nil
}

// settingsGet 返回某类设置的 JSON payload；首次访问时落库默认值。
func settingsGet(c *gin.Context) {
	kind := c.Param("kind")
	uid := currentUserID(c)
	switch kind {
	case settingAssetTypeLabels:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的设置类型"})
		return
	}
	payload, ok, err := db.GetSetting(kind, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		var seed string
		if b, e := json.Marshal(defaultAssetTypeLabels()); e == nil {
			seed = string(b)
		}
		_ = db.SaveSetting(kind, seed, uid)
		payload = seed
	}
	c.JSON(http.StatusOK, gin.H{"kind": kind, "payload": payload})
}

// settingsPut 覆盖保存某类设置的 JSON payload。
func settingsPut(c *gin.Context) {
	kind := c.Param("kind")
	uid := currentUserID(c)
	switch kind {
	case settingAssetTypeLabels:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的设置类型"})
		return
	}
	var b struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	s := strings.TrimSpace(string(b.Payload))
	if s == "" || s == "null" {
		s = "[]"
	}
	if !json.Valid([]byte(s)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload 不是合法 JSON"})
		return
	}
	// 结构校验：资产类型标签为字符串数组
	var ls []string
	if err := json.Unmarshal([]byte(s), &ls); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "资产类型标签必须是字符串数组"})
		return
	}
	if err := db.SaveSetting(kind, s, uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// settingsDelete 清空某类设置（回退到内置默认）。
func settingsDelete(c *gin.Context) {
	kind := c.Param("kind")
	uid := currentUserID(c)
	switch kind {
	case settingAssetTypeLabels:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的设置类型"})
		return
	}
	if err := db.DeleteSetting(kind, uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
