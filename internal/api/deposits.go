package api

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// ---- 存款（定期存款 / 大额存单）----
// 新增时从关联子账户扣款（落 deposit_out / invest 类流水）；
// 到期后必须由用户点击「确认落袋」才把本金 + 利息记入账户（利息 deposit_interest / invest_int，
// 计入被动收入）。利息绝不自动入账。

type depositResp struct {
	db.Deposit
	ExpectedInterest float64 `json:"expected_interest"` // 按 年利率×天数/365 估算
	Days             int     `json:"days"`              // 起息日→到期天数
	Matured          bool    `json:"matured"`           // 已过到期时间仍未落袋
}

func listDeposits(c *gin.Context) {
	uid := currentUserID(c)
	list, err := db.ListDeposits(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	today := time.Now().Format("2006-01-02")
	out := make([]depositResp, 0, len(list))
	for _, d := range list {
		r := depositResp{Deposit: d}
		if d.Status != "settled" {
			r.ExpectedInterest = db.ExpectedInterest(d.Amount, d.Rate, d.StartDate, d.EndDate)
			r.Days = depositDays(d.StartDate, d.EndDate)
			r.Matured = d.EndDate != "" && d.EndDate <= today
		} else {
			r.ExpectedInterest = d.ActualInterest
			r.Days = depositDays(d.StartDate, d.EndDate)
		}
		out = append(out, r)
	}
	c.JSON(http.StatusOK, gin.H{"deposits": out})
}

func depositDays(start, end string) int {
	ta, ea := time.Parse("2006-01-02", start)
	tb, eb := time.Parse("2006-01-02", end)
	if ea != nil || eb != nil || !tb.After(ta) {
		return 0
	}
	return int(tb.Sub(ta).Hours() / 24)
}

// parseDeposit 绑定并校验存款表单。creditBack = 编辑时可先行冲正的旧扣款额（用于放大余额校验）。
func parseDeposit(c *gin.Context, uid int64, d *db.Deposit, creditBack float64) error {
	var b struct {
		Name          string  `json:"name"`
		Amount        float64 `json:"amount"`
		CashAccountID int64   `json:"cash_account_id"`
		Rate          float64 `json:"rate"`
		StartDate     string  `json:"start_date"`
		EndDate       string  `json:"end_date"`
		Note          string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		return errString("参数格式错误")
	}
	d.Name = strings.TrimSpace(b.Name)
	if d.Name == "" {
		return errString("名称不能为空")
	}
	d.Amount = math.Round(b.Amount*100) / 100
	if d.Amount <= 0 {
		return errString("金额必须大于 0")
	}
	d.Rate = math.Round(b.Rate*100) / 100
	if d.Rate < 0 || d.Rate > 20 {
		return errString("年利率应在 0-20 之间")
	}
	d.StartDate = strings.TrimSpace(b.StartDate)
	d.EndDate = strings.TrimSpace(b.EndDate)
	if d.StartDate == "" || d.EndDate == "" {
		return errString("起息日与到期时间必填")
	}
	if _, e := time.Parse("2006-01-02", d.StartDate); e != nil {
		return errString("起息日格式应为 YYYY-MM-DD")
	}
	if _, e := time.Parse("2006-01-02", d.EndDate); e != nil {
		return errString("到期时间格式应为 YYYY-MM-DD")
	}
	if d.EndDate <= d.StartDate {
		return errString("到期时间必须晚于起息日")
	}
	if b.CashAccountID <= 0 {
		return errString("请选择扣款 / 落袋子账户")
	}
	acc, err := db.GetCash(b.CashAccountID)
	if err != nil || acc == nil || acc.UserID != uid {
		return errString("子账户不存在或无权访问")
	}
	d.CashAccountID = acc.ID
	d.SourceID = acc.SourceID
	d.Currency = acc.Currency
	if acc.Amount+creditBack-d.Amount < -0.004 {
		return errString(fmt.Sprintf("子账户余额不足（当前 %.2f，需扣 %.2f）", acc.Amount, d.Amount))
	}
	d.Note = strings.TrimSpace(b.Note)
	return nil
}

func createDeposit(c *gin.Context) {
	uid := currentUserID(c)
	var d db.Deposit
	if err := parseDeposit(c, uid, &d, 0); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d.UserID = uid
	// 扣款：钱从子账户转进存款（投资活动，不计收支）
	if err := db.AddCashAmountCat(d.CashAccountID, -d.Amount, "deposit_out", "deposit", 0, d.Name,
		"存款存入「"+d.Name+"」", db.CatInvest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := db.CreateDeposit(&d)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d.ID = id
	c.JSON(http.StatusOK, gin.H{"deposit": d})
}

func updateDeposit(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	old, err := db.GetDeposit(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if old == nil || old.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "存款不存在"})
		return
	}
	if old.Status == "settled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "已落袋的存款不可编辑（流水已入账）"})
		return
	}
	var d db.Deposit
	if err := parseDeposit(c, uid, &d, old.Amount); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d.ID, d.UserID = id, uid
	// 编辑只改本金/账户/期限等信息，状态与创建时间沿用旧值，保证响应体完整
	d.Status, d.ActualInterest, d.SettledAt, d.CreatedAt = old.Status, old.ActualInterest, old.SettledAt, old.CreatedAt
	// 金额 / 账户变化：先冲正旧扣款，再按新值扣款，保持余额与流水一致
	if d.Amount != old.Amount || d.CashAccountID != old.CashAccountID {
		if err := db.AddCashAmountCat(old.CashAccountID, old.Amount, "deposit_back", "deposit", id, old.Name,
			"存款变更冲正「"+old.Name+"」", db.CatInvest); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.AddCashAmountCat(d.CashAccountID, -d.Amount, "deposit_out", "deposit", id, d.Name,
			"存款存入「"+d.Name+"」", db.CatInvest); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if err := db.UpdateDeposit(&d); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deposit": d})
}

func deleteDeposit(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	d, err := db.GetDeposit(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if d == nil || d.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "存款不存在"})
		return
	}
	if d.Status == "settled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "已落袋的存款不可删除（本金利息流水已入账）"})
		return
	}
	// 存期中的存款删除 = 提前支取：本金退回原账户后再删记录
	if err := db.AddCashAmountCat(d.CashAccountID, d.Amount, "deposit_back", "deposit", id, d.Name,
		"存款提前支取「"+d.Name+"」", db.CatInvest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := db.DeleteDeposit(id, uid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// settleDeposit 确认落袋：本金 + 利息一并入账（利息金额由用户确认，可改），标记已落袋。
func settleDeposit(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	uid := currentUserID(c)
	d, err := db.GetDeposit(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if d == nil || d.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "存款不存在"})
		return
	}
	if d.Status == "settled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该存款已落袋"})
		return
	}
	var b struct {
		ActualInterest float64 `json:"actual_interest"`
	}
	_ = c.ShouldBindJSON(&b)
	interest := math.Round(b.ActualInterest*100) / 100
	if interest < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "利息不能为负"})
		return
	}
	acc, err := db.GetCash(d.CashAccountID)
	if err != nil || acc == nil || acc.UserID != uid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "落袋子账户不存在或无权访问"})
		return
	}
	// 本金回流（投资活动）
	if err := db.AddCashAmountCat(acc.ID, d.Amount, "deposit_back", "deposit", id, d.Name,
		"存款到期本金「"+d.Name+"」", db.CatInvest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 利息入账（投资利息 → 被动收入）；金额为 0 时仍记一条 0 额流水保持审计完整
	if err := db.AddCashAmountCat(acc.ID, interest, "deposit_interest", "deposit", id, d.Name,
		"存款利息「"+d.Name+"」", db.CatInvestInt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := db.SettleDeposit(id, uid, interest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "interest": interest})
}
