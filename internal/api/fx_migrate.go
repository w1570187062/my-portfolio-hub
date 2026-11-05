package api

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"portfolio/internal/db"
	"portfolio/internal/market"
)

// EnsureFXLots 在多实例启动时执行两件事（幂等）：
//  1. 老数据迁移：非主货币的「可调用 + 已买入本金」若还没有换汇批次，按迁移日汇率建档一档，
//     使迁移前的汇率波动不计入收益（卡片脚注「自 YYYY-MM-DD 起计算」）。
//  2. 演示种子（仅 DEMO_FX_SEED=1 的 demo 实例）：落一份 $12,000 / 加权 7.1642 的示例三档，
//     真实账户不受影响。
func EnsureFXLots() {
	cnyRate, hkdRate, _ := market.FetchFXRates()
	if cnyRate <= 0 {
		log.Printf("[fx] 汇率尚未就绪，跳过换汇批次迁移")
		return
	}
	if os.Getenv("DEMO_FX_SEED") != "" {
		if err := seedDemoFXLots(); err != nil {
			log.Printf("[fx] demo 换汇种子失败：%v", err)
		}
	}
	users, err := db.ListUsers()
	if err != nil {
		return
	}
	today := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")
	migrated := 0
	for _, u := range users {
		groups := fxGroupTotalsOf(u.ID)
		for key, total := range groups {
			parts := strings.SplitN(key, "|", 2)
			if len(parts) != 2 {
				continue
			}
			cur := parts[1]
			if !currencyPriced(cur) || total <= 0.005 {
				continue
			}
			sid, _ := strconv.ParseInt(parts[0], 10, 64)
			if existing, err := db.ListFXLots(u.ID, sid, cur); err == nil && len(existing) > 0 {
				continue
			}
			rate := currentRateOf(cur, cnyRate, hkdRate)
			if rate <= 0 {
				continue
			}
			if err := db.ReplaceFXLots(u.ID, sid, cur, []db.FXLot{{
				SourceID: sid, Currency: cur, Amount: round2(total), Rate: round4(rate),
				TradeDate: today, Note: "按迁移日汇率建档", Origin: "migrated",
			}}); err != nil {
				log.Printf("[fx] 迁移账户 %d/%s 失败：%v", sid, cur, err)
				continue
			}
			migrated++
		}
	}
	if migrated > 0 {
		log.Printf("[fx] 已为 %d 个账户币种按 %s 汇率建档（迁移日之前不计汇兑损益）", migrated, today)
	}
}

// fxGroupTotalsOf 枚举一个账本所有「账户 + 币种」的资金合计（原币），口径与 assetOverview 一致。
func fxGroupTotalsOf(uid int64) map[string]float64 {
	out := map[string]float64{}
	// 现金
	cashs, _ := db.ListCash(uid)
	for _, cc := range cashs {
		k := fmt.Sprintf("%d|%s", cc.SourceID, normCur(cc.Currency))
		out[k] += cc.Amount
	}
	// 权益（成本）
	hs, _ := db.List(uid)
	for _, h := range hs {
		k := fmt.Sprintf("%d|%s", h.SourceID, normCur(h.Currency))
		out[k] += h.Quantity * h.CostPrice
	}
	// 理财本金（仅未归档）
	wps, _ := db.ListWealth(uid)
	for _, w := range wps {
		if w.Archived {
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
				if lp := wealthPrincipalAtLastHold(snaps); lp > 0 {
					p = lp
				}
			}
		}
		if p > 0.005 {
			k := fmt.Sprintf("%d|%s", w.SourceID, normCur(w.Currency))
			out[k] += p
		}
	}
	return out
}

// seedDemoFXLots 只在 demo 实例创建一份带示例三档的账户，让汇兑卡能展示真实数字。
// 金额 5000@7.10 + 4000@7.18 + 3000@7.25 = 12,000，加权 7.1642；
// 当前 7.2860 时汇兑损益 +¥1,462.00。
func seedDemoFXLots() error {
	users, err := db.ListUsers()
	if err != nil || len(users) == 0 {
		return err
	}
	uid := users[0].ID
	srcs, _ := db.ListSources(uid)
	for _, s := range srcs {
		if s.Name == "演示·换汇示例" {
			return nil
		}
	}
	sid, err := db.CreateSource(&db.AssetSource{
		UserID: uid, Name: "演示·换汇示例", Type: "securities", Region: "us", Currencies: "usd",
		Note: "demo 实例专用：仅用于展示换汇拆批与汇兑收益率",
	})
	if err != nil {
		return err
	}
	if _, err := db.CreateCash(&db.Cash{
		UserID: uid, SourceID: sid, Name: "美元演示子账户", Currency: "usd", Amount: 12000,
	}); err != nil {
		return err
	}
	day := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01-02")
	return db.ReplaceFXLots(uid, sid, "usd", []db.FXLot{
		{SourceID: sid, Currency: "usd", Amount: 5000, Rate: 7.10, TradeDate: day, Note: "示例一档", Origin: "demo"},
		{SourceID: sid, Currency: "usd", Amount: 4000, Rate: 7.18, TradeDate: day, Note: "示例二档", Origin: "demo"},
		{SourceID: sid, Currency: "usd", Amount: 3000, Rate: 7.25, TradeDate: day, Note: "示例三档", Origin: "demo"},
	})
}
