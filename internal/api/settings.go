package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

const (
	settingAssetTypeLabels = "asset_type_labels"
	settingFlowCategories  = "flow_categories"
	// 再平衡目标权重与频率（2026-10-27 重新引入再平衡功能）
	settingRebalanceTargets = "rebalance_targets"
)

// defaultAssetTypeLabels 返回内置默认资产类型标签（首次访问设置时落库）。
func defaultAssetTypeLabels() []string {
	return []string{"红利价值", "成长科技", "消费", "医药", "未分类"}
}

// FlowCatDef 自定义收支分类定义（key 全站唯一、label 展示名、dir=income|expense）。
type FlowCatDef struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Dir   string `json:"dir"`
}

// defaultFlowCategories 返回空自定义集（内置分类见 db.BuiltinFinCats，不在设置里维护）。
func defaultFlowCategories() []FlowCatDef {
	return []FlowCatDef{}
}

// loadFlowCategories 读取当前用户的自定义收支分类；无记录时回退空集（不落库）。
func loadFlowCategories(uid int64) ([]FlowCatDef, error) {
	payload, ok, err := db.GetSetting(settingFlowCategories, uid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return defaultFlowCategories(), nil
	}
	var ls []FlowCatDef
	if e := json.Unmarshal([]byte(payload), &ls); e != nil {
		return defaultFlowCategories(), nil
	}
	return ls, nil
}

// loadFlowCategoryKeys 仅返回自定义分类 key 集合（写流水时的白名单校验用）。
func loadFlowCategoryKeys(uid int64) ([]string, error) {
	defs, err := loadFlowCategories(uid)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(defs))
	for _, d := range defs {
		keys = append(keys, d.Key)
	}
	return keys, nil
}

// validFlowCategoryKey 分类 key 只允许小写字母/数字/下划线，防注入与展示异常。
func validFlowCategoryKey(k string) bool {
	if k == "" || len(k) > 32 {
		return false
	}
	for _, r := range k {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

// normalizeFlowCategories 校验并归一化自定义分类：去重、去空白、direction 收敛。
func normalizeFlowCategories(defs []FlowCatDef) ([]FlowCatDef, error) {
	seen := map[string]bool{}
	out := make([]FlowCatDef, 0, len(defs))
	for _, d := range defs {
		key := strings.TrimSpace(d.Key)
		label := strings.TrimSpace(d.Label)
		dir := strings.TrimSpace(d.Dir)
		if dir != "income" && dir != "expense" {
			dir = "expense"
		}
		if key == "" {
			key = "cat_" + strconv.FormatInt(int64(len(out)+1), 10)
		}
		if !validFlowCategoryKey(key) {
			return nil, fmt.Errorf("分类标识含非法字符：%s", d.Key)
		}
		if db.IsKnownFinCat(key) {
			return nil, fmt.Errorf("标识与内置分类冲突：%s", key)
		}
		if label == "" {
			label = key
		}
		if len([]rune(label)) > 12 {
			label = string([]rune(label)[:12])
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, FlowCatDef{Key: key, Label: label, Dir: dir})
	}
	return out, nil
}

// settingsGet 返回某类设置的 JSON payload；首次访问时落库默认值。
func settingsGet(c *gin.Context) {
	kind := c.Param("kind")
	uid := currentUserID(c)
	switch kind {
	case settingAssetTypeLabels:
	case settingFlowCategories:
	case settingRebalanceTargets:
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
		switch kind {
		case settingFlowCategories:
			if b, e := json.Marshal(defaultFlowCategories()); e == nil {
				seed = string(b)
			}
		case settingRebalanceTargets:
			if b, e := json.Marshal(defaultRebalanceConfig()); e == nil {
				seed = string(b)
			}
		default:
			if b, e := json.Marshal(defaultAssetTypeLabels()); e == nil {
				seed = string(b)
			}
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
	case settingFlowCategories:
	case settingRebalanceTargets:
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
	s := unwrapJSONString(string(b.Payload))
	if s == "" || s == "null" {
		s = "[]"
	}
	if !json.Valid([]byte(s)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload 不是合法 JSON"})
		return
	}
	if kind == settingFlowCategories {
		// 结构校验：自定义收支分类为对象数组，key 唯一且不与内置冲突
		var defs []FlowCatDef
		if err := json.Unmarshal([]byte(s), &defs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "自定义分类必须是 [{key,label,dir}] 结构"})
			return
		}
		norm, err := normalizeFlowCategories(defs)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if b, e := json.Marshal(norm); e == nil {
			s = string(b)
		}
	} else if kind == settingRebalanceTargets {
		// 结构校验：{targets:[{key,pct}], freq, drift_alert}；合计必须 100%
		var cfg rbConfig
		if err := json.Unmarshal([]byte(s), &cfg); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "再平衡配置必须是 {targets,freq,drift_alert} 结构"})
			return
		}
		norm, err := normalizeRebalanceConfig(cfg)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// UpdatedAt 由服务端盖时间戳，忽略前端传入值
		if b2, e := json.Marshal(norm); e == nil {
			s = string(b2)
		}
	} else {
		// 结构校验：资产类型标签为字符串数组
		var ls []string
		if err := json.Unmarshal([]byte(s), &ls); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "资产类型标签必须是字符串数组"})
			return
		}
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
	case settingFlowCategories:
	case settingRebalanceTargets:
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
