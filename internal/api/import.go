package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// ---- 数据导入（格式与「导出数据」一致：holdings/wealth/cash/liability/consumption）----

type importStats struct {
	Holdings    int `json:"holdings"`
	Wealth      int `json:"wealth"`
	Cash        int `json:"cash"`
	Liability   int `json:"liability"`
	Consumption int `json:"consumption"`
	Sources     int `json:"sources"`
}

type importResult struct {
	Imported importStats `json:"imported"`
	Skipped  importStats `json:"skipped"`
	Errors   []string    `json:"errors,omitempty"`
}

// importHolding 等在 db 结构体基础上捕获导出字段 source_name（来源映射键）与 amount（理财最新金额）。
type importHolding struct {
	db.Holding
	SourceName string `json:"source_name"`
}
type importWealth struct {
	db.WealthProduct
	SourceName string  `json:"source_name"`
	Amount     float64 `json:"amount"`
}
type importCash struct {
	db.Cash
	SourceName string `json:"source_name"`
}
type importLiability struct {
	db.Liability
	SourceName string `json:"source_name"`
}
type importConsumption struct {
	db.Consumption
	SourceName string `json:"source_name"`
}

func importData(c *gin.Context) {
	uid := currentUserID(c)
	var p struct {
		Holdings    []importHolding     `json:"holdings"`
		Wealth      []importWealth      `json:"wealth"`
		Cash        []importCash        `json:"cash"`
		Liability   []importLiability   `json:"liability"`
		Consumption []importConsumption `json:"consumption"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "导入数据格式错误: " + err.Error()})
		return
	}
	res := &importResult{}

	// 来源映射：按 source_name 查找当前用户库内来源，不存在则创建（导出仅含来源名）
	srcByName := map[string]int64{}
	if srcs, e := db.ListSources(uid); e == nil {
		for _, s := range srcs {
			srcByName[s.Name] = s.ID
		}
	}
	resolveSource := func(name string) int64 {
		name = strings.TrimSpace(name)
		if name == "" {
			return 0
		}
		if id, ok := srcByName[name]; ok {
			return id
		}
		id, err := db.CreateSource(&db.AssetSource{UserID: uid, Name: name, Type: "bank"})
		if err != nil {
			res.Errors = append(res.Errors, "创建来源「"+name+"」失败: "+err.Error())
			return 0
		}
		srcByName[name] = id
		res.Imported.Sources++
		return id
	}

	// 持仓：symbol 去重
	existSym := map[string]bool{}
	if hs, e := db.List(uid); e == nil {
		for _, h := range hs {
			existSym[h.Symbol] = true
		}
	}
	for _, h := range p.Holdings {
		h.UserID = uid
		if h.Symbol == "" || existSym[h.Symbol] {
			res.Skipped.Holdings++
			continue
		}
		if h.Category == "" {
			h.Category = "stock"
		}
		if h.Market == "" {
			h.Market = "沪深"
		}
		if h.Currency == "" {
			h.Currency = "CNY"
		}
		h.SourceID = resolveSource(h.SourceName)
		if _, err := db.Create(&h.Holding); err != nil {
			res.Errors = append(res.Errors, "持仓「"+h.Name+"」导入失败: "+err.Error())
			continue
		}
		existSym[h.Symbol] = true
		res.Imported.Holdings++
	}

	// 理财：name 去重；导入后建今日快照（金额=导出最新金额），使净值/盈亏有基线
	existWealth := map[string]bool{}
	if ws, e := db.ListWealth(uid); e == nil {
		for _, w := range ws {
			existWealth[w.Name] = true
		}
	}
	today := time.Now().Format("2006-01-02")
	for _, w := range p.Wealth {
		w.UserID = uid
		if w.Name == "" || existWealth[w.Name] {
			res.Skipped.Wealth++
			continue
		}
		if w.Currency == "" {
			w.Currency = "rmb"
		}
		w.SourceID = resolveSource(w.SourceName)
		id, err := db.CreateWealth(&w.WealthProduct)
		if err != nil {
			res.Errors = append(res.Errors, "理财「"+w.Name+"」导入失败: "+err.Error())
			continue
		}
		if err := db.UpsertWealthSnapshot(id, today, w.Amount, 0); err != nil {
			res.Errors = append(res.Errors, "理财「"+w.Name+"」快照写入失败: "+err.Error())
		}
		existWealth[w.Name] = true
		res.Imported.Wealth++
	}

	// 现金：name 去重
	existCash := map[string]bool{}
	if cs, e := db.ListCash(uid); e == nil {
		for _, c := range cs {
			existCash[c.Name] = true
		}
	}
	for _, c := range p.Cash {
		c.UserID = uid
		if c.Name == "" || existCash[c.Name] {
			res.Skipped.Cash++
			continue
		}
		if c.Currency == "" {
			c.Currency = "rmb"
		}
		c.SourceID = resolveSource(c.SourceName)
		if _, err := db.CreateCash(&c.Cash); err != nil {
			res.Errors = append(res.Errors, "现金「"+c.Name+"」导入失败: "+err.Error())
			continue
		}
		existCash[c.Name] = true
		res.Imported.Cash++
	}

	// 负债：name 去重
	existLib := map[string]bool{}
	if ls, e := db.ListLiabilities(uid); e == nil {
		for _, l := range ls {
			existLib[l.Name] = true
		}
	}
	for _, l := range p.Liability {
		l.UserID = uid
		if l.Name == "" || existLib[l.Name] {
			res.Skipped.Liability++
			continue
		}
		l.SourceID = resolveSource(l.SourceName)
		if _, err := db.CreateLiability(&l.Liability); err != nil {
			res.Errors = append(res.Errors, "负债「"+l.Name+"」导入失败: "+err.Error())
			continue
		}
		existLib[l.Name] = true
		res.Imported.Liability++
	}

	// 消费：date+category+amount 精确判重，避免重复导入产生垃圾流水
	existCons := map[string]bool{}
	if cs, e := db.ListConsumptions(100000, uid); e == nil {
		for _, c := range cs {
			existCons[fmt.Sprintf("%s|%s|%.4f", c.Date, c.Category, c.Amount)] = true
		}
	}
	for _, c := range p.Consumption {
		c.UserID = uid
		key := fmt.Sprintf("%s|%s|%.4f", c.Date, c.Category, c.Amount)
		if c.Date == "" || existCons[key] {
			res.Skipped.Consumption++
			continue
		}
		c.SourceID = resolveSource(c.SourceName)
		if _, err := db.CreateConsumption(&c.Consumption); err != nil {
			res.Errors = append(res.Errors, "消费记录导入失败: "+err.Error())
			continue
		}
		existCons[key] = true
		res.Imported.Consumption++
	}

	c.JSON(http.StatusOK, res)
}
