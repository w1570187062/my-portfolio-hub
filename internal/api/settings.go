package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

const (
	settingRiskProfiles    = "risk_profiles"
	settingAssetTypeLabels = "asset_type_labels"
)

// riskAllocation 是单个资产类别的目标配置占比。
type riskAllocation struct {
	Key string  `json:"key"` // 资产类型标签（与资产类型标签设置一致）
	Pct float64 `json:"pct"` // 目标占比（%）
}

// riskProfile 是一个风险偏好及其资产配置目标。
type riskProfile struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Allocations []riskAllocation `json:"allocations"`
}

// defaultAssetTypeLabels 返回内置默认资产类型标签（首次访问设置时落库）。
func defaultAssetTypeLabels() []string {
	return []string{"红利价值", "成长科技", "消费", "医药", "未分类"}
}

// defaultRiskProfiles 返回内置默认风险偏好（稳健 / 激进），首次访问时落库。
func defaultRiskProfiles() []riskProfile {
	return []riskProfile{
		{
			ID:   "steady",
			Name: "稳健",
			Allocations: []riskAllocation{
				{Key: "红利价值", Pct: 30},
				{Key: "成长科技", Pct: 25},
				{Key: "消费", Pct: 20},
				{Key: "医药", Pct: 15},
				{Key: "未分类", Pct: 10},
			},
		},
		{
			ID:   "aggressive",
			Name: "激进",
			Allocations: []riskAllocation{
				{Key: "红利价值", Pct: 15},
				{Key: "成长科技", Pct: 40},
				{Key: "消费", Pct: 20},
				{Key: "医药", Pct: 25},
			},
		},
	}
}

// loadRiskProfiles 读取当前用户的全部风险偏好；无记录时回退内置默认（不落库）。
func loadRiskProfiles(uid int64) ([]riskProfile, error) {
	payload, ok, err := db.GetSetting(settingRiskProfiles, uid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return defaultRiskProfiles(), nil
	}
	var ps []riskProfile
	if e := json.Unmarshal([]byte(payload), &ps); e != nil {
		return defaultRiskProfiles(), nil
	}
	return ps, nil
}

// settingsGet 返回某类设置的 JSON payload；首次访问时落库默认值。
func settingsGet(c *gin.Context) {
	kind := c.Param("kind")
	uid := currentUserID(c)
	switch kind {
	case settingRiskProfiles, settingAssetTypeLabels:
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
		if kind == settingRiskProfiles {
			if b, e := json.Marshal(defaultRiskProfiles()); e == nil {
				seed = string(b)
			}
		} else {
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
	case settingRiskProfiles, settingAssetTypeLabels:
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
	// 结构校验：风险偏好为对象数组；资产类型标签为字符串数组
	if kind == settingRiskProfiles {
		var ps []riskProfile
		if err := json.Unmarshal([]byte(s), &ps); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "风险偏好格式不正确（应为对象数组）"})
			return
		}
	} else {
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
	case settingRiskProfiles, settingAssetTypeLabels:
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

// assetRebalance 返回「当前 vs 目标」资产配置对比：按资产类型聚合当前持仓市值（CNY），
// 与所选风险偏好的目标占比比较，输出各类别当前金额/占比、目标占比/金额、偏离与调仓建议。
func assetRebalance(c *gin.Context) {
	uid := currentUserID(c)
	profileID := strings.TrimSpace(c.Query("profile"))
	cnyRate, hkdRate, _ := market.FetchFXRates()

	// 当前配置：按 asset_type 聚合持仓市值（折算 CNY）
	hs, _ := db.List(uid)
	curMap := map[string]float64{}
	var total float64
	for _, h := range hs {
		v := enrich(h, uid)
		mv := round2(v.MarketValue * rateChoice(h.Currency, cnyRate, hkdRate))
		at := strings.TrimSpace(h.AssetType)
		if at == "" {
			at = "未分类"
		}
		curMap[at] += mv
		total += mv
	}

	// 目标配置：读取选中的风险偏好（缺省取第一个）
	profiles, _ := loadRiskProfiles(uid)
	var sel *riskProfile
	for i := range profiles {
		if profiles[i].ID == profileID {
			sel = &profiles[i]
			break
		}
	}
	if sel == nil && len(profiles) > 0 {
		sel = &profiles[0]
		profileID = sel.ID
	}

	// 合并所有出现的类别（目标定义顺序优先，再补当前多出的），保证对比完整
	seen := map[string]bool{}
	var order []string
	add := func(k string) {
		if !seen[k] {
			seen[k] = true
			order = append(order, k)
		}
	}
	if sel != nil {
		for _, a := range sel.Allocations {
			add(a.Key)
		}
	}
	for k := range curMap {
		add(k)
	}

	rows := make([]gin.H, 0, len(order))
	for _, k := range order {
		curVal := curMap[k]
		var curPct, tgtPct, tgtVal, dev, devPct, adj float64
		if total > 0 {
			curPct = curVal / total * 100
		}
		if sel != nil {
			for _, a := range sel.Allocations {
				if a.Key == k {
					tgtPct = a.Pct
					break
				}
			}
		}
		tgtVal = total * tgtPct / 100
		dev = curVal - tgtVal
		devPct = curPct - tgtPct
		adj = tgtVal - curVal // 正=需买入，负=需卖出
		rows = append(rows, gin.H{
			"label":         k,
			"current_value": round2(curVal),
			"current_pct":   round2(curPct),
			"target_pct":    round2(tgtPct),
			"target_value":  round2(tgtVal),
			"deviation":     round2(dev),
			"deviation_pct": round2(devPct),
			"adjust":        round2(adj),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"profile_id": profileID,
		"profiles":   profiles,
		"total":      round2(total),
		"rows":       rows,
	})
}
