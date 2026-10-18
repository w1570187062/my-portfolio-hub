package api

import (
	"net/http"
	"strings"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// convertAccount 在不改表结构的前提下，让「子账户」与「负债」互相换性质。
// 两张表 id 空间独立、无法原地改性质，因此实现为「在目标表新建一条 + 删除原记录」；
// 为了不产生任何静默的数据丢失，只在原记录**没有真实流水、也没有被收支计划引用**时才允许转换。
//
// POST /api/asset/accounts/convert
//
//	入参 { kind: "cash"|"liability", id, name, type, amount, currency, note }
//	返回 { kind: "liability"|"cash", id }
func convertAccount(c *gin.Context) {
	var body struct {
		Kind     string  `json:"kind"`
		ID       int64   `json:"id"`
		Name     string  `json:"name"`
		Type     string  `json:"type"`
		Amount   float64 `json:"amount"`
		Currency string  `json:"currency"`
		Note     string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称不能为空"})
		return
	}
	if body.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	if body.Currency == "" {
		body.Currency = "cny"
	}
	uid := currentUserID(c)
	plans, err := db.ListCashflowPlans(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	switch body.Kind {
	case "cash":
		acc, e := db.GetCash(body.ID)
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		if acc == nil || acc.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "子账户不存在"})
			return
		}
		if flows, e := db.ListCashFlows(acc.ID, 1); e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		} else if len(flows) > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该子账户已有资金流水，转为负债会丢掉流水与关联，请改为新建一条负债"})
			return
		}
		for _, p := range plans {
			if p.AccountID == acc.ID {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该子账户正被收支计划「" + p.Title + "」引用（入账/还款账户），不能转为负债"})
				return
			}
		}
		// 子账户与负债都支持单独删除（2026-10-16 移除默认子账户概念），无需转移任何标记
		lid, e := db.CreateLiability(&db.Liability{
			UserID: uid, SourceID: acc.SourceID, Name: body.Name, Type: body.Type,
			Amount: body.Amount, Currency: body.Currency, Note: body.Note,
		})
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		// 与 createLiability 一致：非 0 欠款补一条「初始入账」流水
		if body.Amount != 0 {
			_, _ = db.InsertLiabilityFlow(&db.LiabilityFlow{
				UserID: uid, LiabilityID: lid, Type: "loan",
				Amount: round2(body.Amount), Balance: round2(body.Amount), Note: "由子账户转为负债",
			})
		}
		if e := db.DeleteCash(acc.ID); e != nil {
			_ = db.DeleteLiability(lid) // 回滚，避免留下两条重复记录
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"kind": "liability", "id": lid})

	case "liability":
		l, e := db.GetLiability(body.ID)
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		if l == nil || l.UserID != uid {
			c.JSON(http.StatusNotFound, gin.H{"error": "负债不存在"})
			return
		}
		// 新建负债自带一条「初始入账」loan 流水，只要没有别的流水就算干净
		// （判定口径与收支计划撤销「产生新负债」时一致）
		flows, e := db.ListLiabilityFlows(uid, l.ID)
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		if len(flows) > 1 || (len(flows) == 1 && flows[0].Type != "loan") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该负债已有还款等流水，转为子账户会丢掉流水与关联，请改为新建一个子账户"})
			return
		}
		for _, p := range plans {
			if p.LiabilityID == l.ID {
				c.JSON(http.StatusBadRequest, gin.H{"error": "该负债正被收支计划「" + p.Title + "」引用（关联负债），不能转为子账户"})
				return
			}
		}
		cid, e := db.CreateCash(&db.Cash{
			UserID: uid, SourceID: l.SourceID, Name: body.Name, Type: body.Type,
			Amount: body.Amount, Currency: body.Currency, Note: body.Note,
		})
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
		// 币种集合反向同步：转过来的子账户用到的币种补进来源 currencies（只补不删）
		_ = db.SyncSourceCurrency(uid, l.SourceID, body.Currency)
		if e := db.DeleteLiability(l.ID); e != nil {
			_ = db.DeleteCash(cid) // 回滚
			c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
			return
		}
	c.JSON(http.StatusOK, gin.H{"kind": "cash", "id": cid})

default:
	c.JSON(http.StatusBadRequest, gin.H{"error": "kind 应为 cash 或 liability"})
	}
}
