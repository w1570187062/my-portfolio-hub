package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

const (
	settingAssetTypeLabels = "asset_type_labels"
	settingFlowCategories  = "flow_categories"
	// 再平衡目标权重与频率（2026-10-27 重新引入再平衡功能）
	settingRebalanceTargets = "rebalance_targets"
	// 组合级盈亏阈值（2026-11-18）：整块 JSON，结构见 PortfolioRiskPlan。
	// 与 holdings.risk_plan 是两个层级，不要合并 —— 一个是逐只定价，一个是整体盈亏。
	settingPortfolioRisk = "portfolio_risk"
	// 锁仓持仓 ID 列表（2026-11-20）：纯视觉遮蔽，不改 holdings 表、不冻结交易。
	// payload = 当前账本下被锁持仓的 id 数组，如 [12,17]。按账本隔离，切账本天然分开。
	settingLockedHoldings = "locked_holdings"
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
	case settingPortfolioRisk:
	case settingLockedHoldings:
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
		case settingPortfolioRisk:
			// 默认关闭：和逐只 risk_plan 同一个原则 —— 不擅自给存量账本挂风控线
			if b, e := json.Marshal(defaultPortfolioRiskPlan()); e == nil {
				seed = string(b)
			}
		case settingLockedHoldings:
			seed = "[]"
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
	case settingPortfolioRisk:
	case settingLockedHoldings:
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
	} else if kind == settingPortfolioRisk {
		// 结构校验：只允许 PortfolioRiskPlan 的字段，越界值归一后再落库
		var plan PortfolioRiskPlan
		if err := json.Unmarshal([]byte(s), &plan); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "组合盈亏阈值必须是 {enabled,tp_pct,sl_pct,tp_amt,sl_amt} 结构"})
			return
		}
		norm, err := normalizePortfolioRiskPlan(plan)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// 每次保存都清掉基线：新阈值下的第一轮扫描只落库不外推，
		// 否则「把止损从 20% 收到 10%」这一下会立刻按当前浮亏推一条到手机。
		norm.BaselineAt = ""
		norm.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
		if b2, e := json.Marshal(norm); e == nil {
			s = string(b2)
		}
	} else if kind == settingLockedHoldings {
		// 结构校验：锁仓持仓 ID 必须是正整数数组，且全部归属当前账本。
		// 不校验归属的话，A 账本锁的 id 会串到 B 账本（切账本后 id 可能撞号）。
		var ids []int64
		if err := json.Unmarshal([]byte(s), &ids); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "锁仓持仓必须是 ID 数组"})
			return
		}
		owned := map[int64]bool{}
		if hs, e := db.List(uid); e == nil {
			for _, h := range hs { owned[h.ID] = true }
		}
		norm := make([]int64, 0, len(ids))
		seen := map[int64]bool{}
		for _, id := range ids {
			if id > 0 && owned[id] && !seen[id] {
				seen[id] = true
				norm = append(norm, id)
			}
		}
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
	case settingPortfolioRisk:
	case settingLockedHoldings:
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
