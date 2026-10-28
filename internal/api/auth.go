package api

// 认证层（2026-10-28）：设备配对 → HttpOnly 会话 Cookie，替代「客户端自报 X-User-Id」。
//
// 三种运行模式（环境变量）：
//   AUTH_MODE=off  开发直通，仍按 X-User-Id 解析（本地脚本/截图兼容），生产勿用
//   READ_ONLY=1    演示实例：GET 匿名放行（固定首个用户），任何写操作 403
//   默认           正常认证：无有效会话一律 401，前端据此进入「认领 / 配对」页
//
// 首启认领（bootstrap）：库里一条有效会话都没有时，允许第一台设备直接认领账本，
// 认领完成后该通道永久关闭。READ_ONLY 或 BOOTSTRAP=0 时关闭；关闭且无码可用时，
// 启动日志会打印一个一次性配对码作为救援通道。

import (
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

const (
	sessionCookieName = "pf_sess"
	// PIN 请求头：危险写操作（出码 / 删用户 / 清空 / 导入）额外校验
	pinHeader = "X-Auth-Pin"

	ctxUID = "pf_uid"
	ctxSID = "pf_sid"
	ctxRO  = "pf_readonly"
)

var pinPattern = regexp.MustCompile(`^\d{4,6}$`)

func authModeOff() bool { return strings.EqualFold(os.Getenv("AUTH_MODE"), "off") }

func readOnlyMode() bool { return os.Getenv("READ_ONLY") == "1" }

// bootstrapAllowed 首启认领是否开放：演示实例与显式关闭时不允许。
func bootstrapAllowed() bool {
	if readOnlyMode() || authModeOff() {
		return false
	}
	return os.Getenv("BOOTSTRAP") != "0"
}

func firstUserID() int64 {
	if us, err := db.ListUsers(); err == nil && len(us) > 0 {
		return us[0].ID
	}
	return 0
}

// EnsureBootstrapAccess 启动时调用：清理过期配对码，并在「无任何认证设备」时
// 打印救援配对码。逻辑分支：
//   - BOOTSTRAP 开放 → 首页可直接认领，无需码（仅内网实例该走这条路）
//   - BOOTSTRAP=0 且无设备 → 生成 24 小时一次性码写入日志，避免把自己锁死
func EnsureBootstrapAccess() {
	if authModeOff() || readOnlyMode() {
		return
	}
	db.PurgePairCodes()
	if db.CountActiveSessions() > 0 {
		return
	}
	if bootstrapAllowed() {
		log.Printf("[auth] 尚无认证设备：第一台打开页面的设备可直接认领账本（认领成功即永久关闭该通道）")
		return
	}
	uid := firstUserID()
	if uid == 0 {
		return
	}
	pc, err := db.CreatePairCode(uid, "device", "救援码", 24*time.Hour)
	if err != nil {
		log.Printf("[auth] 救援码生成失败：%v", err)
		return
	}
	log.Printf("[auth] 救援配对码：%s（24 小时有效，一次性；在未认证设备上输入即可接入）", pc.Code)
}

// ---- 中间件 ----

// AuthGuard 解析会话并把 uid 放进 context；currentUserID 只认这里写入的值。
func AuthGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if authModeOff() {
			c.Set(ctxUID, legacyHeaderUserID(c))
			c.Next()
			return
		}
		if readOnlyMode() {
			if isSafeMethod(c.Request.Method) {
				uid := firstUserID()
				if uid == 0 {
					c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "尚无用户"})
					return
				}
				c.Set(ctxUID, uid)
				c.Set(ctxRO, true)
				c.Next()
				return
			}
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "演示环境为只读模式"})
			return
		}
		tok, fromCookie := requestToken(c)
		if tok == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		s, err := db.ActiveSession(db.HashToken(tok))
		if err != nil || s == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		// Cookie 认证下的写操作必须是同源请求（CSRF 兜底）
		if fromCookie && !isSafeMethod(c.Request.Method) && !sameOrigin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "跨站请求被拒绝"})
			return
		}
		uid := s.ActiveUserID
		if uid == 0 || !db.SessionHasUser(s.ID, uid) {
			// 账本被删或授权已撤销：退回到该会话第一个被授权的账本
			us, _ := db.SessionUsers(s.ID)
			if len(us) == 0 {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "会话无可用账本，请重新配对"})
				return
			}
			uid = us[0].ID
			db.SetSessionActiveUser(s.ID, uid)
		}
		db.TouchSession(s.ID)
		c.Set(ctxUID, uid)
		c.Set(ctxSID, s.ID)
		c.Next()
	}
}

// PinGuard 危险操作的第二道锁；未设置 PIN 时直接放行（首次使用引导在设置页）。
func PinGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if authModeOff() || readOnlyMode() || !db.HasPIN() {
			c.Next()
			return
		}
		if !db.CheckPIN(c.GetHeader(pinHeader)) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "需要操作 PIN", "pin_required": true})
			return
		}
		c.Next()
	}
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// sameOrigin 校验 Origin/Referer 与请求 Host 同源；两者都缺失时按同源处理（非浏览器客户端）。
func sameOrigin(c *gin.Context) bool {
	if site := c.GetHeader("Sec-Fetch-Site"); site == "cross-site" || site == "same-site" {
		return false
	}
	origin := c.GetHeader("Origin")
	if origin == "" {
		origin = c.GetHeader("Referer")
	}
	if origin == "" {
		return true
	}
	host := c.Request.Host
	origin = strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	if i := strings.IndexByte(origin, '/'); i >= 0 {
		origin = origin[:i]
	}
	return strings.EqualFold(origin, host)
}

// requestToken 从 Cookie 或 Authorization: Bearer 取会话 token。
func requestToken(c *gin.Context) (tok string, fromCookie bool) {
	if ck, err := c.Cookie(sessionCookieName); err == nil && ck != "" {
		return ck, true
	}
	if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), false
	}
	return "", false
}

func setSessionCookie(c *gin.Context, tok string) {
	c.SetSameSite(http.SameSiteLaxMode)
	// 内网为 http，不能加 Secure；安全性靠 32 字节随机 token + HttpOnly。
	c.SetCookie(sessionCookieName, tok, int(db.SessionTTL.Seconds()), "/", "", false, true)
}

func clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, "", -1, "/", "", false, true)
}

// legacyHeaderUserID 仅供 AUTH_MODE=off 的开发直通使用。
func legacyHeaderUserID(c *gin.Context) int64 {
	if id := parseID(c.GetHeader("X-User-Id")); id > 0 {
		return id
	}
	return firstUserID()
}

func parseID(raw string) int64 {
	var id int64
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	for _, ch := range raw {
		if ch < '0' || ch > '9' {
			return 0
		}
		id = id*10 + int64(ch-'0')
	}
	return id
}

// ---- 状态 ----
type sessionUserView struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count,omitempty"`
}

type sessionStateResp struct {
	Authed   bool              `json:"authed"`
	Mode     string            `json:"mode"` // ok | claim | pair | readonly
	User     *sessionUserView  `json:"user,omitempty"`
	Users    []sessionUserView `json:"users,omitempty"`
	ReadOnly bool              `json:"read_only"`
	HasPIN   bool              `json:"has_pin"`
	Devices  int               `json:"devices"`
}

func buildState(s *db.Session) sessionStateResp {
	out := sessionStateResp{Authed: true, Mode: "ok", HasPIN: db.HasPIN()}
	us, _ := db.SessionUsers(s.ID)
	uid := s.ActiveUserID
	for _, u := range us {
		view := sessionUserView{ID: u.ID, Name: u.Name}
		if u.ID == uid {
			out.User = &view
		}
		out.Users = append(out.Users, view)
	}
	if out.User == nil && len(us) > 0 {
		out.User = &sessionUserView{ID: us[0].ID, Name: us[0].Name}
		db.SetSessionActiveUser(s.ID, us[0].ID)
	}
	out.Devices = 0
	if list, err := db.ListSessionsForUser(uid); err == nil {
		out.Devices = len(list)
	}
	return out
}

// currentSessionID 当前请求所用的会话 id（设备管理里标记「本机」）。
func currentSessionID(c *gin.Context) int64 {
	if v, ok := c.Get(ctxSID); ok {
		if id, ok := v.(int64); ok {
			return id
		}
	}
	return 0
}

// sessionState GET /api/session —— 前端首屏判据（未认证时告知走认领还是配对）。
func sessionState(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if authModeOff() {
		users, _ := db.ListUsers()
		out := sessionStateResp{Authed: true, Mode: "ok", HasPIN: db.HasPIN()}
		for _, u := range users {
			v := sessionUserView{ID: u.ID, Name: u.Name}
			if u.ID == firstUserID() {
				out.User = &v
			}
			out.Users = append(out.Users, v)
		}
		c.JSON(http.StatusOK, out)
		return
	}
	if readOnlyMode() {
		out := sessionStateResp{Authed: true, Mode: "readonly", ReadOnly: true}
		if uid := firstUserID(); uid > 0 {
			if u, err := db.GetUser(uid); err == nil {
				out.User = &sessionUserView{ID: u.ID, Name: u.Name}
			}
		}
		c.JSON(http.StatusOK, out)
		return
	}
	if tok, _ := requestToken(c); tok != "" {
		if s, err := db.ActiveSession(db.HashToken(tok)); err == nil && s != nil {
			c.JSON(http.StatusOK, buildState(s))
			return
		}
	}
	out := sessionStateResp{Mode: "pair", HasPIN: db.HasPIN()}
	if bootstrapAllowed() && db.CountActiveSessions() == 0 {
		out.Mode = "claim"
		users, _ := db.ListUsers()
		for _, u := range users {
			v := sessionUserView{ID: u.ID, Name: u.Name}
			if st, err := db.CountUserData(u.ID); err == nil {
				v.Count = st["total"]
			}
			out.Users = append(out.Users, v)
		}
	}
	c.JSON(http.StatusOK, out)
}

// ---- 首启认领 ----

type claimReq struct {
	UserIDs  []int64 `json:"user_ids"`
	RenameTo string  `json:"rename_to"`
}

// sessionClaim POST /api/session/claim —— 首台设备认领已有账本（不改 user_id，数据零迁移）。
func sessionClaim(c *gin.Context) {
	if !bootstrapAllowed() {
		c.JSON(http.StatusForbidden, gin.H{"error": "该实例不接受直接认领，请用配对码登录"})
		return
	}
	if db.CountActiveSessions() > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "该实例已有认证设备，请用配对码登录"})
		return
	}
	var b claimReq
	if err := c.ShouldBindJSON(&b); err != nil || len(b.UserIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请至少选择一个账本"})
		return
	}
	uids := make([]int64, 0, len(b.UserIDs))
	for _, id := range b.UserIDs {
		if _, err := db.GetUser(id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "账本不存在"})
			return
		}
		uids = append(uids, id)
	}
	if len(uids) == 1 && strings.TrimSpace(b.RenameTo) != "" {
		if err := db.RenameUser(uids[0], b.RenameTo); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	tok, s, err := db.CreateSession(uids[0], c.Request.UserAgent(), "device")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, id := range uids {
		db.GrantSessionUser(s.ID, id)
	}
	setSessionCookie(c, tok)
	log.Printf("[auth] 首台设备已认领账本 %v（UA=%s）", uids, s.UA)
	c.JSON(http.StatusOK, buildState(s))
}

// ---- 配对 ----

var (
	pairMu       sync.Mutex
	pairAttempts = map[string][]time.Time{}
)

// allowPair 每个来源 5 分钟内最多 10 次尝试，挡住 6 位码穷举。
func allowPair(ip string) bool {
	pairMu.Lock()
	defer pairMu.Unlock()
	cut := time.Now().Add(-5 * time.Minute)
	list := pairAttempts[ip]
	kept := list[:0]
	for _, t := range list {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= 10 {
		pairAttempts[ip] = kept
		return false
	}
	pairAttempts[ip] = append(kept, time.Now())
	return true
}

type pairReq struct {
	Code string `json:"code"`
}

// sessionPair POST /api/session/pair —— 用一次性码把当前设备接入。
func sessionPair(c *gin.Context) {
	if !allowPair(c.ClientIP()) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "尝试过于频繁，请 5 分钟后再试"})
		return
	}
	var b pairReq
	if err := c.ShouldBindJSON(&b); err != nil || strings.TrimSpace(b.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入配对码"})
		return
	}
	pc, err := db.FindPairCode(b.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if pc == nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "配对码无效或已过期"})
		return
	}
	if !db.ConsumePairCode(pc.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "配对码已被使用"})
		return
	}
	if pc.UserID <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "配对码未绑定账本"})
		return
	}
	// 邀请码指向的账本可能已被删除
	if _, err := db.GetUser(pc.UserID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "配对码对应的账本已不存在"})
		return
	}
	tok, s, err := db.CreateSession(pc.UserID, c.Request.UserAgent(), "device")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	db.GrantSessionUser(s.ID, pc.UserID)
	setSessionCookie(c, tok)
	log.Printf("[auth] 设备配对成功：uid=%d scope=%s（UA=%s）", pc.UserID, pc.Scope, s.UA)
	c.JSON(http.StatusOK, buildState(s))
}

// ---- 出码 ----

type pairCodeReq struct {
	Scope  string `json:"scope"`   // device | invite
	UserID int64  `json:"user_id"` // invite：授权已有账本（必须在当前会话授权范围内）
	Name   string `json:"name"`    // invite：新建账本名称
	Label  string `json:"label"`
}

// sessionCode POST /api/session/code —— 已认证设备为「加设备 / 邀请家人」出一次性码。
func sessionCode(c *gin.Context) {
	uid := currentUserID(c)
	sid := currentSessionID(c)
	var b pairCodeReq
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	scope := b.Scope
	if scope == "" {
		scope = "device"
	}
	target := uid
	ttl := db.PairCodeTTL
	label := b.Label
	switch scope {
	case "device":
		if label == "" {
			label = "新设备"
		}
	case "invite":
		ttl = db.InviteCodeTTL
		if strings.TrimSpace(b.Name) != "" {
			id, err := db.CreateUser(strings.TrimSpace(b.Name))
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			target = id
			// 新账本对本机也开放，省得再配一次
			db.GrantSessionUser(sid, id)
			if label == "" {
				label = "新账本"
			}
		} else if b.UserID > 0 {
			// 只允许把「自己已能访问的账本」再授权出去，避免越权扩散
			if !db.SessionHasUser(sid, b.UserID) {
				c.JSON(http.StatusForbidden, gin.H{"error": "无权授权该账本"})
				return
			}
			target = b.UserID
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要邀请的账本，或填写新账本名称"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的配对类型"})
		return
	}
	pc, err := db.CreatePairCode(target, scope, label, ttl)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":       pc.Code,
		"secret":     pc.Secret,
		"url":        "/#/pair?t=" + pc.Secret,
		"expires_at": pc.ExpiresAt,
		"expires_in": int(ttl.Seconds()),
	})
}

// ---- 设备管理 ----

func sessionDevices(c *gin.Context) {
	uid := currentUserID(c)
	sid := currentSessionID(c)
	list, err := db.ListSessionsForUser(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]db.Session, 0, len(list))
	for _, s := range list {
		s.Current = s.ID == sid
		out = append(out, s)
	}
	c.JSON(http.StatusOK, gin.H{"devices": out})
}

func sessionDeviceRevoke(c *gin.Context) {
	uid := currentUserID(c)
	id := parseID(c.Param("id"))
	if id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad id"})
		return
	}
	// 只能吊销「自己有权限的那个账本」名下的会话
	if !db.SessionHasUser(id, uid) {
		c.JSON(http.StatusNotFound, gin.H{"error": "设备不存在"})
		return
	}
	if err := db.RevokeSession(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- 切换账本 / 退出 / PIN ----

type switchReq struct {
	UserID int64 `json:"user_id"`
}

func sessionSwitch(c *gin.Context) {
	sid := currentSessionID(c)
	var b switchReq
	if err := c.ShouldBindJSON(&b); err != nil || b.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if !db.SessionHasUser(sid, b.UserID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "该账本未授权给本设备"})
		return
	}
	if err := db.SetSessionActiveUser(sid, b.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s, err := db.ActiveSessionByID(sid)
	if err != nil || s == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, buildState(s))
}

func sessionLogout(c *gin.Context) {
	sid := currentSessionID(c)
	if sid > 0 {
		db.RevokeSession(sid)
	}
	clearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type pinReq struct {
	PIN    string `json:"pin"`
	OldPIN string `json:"old_pin"`
}

// sessionPIN POST /api/session/pin —— 设置 / 修改 / 关闭操作 PIN（4–6 位数字）。
func sessionPIN(c *gin.Context) {
	var b pinReq
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if db.HasPIN() && !db.CheckPIN(b.OldPIN) {
		c.JSON(http.StatusForbidden, gin.H{"error": "原 PIN 不正确"})
		return
	}
	pin := strings.TrimSpace(b.PIN)
	if pin == "" { // 关闭 PIN
		if err := db.ClearPIN(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "has_pin": false})
		return
	}
	if !pinPattern.MatchString(pin) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "PIN 需为 4–6 位数字"})
		return
	}
	if err := db.SetPIN(pin); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "has_pin": true})
}
