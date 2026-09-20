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

// ---- 数据导入（格式与「导出数据」一致：holdings/wealth/cash/liability/consumption；
//   完整迁移（version=2）时额外包含 cashflow_plans/sources/ai_config/settings/calc_inputs/pnl_history）----

type importStats struct {
	Holdings    int `json:"holdings"`
	Wealth      int `json:"wealth"`
	Cash        int `json:"cash"`
	Liability   int `json:"liability"`
	Consumption int `json:"consumption"`
	Sources     int `json:"sources"`
	Plans       int `json:"plans"`
	AIConfig    int `json:"ai_config"`
	Settings    int `json:"settings"`
	CalcInputs  int `json:"calc_inputs"`
	PnlHistory  int `json:"pnl_history"`
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
type importSettings struct {
	RiskProfiles    json.RawMessage `json:"risk_profiles"`
	AssetTypeLabels json.RawMessage `json:"asset_type_labels"`
	Notify          json.RawMessage `json:"notify"`
}

func importData(c *gin.Context) {
	uid := currentUserID(c)
	var p struct {
		Holdings      []importHolding          `json:"holdings"`
		Wealth        []importWealth           `json:"wealth"`
		Cash          []importCash             `json:"cash"`
		Liability     []importLiability        `json:"liability"`
		Consumption   []importConsumption      `json:"consumption"`
		CashflowPlans []db.CashflowPlan        `json:"cashflow_plans"`
		Sources       []db.AssetSource         `json:"sources"`
		AIConfig      json.RawMessage          `json:"ai_config"`
		Settings      importSettings           `json:"settings"`
		CalcInputs    map[string]json.RawMessage `json:"calc_inputs"`
		PnlHistory    []db.PnlDay              `json:"pnl_history"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "导入数据格式错误: " + err.Error()})
		return
	}
	res := &importResult{}

	// 来源映射：先按库内现有来源建映射；完整迁移的导出含 sources 全量元数据，
	// 先 upsert 这些来源（含 type/region/currencies），以还原账户元数据而非统一降级为 bank。
	srcByName := map[string]int64{}
	if srcs, e := db.ListSources(uid); e == nil {
		for _, s := range srcs {
			srcByName[s.Name] = s.ID
		}
	}
	for _, s := range p.Sources {
		name := strings.TrimSpace(s.Name)
		if name == "" {
			continue
		}
		if id, ok := srcByName[name]; ok {
			s.ID = id
			s.UserID = uid
			if s.Type == "" {
				s.Type = "bank"
			}
			if s.Region == "" {
				s.Region = "domestic"
			}
			_ = db.UpdateSource(&s)
		} else {
			s.ID = 0
			s.UserID = uid
			if s.Type == "" {
				s.Type = "bank"
			}
			if s.Region == "" {
				s.Region = "domestic"
			}
			if s.Currencies == "" {
				s.Currencies = "rmb"
			}
			id, err := db.CreateSource(&s)
			if err != nil {
				res.Errors = append(res.Errors, "创建来源「"+name+"」失败: "+err.Error())
				continue
			}
			if _, e := db.EnsureCurrencyDefaults(uid, id, s.Name, s.Currencies); e != nil {
				res.Errors = append(res.Errors, "来源「"+name+"」默认子账户初始化失败: "+e.Error())
			}
			srcByName[name] = id
		}
		res.Imported.Sources++
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

	// 现金：name 去重；记录 旧id→新id 供收支计划关联账户重映射。
	// 已存在同名账户（如来源 upsert 时 EnsureCurrencyDefaults 预建的默认子账户）也建立映射，
	// 避免因跳过而导致计划的 account_id 丢失。
	existCash := map[string]bool{}
	cashNameToID := map[string]int64{}
	cashOldToNew := map[int64]int64{}
	if cs, e := db.ListCash(uid); e == nil {
		for _, c := range cs {
			existCash[c.Name] = true
			cashNameToID[c.Name] = c.ID
		}
	}
	for _, c := range p.Cash {
		oldID := c.ID
		c.UserID = uid
		if c.Name == "" || existCash[c.Name] {
			if id, ok := cashNameToID[c.Name]; ok {
				cashOldToNew[oldID] = id
			}
			res.Skipped.Cash++
			continue
		}
		if c.Currency == "" {
			c.Currency = "rmb"
		}
		c.SourceID = resolveSource(c.SourceName)
		newID, err := db.CreateCash(&c.Cash)
		if err != nil {
			res.Errors = append(res.Errors, "现金「"+c.Name+"」导入失败: "+err.Error())
			continue
		}
		cashOldToNew[oldID] = newID
		cashNameToID[c.Name] = newID
		existCash[c.Name] = true
		res.Imported.Cash++
	}

	// 负债：name 去重；记录 旧id→新id 供收支计划关联负债重映射（同名已存在也建立映射）
	existLib := map[string]bool{}
	libNameToID := map[string]int64{}
	libOldToNew := map[int64]int64{}
	if ls, e := db.ListLiabilities(uid); e == nil {
		for _, l := range ls {
			existLib[l.Name] = true
			libNameToID[l.Name] = l.ID
		}
	}
	for _, l := range p.Liability {
		oldID := l.ID
		l.UserID = uid
		if l.Name == "" || existLib[l.Name] {
			if id, ok := libNameToID[l.Name]; ok {
				libOldToNew[oldID] = id
			}
			res.Skipped.Liability++
			continue
		}
		l.SourceID = resolveSource(l.SourceName)
		newID, err := db.CreateLiability(&l.Liability)
		if err != nil {
			res.Errors = append(res.Errors, "负债「"+l.Name+"」导入失败: "+err.Error())
			continue
		}
		libOldToNew[oldID] = newID
		libNameToID[l.Name] = newID
		existLib[l.Name] = true
		res.Imported.Liability++
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

	// 收支计划：type+title+day_of_month+currency 判重；关联账户/负债按 旧id→新id 重映射
	existPlan := map[string]bool{}
	if ps, e := db.ListCashflowPlans(uid); e == nil {
		for _, pl := range ps {
			existPlan[pl.Type+"|"+pl.Title+"|"+strconv.Itoa(pl.DayOfMonth)+"|"+pl.Currency] = true
		}
	}
	for _, pl := range p.CashflowPlans {
		pl.UserID = uid
		key := pl.Type + "|" + pl.Title + "|" + strconv.Itoa(pl.DayOfMonth) + "|" + pl.Currency
		if pl.Title == "" || existPlan[key] {
			res.Skipped.Plans++
			continue
		}
		if pl.Type != "income" && pl.Type != "expense" {
			pl.Type = "income"
		}
		if pl.Currency == "" {
			pl.Currency = "rmb"
		}
		pl.AccountID = cashOldToNew[pl.AccountID]
		pl.LiabilityID = libOldToNew[pl.LiabilityID]
		if _, err := db.CreateCashflowPlan(&pl); err != nil {
			res.Errors = append(res.Errors, "收支计划「"+pl.Title+"」导入失败: "+err.Error())
			continue
		}
		existPlan[key] = true
		res.Imported.Plans++
	}

	// AI 配置（含 API Key / 模型 / 提示词模板）
	if len(p.AIConfig) > 0 && string(p.AIConfig) != "null" {
		if err := db.SaveAIConfig(uid, string(p.AIConfig)); err != nil {
			res.Errors = append(res.Errors, "AI 配置导入失败: "+err.Error())
		} else {
			res.Imported.AIConfig = 1
		}
	}

	// 应用设置：风险偏好 / 资产类型标签 / 通知配置（payload 为 JSON 文本；兼容字符串/裸数组两种格式）
	saveRaw := func(kind, raw string) {
		s := unwrapJSONString(raw)
		if s == "" || s == "null" {
			return
		}
		if !json.Valid([]byte(s)) {
			res.Errors = append(res.Errors, "设置「"+kind+"」不是合法 JSON，已跳过")
			return
		}
		var e error
		switch kind {
		case "risk_profiles":
			e = db.SaveSetting("risk_profiles", s, uid)
		case "asset_type_labels":
			e = db.SaveSetting("asset_type_labels", s, uid)
		case "notify":
			e = db.SaveNotifyConfig(s)
		}
		if e != nil {
			res.Errors = append(res.Errors, "设置「"+kind+"」导入失败: "+e.Error())
		} else {
			res.Imported.Settings++
		}
	}
	saveRaw("risk_profiles", string(p.Settings.RiskProfiles))
	saveRaw("asset_type_labels", string(p.Settings.AssetTypeLabels))
	saveRaw("notify", string(p.Settings.Notify))

	// 计算器输入（equity / usd）
	for kind, raw := range p.CalcInputs {
		s := unwrapJSONString(string(raw))
		if s == "" || s == "null" {
			continue
		}
		if !json.Valid([]byte(s)) {
			res.Errors = append(res.Errors, "计算器输入「"+kind+"」不是合法 JSON，已跳过")
			continue
		}
		if err := db.SaveCalcInput(kind, s, uid); err != nil {
			res.Errors = append(res.Errors, "计算器输入「"+kind+"」导入失败: "+err.Error())
			continue
		}
		res.Imported.CalcInputs++
	}

	// 净值历史（pnl_daily，按 日期+用户 幂等 upsert）
	for _, ph := range p.PnlHistory {
		if ph.Date == "" {
			continue
		}
		if err := db.SavePnlDaily(ph.Date, ph.TotalCNY, ph.TotalUSD, ph.Rate, ph.BaseCNY, ph.Detail, uid); err != nil {
			res.Errors = append(res.Errors, "净值历史 "+ph.Date+" 导入失败: "+err.Error())
			continue
		}
		res.Imported.PnlHistory++
	}

	c.JSON(http.StatusOK, res)
}

// unwrapJSONString 兼容导出文件的两种形态：payload 既可能是被字符串化的 JSON
// （旧格式，形如 "\"[1,2]\""），也可能直接是数组/对象（新格式）。是字符串则解一层引号。
func unwrapJSONString(raw string) string {
	s := strings.TrimSpace(raw)
	if len(s) >= 2 && s[0] == '"' {
		var u string
		if json.Unmarshal([]byte(s), &u) == nil {
			return strings.TrimSpace(u)
		}
	}
	return s
}
