package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/smtp"
	"net/url"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// ---- 通知渠道配置 ----

type dingtalkCfg struct {
	Enabled bool   `json:"enabled"`
	Webhook string `json:"webhook"` // 含 access_token 的完整 webhook 地址
	Secret  string `json:"secret"`  // 选填：机器人"加签"安全设置里的密钥
}

type emailCfg struct {
	Enabled  bool   `json:"enabled"`
	SMTPHost string `json:"smtp_host"`
	SMTPPort int    `json:"smtp_port"` // 465=隐式TLS，587/25=STARTTLS
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	To       string `json:"to"` // 逗号分隔多个收件人
}

type notifyConfig struct {
	Dingtalk dingtalkCfg `json:"dingtalk"`
	Email    emailCfg    `json:"email"`
	// Policy controls how often net-value notifications are sent:
	//   "" / "every"      —— 每次净值更新都推送（默认）
	//   "only_close"      —— 仅收盘后定时快照推送
	//   "only_signal"     —— 仅在有补仓信号时推送
	Policy string `json:"policy"`
}

func loadNotifyConfig() (notifyConfig, error) {
	raw, err := db.GetNotifyConfig()
	if err != nil {
		return notifyConfig{}, err
	}
	var cfg notifyConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return notifyConfig{}, err
	}
	return cfg, nil
}

func notifySettingsGet(c *gin.Context) {
	cfg, err := loadNotifyConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func notifySettingsPost(c *gin.Context) {
	var b notifyConfig
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数格式错误: " + err.Error()})
		return
	}
	// 控制字段长度，避免有人把巨大字符串塞进配置
	if len(b.Dingtalk.Webhook) > 2000 || len(b.Dingtalk.Secret) > 500 ||
		len(b.Email.SMTPHost) > 200 || len(b.Email.Username) > 200 ||
		len(b.Email.Password) > 500 || len(b.Email.From) > 200 || len(b.Email.To) > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "配置字段超出长度限制"})
		return
	}
	raw, _ := json.Marshal(b)
	if err := db.SaveNotifyConfig(string(raw)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// notifyTest 发送测试通知到所有已开启的渠道（或指定 channel="dingtalk"/"email"）。
func notifyTest(c *gin.Context) {
	var req struct {
		Channel string `json:"channel"`
	}
	_ = c.ShouldBindJSON(&req)
	cfg, err := loadNotifyConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	results := map[string]string{}
	want := func(ch string) bool {
		return req.Channel == "" || req.Channel == ch
	}
	if want("dingtalk") && cfg.Dingtalk.Enabled && cfg.Dingtalk.Webhook != "" {
		test := "## 测试通知\n\n这是一条来自「观澜·持仓管理」的**测试**消息。\n\n> 若你收到此消息，说明钉钉通知渠道配置正确 ✅"
		if e := sendDingtalk(cfg.Dingtalk, "持仓通知测试", test); e != nil {
			results["dingtalk"] = "失败: " + e.Error()
		} else {
			results["dingtalk"] = "ok"
		}
	}
	if want("email") && cfg.Email.Enabled {
		if e := sendEmail(cfg.Email, "持仓通知测试", "这是一封来自「观澜·持仓管理」的测试邮件。\n\n若你收到此邮件，说明邮箱通知渠道配置正确。\n"); e != nil {
			results["email"] = "失败: " + e.Error()
		} else {
			results["email"] = "ok"
		}
	}
	if len(results) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "没有已开启且配置完整的渠道可测试"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

// ---- 发送实现 ----

// dingtalkSignedURL 追加加签参数（若配置了 secret）。
func dingtalkSignedURL(webhook, secret string) string {
	if secret == "" {
		return webhook
	}
	timestamp := fmt.Sprintf("%d", time.Now().UnixNano()/int64(time.Millisecond))
	stringToSign := timestamp + "\n" + secret
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stringToSign))
	sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	sep := "?"
	if strings.Contains(webhook, "?") {
		sep = "&"
	}
	return webhook + sep + "timestamp=" + url.QueryEscape(timestamp) + "&sign=" + url.QueryEscape(sign)
}

func sendDingtalk(cfg dingtalkCfg, title, markdown string) error {
	u := dingtalkSignedURL(cfg.Webhook, cfg.Secret)
	payload := map[string]interface{}{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": title,
			"text":  markdown,
		},
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post(u, "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	// 钉钉返回 errcode != 0 仍算 HTTP 200，需解析判断
	var dr struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if json.Unmarshal(body, &dr) == nil && dr.ErrCode != 0 {
		return fmt.Errorf("errcode %d: %s", dr.ErrCode, dr.ErrMsg)
	}
	return nil
}

func sendEmail(cfg emailCfg, subject, body string) error {
	recipients := []string{}
	for _, r := range strings.Split(cfg.To, ",") {
		r = strings.TrimSpace(r)
		if r != "" {
			recipients = append(recipients, r)
		}
	}
	if len(recipients) == 0 {
		return fmt.Errorf("未配置收件人(to)")
	}
	var msg bytes.Buffer
	msg.WriteString("From: " + cfg.From + "\r\n")
	msg.WriteString("To: " + strings.Join(recipients, ",") + "\r\n")
	msg.WriteString("Subject: =?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(subject)) + "?=\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	msg.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	msg.WriteString(base64.StdEncoding.EncodeToString([]byte(body)))

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)
	auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.SMTPHost)

	if cfg.SMTPPort == 465 {
		// 隐式 TLS：先建立 TLS 连接，再走 SMTP 协议
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.SMTPHost})
		if err != nil {
			return err
		}
		defer conn.Close()
		client, err := smtp.NewClient(conn, cfg.SMTPHost)
		if err != nil {
			return err
		}
		defer client.Quit()
		if err := client.Auth(auth); err != nil {
			return err
		}
		if err := client.Mail(cfg.From); err != nil {
			return err
		}
		for _, rcpt := range recipients {
			if err := client.Rcpt(rcpt); err != nil {
				return err
			}
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(msg.Bytes()); err != nil {
			return err
		}
		return w.Close()
	}
	// STARTTLS（587 / 25 等）：smtp.SendMail 会自动尝试 STARTTLS
	return smtp.SendMail(addr, auth, cfg.From, recipients, msg.Bytes())
}

// ---- 净值更新触发通知 ----

// buySignal 补仓信号：某持仓的某一档已到补仓点位（操作指南里的动态补仓计划）。
type buySignal struct {
	Name         string
	Symbol       string
	LinkedSymbol string
	TierLabel    string
	TierPrice    float64
	Drawdown     float64
	Amount       float64
	Signal       string
}

// scope 限定通知/信号的范围："" / "all" = 全部；"us" = 美股；"cn" = A股；"fund" = 基金。
// 定时快照按资产类别分时段触发（美股07:00 / A股15:15 / 基金21:00），只在对应范围有数据更新，
// 故通知只列该范围；手动刷新/快照传 "" 表示全量。
func inScope(h db.Holding, scope string) bool {
	switch scope {
	case "us":
		return h.Market == "美股"
	case "cn":
		// 注意：A股持仓的 market 存的是「沪深」，须一并匹配，否则 15:15 A股快照
		// 会把 A股持仓过滤成空，推送变成「A股 本次无持仓盈亏变动」的空通知。
		return h.Market == "A股" || h.Market == "沪深"
	case "fund":
		return h.Category == "fund"
	default:
		return true
	}
}

func scopeLabelCN(scope string) string {
	switch scope {
	case "us":
		return "美股"
	case "cn":
		return "A股"
	case "fund":
		return "基金"
	default:
		return "全部"
	}
}

// scopeFromLabel 由定时快照的 label（如「美股(07:00)」）推导通知范围。
func scopeFromLabel(label string) string {
	if strings.Contains(label, "美股") {
		return "us"
	}
	if strings.Contains(label, "A股") {
		return "cn"
	}
	if strings.Contains(label, "基金") {
		return "fund"
	}
	return ""
}

// collectBuySignals 遍历所有持仓的补仓计划（holdings.buy_plan，由净值刷新时计算、
// 操作指南弹框展示的同一份数据），收集「联接ETF最新价已到该档触发价」的档位。
// scope 非全量时仅保留该范围内的持仓信号（如 15:15 A股定时快照不展示基金补仓信号，
// 因基金价格尚未在此时刷新、信号为陈旧值）。
// 注意：BuyPlanTier.Signal 是档位说明文字（恒非空），不是触发标记；
// 真正判定「价格已到补仓点位」是 ETFLatest（联接ETF最新价）≤ 该档 Price。
func collectBuySignals(uid int64, scope string) []buySignal {
	hs, err := db.List(uid)
	if err != nil {
		log.Printf("[notify] 读取持仓失败: %v", err)
		return nil
	}
	var out []buySignal
	execKeys, _ := db.ListExecutedBuyPlanKeys()
	for _, h := range hs {
		if !inScope(h, scope) {
			continue
		}
		if strings.TrimSpace(h.BuyPlan) == "" {
			continue
		}
		var plan struct {
			HasData   bool `json:"HasData"`
			ETFLatest float64 `json:"ETFLatest"`
			Tiers     []struct {
				Label    string  `json:"Label"`
				Price    float64 `json:"Price"`
				Drawdown float64 `json:"Drawdown"`
				Amount   float64 `json:"Amount"`
				Signal   string  `json:"Signal"`
			} `json:"Tiers"`
		}
		if json.Unmarshal([]byte(h.BuyPlan), &plan) != nil || !plan.HasData {
			continue
		}
		for idx, t := range plan.Tiers {
			// 已"标记已补"的档位不再计入待触发信号
			if execKeys[fmt.Sprintf("%d:%d", h.ID, idx)] {
				continue
			}
			// 价格到点位：联接ETF最新价 ≤ 触发价（浮点误差极小，直接比较）
			if plan.ETFLatest <= 0 || plan.ETFLatest > t.Price {
				continue
			}
			out = append(out, buySignal{
				Name:         h.Name,
				Symbol:       h.Symbol,
				LinkedSymbol: h.LinkedSymbol,
				TierLabel:    t.Label,
				TierPrice:    t.Price,
				Drawdown:     t.Drawdown,
				Amount:       t.Amount,
				Signal:       t.Signal,
			})
		}
	}
	return out
}

// buildNetValueNotifyText 构造通知正文：触发来源 + 更新范围 + 补仓信号 + 日期 + 当日盈亏概览。
// scope 限定只列出该范围内（美股/A股/基金）的持仓盈亏与补仓信号；"" / "all" 为全量（手动刷新）。
func buildNetValueNotifyText(uid int64, triggeredBy, scope string) string {
	date := time.Now().Format("2006-01-02")
	label := scopeLabelCN(scope)
	var sb strings.Builder
	sb.WriteString("## 持仓净值已更新\n\n")
	sb.WriteString(fmt.Sprintf("- **触发**：%s\n", triggeredBy))
	sb.WriteString(fmt.Sprintf("- **更新范围**：%s\n", label))
	sb.WriteString(fmt.Sprintf("- **日期**：%s\n", date))

	// 补仓信号重点提示：有条目已到补仓点位时置顶突出（按范围过滤）
	if sigs := collectBuySignals(uid, scope); len(sigs) > 0 {
		sb.WriteString(fmt.Sprintf("\n## 🚨 补仓信号（%d 档已到补仓点位）\n\n", len(sigs)))
		for _, s := range sigs {
			sb.WriteString(fmt.Sprintf("- **%s**（%s · 联接 %s）\n", s.Name, s.Symbol, s.LinkedSymbol))
			sb.WriteString(fmt.Sprintf("  触发档：`%s`　触发价 %.3f　自高点回撤 %.1f%%　建议投入 ¥%.2f\n",
				s.TierLabel, s.TierPrice, math.Abs(s.Drawdown), s.Amount))
			sb.WriteString("  > 信号：" + s.Signal + "\n")
		}
	}

	// 持仓范围映射，用于按 scope 过滤明细中的按标的盈亏
	hmap := map[string]db.Holding{}
	if hs, err := db.List(uid); err == nil {
		for _, h := range hs {
			hmap[h.Symbol] = h
		}
	}

	if row, err := db.GetPnlLatest(uid); err == nil && row != nil {
		if row.Detail != "" {
			// 解析明细中的按标的盈亏，按更新范围过滤，最多列 15 条
			var d struct {
				BySymbol []struct {
					Symbol       string  `json:"symbol"`
					Name         string  `json:"name"`
					Pnl          float64 `json:"pnl"`
					PnlCNY       float64 `json:"pnl_cny"`
					Currency     string  `json:"currency"`
					CurrentPrice float64 `json:"current_price"`
					ChangePct    float64 `json:"change_pct"`
				} `json:"by_symbol"`
			}
			if json.Unmarshal([]byte(row.Detail), &d) == nil {
				scoped := make([]struct {
					Symbol       string  `json:"symbol"`
					Name         string  `json:"name"`
					Pnl          float64 `json:"pnl"`
					PnlCNY       float64 `json:"pnl_cny"`
					Currency     string  `json:"currency"`
					CurrentPrice float64 `json:"current_price"`
					ChangePct    float64 `json:"change_pct"`
				}, 0, len(d.BySymbol))
				var sCNY, sUSD float64
				for _, s := range d.BySymbol {
					if h, ok := hmap[s.Symbol]; ok && !inScope(h, scope) {
						continue
					}
					scoped = append(scoped, s)
					if strings.EqualFold(s.Currency, "USD") || strings.EqualFold(s.Currency, "HKD") {
						sUSD += s.Pnl
					} else {
						sCNY += s.PnlCNY
					}
				}
				sb.WriteString(fmt.Sprintf("- **当日总盈亏（%s）**：¥%s\n", label, moneyFmt(sCNY)))
				if sUSD != 0 {
					sb.WriteString(fmt.Sprintf("- **美元盈亏（%s）**：$%s\n", label, moneyFmt(sUSD)))
				}
				if len(scoped) > 0 {
					sb.WriteString(fmt.Sprintf("\n**%s 当日盈亏（按原币种）**：\n", label))
					n := 0
					for _, s := range scoped {
						if n >= 15 {
							sb.WriteString(fmt.Sprintf("- （其余 %d 只未列出）\n", len(scoped)-15))
							break
						}
						amt := s.PnlCNY
						if strings.EqualFold(s.Currency, "USD") || strings.EqualFold(s.Currency, "HKD") {
							amt = s.Pnl
						}
						priceStr := fmt.Sprintf("%s%.2f", curSymbol(s.Currency), s.CurrentPrice)
						chgStr := "—"
						if s.ChangePct >= 0.005 || s.ChangePct <= -0.005 {
							chgStr = moneyFmt(s.ChangePct) + "%"
						}
						sb.WriteString(fmt.Sprintf("- %s %s：现价%s 涨跌%s 当日%s%s\n",
							s.Symbol, s.Name, priceStr, chgStr, curSymbol(s.Currency), moneyFmt(amt)))
						n++
					}
				} else {
					sb.WriteString(fmt.Sprintf("\n> %s 本次无持仓盈亏变动\n", label))
				}
			}
		}
	}
	sb.WriteString("\n> 由「观澜·持仓管理」自动推送")
	return sb.String()
}

func moneyFmt(v float64) string {
	sign := ""
	if v > 0 {
		sign = "+"
	}
	return sign + fmt.Sprintf("%.2f", v)
}

// NotifyNetValueUpdated 在净值更新（手动或自动）完成后异步推送通知。
// 后台 goroutine 执行，绝不阻塞刷新响应。无开启渠道时直接返回。
// scope 限定通知范围（"" / "all" = 全量；"us"/"cn"/"fund" = 仅对应类别）；手动刷新传全量。
// 该范围内无任何持仓时视为「无净值数据更新」，直接跳过推送，避免空通知。
func NotifyNetValueUpdated(uid int64, triggeredBy, scope string) {
	go func() {
		cfg, err := loadNotifyConfig()
		if err != nil {
			log.Printf("[notify] 读取配置失败: %v", err)
			return
		}
		if !cfg.Dingtalk.Enabled && !cfg.Email.Enabled {
			return
		}
		if !hasHoldingsInScope(uid, scope) {
			log.Printf("[notify] 无%s持仓净值数据，跳过推送（触发：%s）", scopeLabelCN(scope), triggeredBy)
			return
		}
		if !shouldSendByPolicy(uid, cfg, triggeredBy, scope) {
			log.Printf("[notify] 按推送策略(%s)跳过本次推送（触发：%s）", policyName(cfg.Policy), triggeredBy)
			return
		}
		text := buildNetValueNotifyText(uid, triggeredBy, scope)
		sendToChannels(cfg, "持仓净值更新", text)
	}()
}

// hasHoldingsInScope 判断该用户在指定范围内是否存在持仓。
// 定时快照按资产类别分时段触发（美股07:00 / A股15:15 / 基金21:00），若对应类别
// 无任何持仓（如没有基金持仓却在 21:00 基金快照），本次没有任何净值数据可推送，
// 直接跳过，避免收到「XX 本次无持仓盈亏变动」之类的空通知。
func hasHoldingsInScope(uid int64, scope string) bool {
	hs, err := db.List(uid)
	if err != nil {
		log.Printf("[notify] 读取持仓失败: %v", err)
		return false
	}
	for _, h := range hs {
		if inScope(h, scope) {
			return true
		}
	}
	return false
}

// shouldSendByPolicy decides whether a net-value update should be pushed given
// the configured frequency policy and the trigger source.
func shouldSendByPolicy(uid int64, cfg notifyConfig, triggeredBy, scope string) bool {
	switch cfg.Policy {
	case "only_close":
		// 仅收盘后定时快照（A股15:15 / 基金21:00 / 美股07:00）推送
		return strings.Contains(triggeredBy, "定时快照")
	case "only_signal":
		// 仅在有补仓信号时推送（按范围过滤，避免展示未刷新类别的陈旧信号）
		return len(collectBuySignals(uid, scope)) > 0
	default: // "" / "every"
		return true
	}
}

func policyName(p string) string {
	switch p {
	case "only_close":
		return "仅收盘后"
	case "only_signal":
		return "仅补仓信号"
	default:
		return "每次更新"
	}
}

// sendToChannels sends text (markdown) to all enabled channels (dingtalk + email).
func sendToChannels(cfg notifyConfig, title, text string) {
	if cfg.Dingtalk.Enabled && cfg.Dingtalk.Webhook != "" {
		if e := sendDingtalk(cfg.Dingtalk, title, text); e != nil {
			log.Printf("[notify] 钉钉发送失败: %v", e)
		} else {
			log.Printf("[notify] 钉钉发送成功")
		}
	}
	if cfg.Email.Enabled {
		if e := sendEmail(cfg.Email, title+"通知", stripMarkdown(text)); e != nil {
			log.Printf("[notify] 邮箱发送失败: %v", e)
		} else {
			log.Printf("[notify] 邮箱发送成功")
		}
	}
}

// NotifyAIContent sends AI-generated content (e.g. 收盘后自动总结) to all
// enabled channels. Runs in a background goroutine.
func NotifyAIContent(title, text string) {
	go func() {
		cfg, err := loadNotifyConfig()
		if err != nil {
			log.Printf("[notify] 读取配置失败: %v", err)
			return
		}
		if !cfg.Dingtalk.Enabled && !cfg.Email.Enabled {
			return
		}
		sendToChannels(cfg, title, text)
	}()
}

// stripMarkdown 把钉钉 markdown 正文转成纯文本，供邮件正文使用（去掉 **、> 等）。
func stripMarkdown(s string) string {
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "## ", "")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		l = strings.TrimPrefix(l, "> ")
		lines[i] = l
	}
	return strings.Join(lines, "\n")
}
