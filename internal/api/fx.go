package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

func normCur(c string) string {
	c = strings.ToLower(strings.TrimSpace(c))
	if c == "rmb" {
		return "cny"
	}
	return c
}

// fxTargetOf 计算某账户某币种的可调用现金 / 权益成本 / 理财本金（均为原币）。
// 与 assetOverview 的子账户口径保持一致，供弹框校验「合计等于可调用 + 已买入本金」。
func fxTargetOf(uid, sourceID int64, currency string, cnyRate, hkdRate float64) (avail, cost, principal float64) {
	cur := normCur(currency)

	cashs, _ := db.ListCash(uid)
	for _, cc := range cashs {
		if cc.SourceID == sourceID && normCur(cc.Currency) == cur {
			avail += cc.Amount
		}
	}

	hs, _ := db.List(uid)
	for _, h := range hs {
		if h.SourceID == sourceID && normCur(h.Currency) == cur {
			cost += h.Quantity * h.CostPrice
		}
	}

	wps, _ := db.ListWealth(uid)
	for _, w := range wps {
		if w.SourceID != sourceID || normCur(w.Currency) != cur || w.Archived {
			continue
		}
		_, amt, found, _ := db.GetWealthLatest(w.ID)
		if !found || amt <= 0.005 {
			continue
		}
		cum := round2(w.CumPnl)
		if cum == 0 {
			cum = round2(wealthCumPnl(w.ID))
		}
		p := amt - cum
		if p <= 0.005 {
			if snaps, err := db.ListWealthSnapshots(w.ID); err == nil && len(snaps) > 0 {
				if lp := wealthPrincipalAtLastHold(snaps); !math.IsNaN(lp) {
					p = lp
				}
			}
		}
		if p > 0.005 {
			principal += p
		}
	}
	return avail, cost, principal
}

// assetNetAssetOf 复算净资产（与 assetOverview 同口径），供弹框展示汇兑损益占净资产的 pp。
func assetNetAssetOf(uid int64, cnyRate, hkdRate float64) float64 {
	var mv, wTotal, cTotal, lTotal float64
	hs, _ := db.List(uid)
	for _, h := range hs {
		mv += fxToCNY(h.Quantity*h.CurrentPrice, h.Currency, cnyRate, hkdRate)
	}
	wps, _ := db.ListWealth(uid)
	for _, w := range wps {
		_, amt, _, _ := db.GetWealthLatest(w.ID)
		wTotal += fxToCNY(amt, w.Currency, cnyRate, hkdRate)
	}
	cashs, _ := db.ListCash(uid)
	for _, cc := range cashs {
		cTotal += fxToCNY(cc.Amount, cc.Currency, cnyRate, hkdRate)
	}
	libs, _ := db.ListLiabilities(uid)
	for _, l := range libs {
		lTotal += fxToCNY(l.Amount, l.Currency, cnyRate, hkdRate)
	}
	return round2(mv + wTotal + cTotal - lTotal)
}

type fxLotsPayload struct {
	SourceID  int64   `json:"source_id"`
	Currency  string  `json:"currency"`
	Amount    float64 `json:"amount"`
	Rate      float64 `json:"rate"`
	TradeDate string  `json:"trade_date"`
	Note      string  `json:"note"`
}

type fxLotsPutBody struct {
	SourceID int64           `json:"source_id"`
	Currency string          `json:"currency"`
	Lots     []fxLotsPayload `json:"lots"`
}

// fxLotsGet 返回某账户某币种的换汇批次与汇总（弹框初始数据）。
func fxLotsGet(c *gin.Context) {
	uid := currentUserID(c)
	sid, err := strconv.ParseInt(c.Query("source_id"), 10, 64)
	if err != nil || sid <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad source_id"})
		return
	}
	src, _ := db.GetSource(sid)
	if src == nil || src.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
		return
	}
	cur := normCur(c.Query("currency"))
	if cur == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad currency"})
		return
	}
	cnyRate, hkdRate, _ := market.FetchFXRates()
	avail, cost, principal := fxTargetOf(uid, sid, cur, cnyRate, hkdRate)
	total := avail + cost + principal

	lots, err := db.ListFXLots(uid, sid, cur)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rows := make([]gin.H, 0, len(lots))
	var allocated, costCNY float64
	for _, l := range lots {
		allocated += l.Amount
		costCNY += l.Amount * l.Rate
		rows = append(rows, gin.H{
			"id": l.ID, "amount": round2(l.Amount), "rate": round4(l.Rate),
			"trade_date": l.TradeDate, "note": l.Note, "origin": l.Origin,
		})
	}
	weighted := 0.0
	if allocated > 0.005 {
		weighted = round4(costCNY / allocated)
	}
	curRate := currentRateOf(cur, cnyRate, hkdRate)
	priced := currencyPriced(cur)
	gain := 0.0
	if priced && curRate > 0 && allocated > 0.005 {
		gain = round2(allocated * (curRate - weighted))
	}
	start := ""
	if len(lots) > 0 {
		start = lots[0].TradeDate
	}
	c.JSON(http.StatusOK, gin.H{
		"source_id": sid, "source_name": src.Name, "currency": cur,
		"available": round2(avail), "invested_equity": round2(cost),
		"invested_wealth": round2(principal), "invested": round2(cost + principal),
		"total": round2(total), "total_cny": round2(fxToCNY(total, cur, cnyRate, hkdRate)),
		"priced": priced, "current_rate": round4(curRate),
		"lots": rows, "allocated": round2(allocated), "unallocated": round2(total - allocated),
		"weighted_rate": weighted, "fx_gain_cny": gain, "start_date": start,
		"net_asset": assetNetAssetOf(uid, cnyRate, hkdRate),
	})
}

// fxLotsPut 整组替换某账户某币种的换汇批次。
// 硬校验：Σ批次金额 = 可调用现金 + 已买入本金，差额超过 0.005 直接拒绝并说明差多少。
func fxLotsPut(c *gin.Context) {
	uid := currentUserID(c)
	var body fxLotsPutBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if body.SourceID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad source_id"})
		return
	}
	src, _ := db.GetSource(body.SourceID)
	if src == nil || src.UserID != uid {
		c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
		return
	}
	cur := normCur(body.Currency)
	if cur == "cny" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "主货币无需换汇拆批"})
		return
	}
	if !currencyPriced(cur) {
		c.JSON(http.StatusBadRequest, gin.H{"error": strings.ToUpper(cur) + " 暂无汇率源，暂不支持换汇拆批"})
		return
	}
	cnyRate, hkdRate, _ := market.FetchFXRates()
	avail, cost, principal := fxTargetOf(uid, body.SourceID, cur, cnyRate, hkdRate)
	target := avail + cost + principal

	today := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")
	var sum float64
	lots := make([]db.FXLot, 0, len(body.Lots))
	for _, l := range body.Lots {
		if l.Amount <= 0.005 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "每档金额必须大于 0"})
			return
		}
		if l.Rate <= 0.005 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "每档汇率必须大于 0"})
			return
		}
		date := strings.TrimSpace(l.TradeDate)
		if date == "" {
			date = today
		}
		if _, err := time.Parse("2006-01-02", date); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "日期格式应为 YYYY-MM-DD"})
			return
		}
		sum += l.Amount
		lots = append(lots, db.FXLot{
			SourceID: body.SourceID, Currency: cur, Amount: round2(l.Amount),
			Rate: round4(l.Rate), TradeDate: date, Note: strings.TrimSpace(l.Note),
			Origin: "manual",
		})
	}
	if diff := round2(sum - target); math.Abs(diff) > 0.005 {
		sym := curSymbol(cur)
		var msg string
		if diff < 0 {
			msg = "已分配 " + sym + strconv.FormatFloat(round2(sum), 'f', 2, 64) +
				" / 目标 " + sym + strconv.FormatFloat(round2(target), 'f', 2, 64) +
				"，还差 " + sym + strconv.FormatFloat(round2(-diff), 'f', 2, 64)
		} else {
			msg = "已分配 " + sym + strconv.FormatFloat(round2(sum), 'f', 2, 64) +
				" / 目标 " + sym + strconv.FormatFloat(round2(target), 'f', 2, 64) +
				"，超出 " + sym + strconv.FormatFloat(round2(diff), 'f', 2, 64)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": msg, "diff": round2(diff), "target": round2(target), "allocated": round2(sum)})
		return
	}
	if err := db.ReplaceFXLots(uid, body.SourceID, cur, lots); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "count": len(lots), "target": round2(target)})
}
