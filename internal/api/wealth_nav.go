package api

import (
	"net/http"
	"regexp"
	"strconv"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

// fundCodeRe matches a 6-digit public fund code (公募基金). Bank 理财 product
// codes (e.g. "A32020") and empty codes do NOT match — those have no open NAV feed.
var fundCodeRe = regexp.MustCompile(`^\d{6}$`)

// updateWealthNav records / refreshes a wealth product's latest NAV and, when
// shares are known, recomputes today's holding amount = shares × NAV.
//
// Body: { "nav": F, "shares": F (optional), "date": "YYYY-MM-DD" (optional) }
//   - nav must be > 0.
//   - shares: explicit value wins; otherwise, if the product has no recorded
//     shares yet but has a latest snapshot amount, derive shares = amount / nav
//     (bootstrap from an existing manual snapshot). If neither is available, the
//     request is rejected with a clear message.
//   - The target date's snapshot is upserted with amount = shares × nav while
//     preserving any already-recorded net cashflow (申购/赎回) for that date, so
//     daily P&L naturally reflects NAV movement only.
func updateWealthNav(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	var b struct {
		Nav    float64 `json:"nav"`
		Shares float64 `json:"shares"`
		Date   string  `json:"date"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	uid := currentUserID(c)
	// 归属校验
	if owner, e := db.WealthProductOwner(id); e == nil && owner != 0 && owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权修改该理财"})
		return
	}
	p, err := db.GetWealthProduct(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if p == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "理财产品不存在"})
		return
	}
	if p.Archived {
		c.JSON(http.StatusBadRequest, gin.H{"error": "「" + p.Name + "」已清仓停用，启用后才能更新净值"})
		return
	}
	if b.Nav <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "净值必须为正"})
		return
	}
	// 份额：显式给定 > 已有份额 > 由最新快照金额反推
	shares := b.Shares
	if shares <= 0 {
		if p.Shares > 0 {
			shares = p.Shares
		} else if _, amt, ok, _ := db.GetWealthLatest(id); ok && amt > 0 {
			shares = amt / b.Nav
		}
	}
	if shares <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无法确定份额：请在请求中传入 shares，或先录入一笔持仓金额快照（系统将按 金额÷净值 反推份额）"})
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	date := b.Date
	if date == "" {
		date = now[:10]
	}
	// 保留该日已录入的净存入（申购/赎回）与分红，仅重算金额
	_, cf, div, _, _ := db.GetWealthSnapshot(id, date)
	amount := round2(shares * b.Nav)
	if err := db.UpsertWealthSnapshot(id, date, amount, cf, div); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	p.Nav = b.Nav
	p.NavUpdatedAt = now
	p.Shares = shares
	if err := db.UpdateWealth(p); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"wealth":  p,
		"amount":  amount,
		"shares":  round4(shares),
		"date":    date,
		"derived": b.Shares <= 0 && p.Shares <= 0,
	})
}

// refreshWealthNavBatch auto-refreshes NAV for every wealth product of the
// current user whose Code is a 6-digit public fund code. Bank 理财 products
// (no open NAV feed) are reported as skipped. For products with known shares
// (or derivable from a latest snapshot), today's amount is recomputed.
func refreshWealthNavBatch(c *gin.Context) {
	uid := currentUserID(c)
	wps, err := db.ListWealth(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	today := now[:10]
	results := make([]gin.H, 0, len(wps))
	for _, w := range wps {
		if w.Archived {
			continue
		}
		if !fundCodeRe.MatchString(w.Code) {
			results = append(results, gin.H{
				"id":     w.ID,
				"name":   w.Name,
				"code":   w.Code,
				"status": "skipped",
				"reason": "非基金码，无公开净值接口（银行理财请在 App 查看净值后手动录入）",
			})
			continue
		}
		q, e := market.GetFundQuote(w.Code)
		if e != nil {
			results = append(results, gin.H{
				"id":     w.ID,
				"name":   w.Name,
				"code":   w.Code,
				"status": "error",
				"reason": e.Error(),
			})
			continue
		}
		// 份额：已有 > 由最新快照反推
		shares := w.Shares
		if shares <= 0 {
			if _, amt, ok, _ := db.GetWealthLatest(w.ID); ok && amt > 0 {
				shares = amt / q.CurrentPrice
			}
		}
		if shares <= 0 {
			results = append(results, gin.H{
				"id":     w.ID,
				"name":   w.Name,
				"code":   w.Code,
				"status": "skipped",
				"reason": "无份额且无法由快照反推（请先录入一笔持仓金额）",
			})
			continue
		}
		_, cf, div, _, _ := db.GetWealthSnapshot(w.ID, today)
		amount := round2(shares * q.CurrentPrice)
		// 保留该日已录入的分红（避免自动刷新净值时清掉手工补录的分红）
		if err := db.UpsertWealthSnapshot(w.ID, today, amount, cf, div); err != nil {
			results = append(results, gin.H{
				"id":     w.ID,
				"name":   w.Name,
				"code":   w.Code,
				"status": "error",
				"reason": err.Error(),
			})
			continue
		}
		w.Nav = q.CurrentPrice
		w.NavUpdatedAt = now
		w.Shares = shares
		if err := db.UpdateWealth(&w); err != nil {
			results = append(results, gin.H{
				"id":     w.ID,
				"name":   w.Name,
				"code":   w.Code,
				"status": "error",
				"reason": err.Error(),
			})
			continue
		}
		results = append(results, gin.H{
			"id":      w.ID,
			"name":    w.Name,
			"code":    w.Code,
			"status":  "updated",
			"nav":     round4(q.CurrentPrice),
			"shares":  round4(shares),
			"amount":  amount,
		})
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "results": results})
}
