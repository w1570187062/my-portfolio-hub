package db

// 设备会话（认证层）：把「这台设备」映射到「哪些 user_id 可访问」。
//
// 设计要点（2026-10-28 引入，替代此前完全信任 X-User-Id 的做法）：
//   - 业务表一张不动，已有数据仍按 users.id 归属；本文件只新增映射表。
//   - 凭据是 32 字节随机 token，浏览器存在 HttpOnly Cookie 里，DB 只存 sha256。
//   - 一个会话可被授权访问多个账本（session_users），认领/配对时一次性授予，
//     避免"切个账本就要重新配对"。
//   - 加设备/邀请家人靠一次性配对码（pair_codes）：6 位码手输、长 secret 走二维码。

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	// SessionTTL 会话有效期；每次访问滑动续期（见 TouchSession）。
	SessionTTL = 180 * 24 * time.Hour
	// PairCodeTTL 本机加设备用的 6 位码有效期。
	PairCodeTTL = 5 * time.Minute
	// InviteCodeTTL 邀请家人用的码有效期。
	InviteCodeTTL = 24 * time.Hour

	sessionTimeFmt = "2006-01-02 15:04:05"
)

// Session 一条设备会话（对外不暴露 token）。
type Session struct {
	ID           int64  `json:"id"`
	UserID       int64  `json:"user_id"`        // 创建会话时的归属用户
	ActiveUserID int64  `json:"active_user_id"` // 当前激活账本
	UA           string `json:"ua"`
	Kind         string `json:"kind"` // device | service
	CreatedAt    string `json:"created_at"`
	LastSeen     string `json:"last_seen"`
	ExpiresAt    string `json:"expires_at"`
	Current      bool   `json:"current"` // 列表接口填充：是否当前请求所用会话
}

// PairCode 一次性配对码。
type PairCode struct {
	ID        int64  `json:"id"`
	Code      string `json:"code"`   // 6 位数字，手输用
	Secret    string `json:"secret"` // 24 字节 base64url，二维码用
	UserID    int64  `json:"user_id"`
	Scope     string `json:"scope"` // device | invite
	Label     string `json:"label"`
	ExpiresAt string `json:"expires_at"`
}

func initSessions() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token_hash TEXT NOT NULL UNIQUE,
			user_id INTEGER NOT NULL DEFAULT 0,
			active_user_id INTEGER NOT NULL DEFAULT 0,
			ua TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL DEFAULT 'device',
			created_at TEXT NOT NULL DEFAULT '',
			last_seen TEXT NOT NULL DEFAULT '',
			expires_at TEXT NOT NULL DEFAULT '',
			revoked INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
		`CREATE TABLE IF NOT EXISTS session_users (
			session_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			PRIMARY KEY (session_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS pair_codes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL,
			secret TEXT NOT NULL UNIQUE,
			user_id INTEGER NOT NULL DEFAULT 0,
			scope TEXT NOT NULL DEFAULT 'device',
			label TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT '',
			expires_at TEXT NOT NULL DEFAULT '',
			used INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pair_codes_code ON pair_codes(code)`,
		`CREATE TABLE IF NOT EXISTS auth_meta (
			k TEXT PRIMARY KEY,
			v TEXT NOT NULL DEFAULT ''
		)`,
	}
	for _, s := range stmts {
		if _, err := DB.Exec(s); err != nil {
			return fmt.Errorf("init sessions: %w", err)
		}
	}
	return nil
}

// EnsureSessions 幂等建表，由 EnsureUsers 统一调用（web / mcp 两条启动路径都覆盖）。
func EnsureSessions() error { return initSessions() }

// ---- token / 哈希 ----

// RandToken 生成 n 字节随机数的 base64url 文本。
func RandToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken 会话 token 落库前统一哈希，DB 泄露也无法直接冒充设备。
func HashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ---- 会话 CRUD ----

// CreateSession 新建会话，返回明文 token（仅此一次可见）。
func CreateSession(userID int64, ua, kind string) (string, *Session, error) {
	if kind == "" {
		kind = "device"
	}
	tok, err := RandToken(32)
	if err != nil {
		return "", nil, err
	}
	now := time.Now()
	s := &Session{
		UserID:       userID,
		ActiveUserID: userID,
		UA:           clip(ua, 200),
		Kind:         kind,
		CreatedAt:    now.Format(sessionTimeFmt),
		LastSeen:     now.Format(sessionTimeFmt),
		ExpiresAt:    now.Add(SessionTTL).Format(sessionTimeFmt),
	}
	res, err := DB.Exec(`INSERT INTO sessions(token_hash,user_id,active_user_id,ua,kind,created_at,last_seen,expires_at)
		VALUES(?,?,?,?,?,?,?,?)`,
		HashToken(tok), s.UserID, s.ActiveUserID, s.UA, s.Kind, s.CreatedAt, s.LastSeen, s.ExpiresAt)
	if err != nil {
		return "", nil, err
	}
	s.ID, _ = res.LastInsertId()
	return tok, s, nil
}

// ActiveSession 按 token 哈希取有效会话；不存在/过期/已吊销返回 (nil, nil)。
func ActiveSession(tokenHash string) (*Session, error) {
	var s Session
	err := DB.QueryRow(`SELECT id,user_id,active_user_id,ua,kind,created_at,last_seen,expires_at
		FROM sessions WHERE token_hash=? AND revoked=0 AND expires_at>?`,
		tokenHash, time.Now().Format(sessionTimeFmt)).
		Scan(&s.ID, &s.UserID, &s.ActiveUserID, &s.UA, &s.Kind, &s.CreatedAt, &s.LastSeen, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// ActiveSessionByID 按主键取有效会话（切换账本后回读状态用）。
func ActiveSessionByID(id int64) (*Session, error) {
	var s Session
	err := DB.QueryRow(`SELECT id,user_id,active_user_id,ua,kind,created_at,last_seen,expires_at
		FROM sessions WHERE id=? AND revoked=0 AND expires_at>?`,
		id, time.Now().Format(sessionTimeFmt)).
		Scan(&s.ID, &s.UserID, &s.ActiveUserID, &s.UA, &s.Kind, &s.CreatedAt, &s.LastSeen, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// TouchSession 滑动续期：10 分钟节流，避免每个请求都写库（DB 只有 1 个连接）。
func TouchSession(id int64) {
	now := time.Now()
	DB.Exec(`UPDATE sessions SET last_seen=?, expires_at=? WHERE id=? AND last_seen<?`,
		now.Format(sessionTimeFmt), now.Add(SessionTTL).Format(sessionTimeFmt), id,
		now.Add(-10*time.Minute).Format(sessionTimeFmt))
}

// SetSessionActiveUser 切换会话当前账本（调用方必须先校验授权）。
func SetSessionActiveUser(sessionID, userID int64) error {
	_, err := DB.Exec(`UPDATE sessions SET active_user_id=? WHERE id=?`, userID, sessionID)
	return err
}

// RevokeSession 吊销单个会话。
func RevokeSession(id int64) error {
	_, err := DB.Exec(`UPDATE sessions SET revoked=1 WHERE id=?`, id)
	return err
}

// ListSessionsForUser 列出「可访问该账本」的全部会话（设置页设备管理）。
func ListSessionsForUser(userID int64) ([]Session, error) {
	rows, err := DB.Query(`SELECT s.id,s.user_id,s.active_user_id,s.ua,s.kind,s.created_at,s.last_seen,s.expires_at
		FROM sessions s JOIN session_users su ON su.session_id=s.id
		WHERE su.user_id=? AND s.revoked=0 AND s.expires_at>?
		ORDER BY s.last_seen DESC`, userID, time.Now().Format(sessionTimeFmt))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.UserID, &s.ActiveUserID, &s.UA, &s.Kind, &s.CreatedAt, &s.LastSeen, &s.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CountActiveSessions 有效会话数；=0 说明还没有任何设备认领过（首启认领模式的判据）。
func CountActiveSessions() int {
	var n int
	if err := DB.QueryRow(`SELECT COUNT(1) FROM sessions WHERE revoked=0 AND expires_at>? AND kind='device'`,
		time.Now().Format(sessionTimeFmt)).Scan(&n); err != nil {
		return 0
	}
	return n
}

// ---- 会话 ↔ 账本授权 ----

// GrantSessionUser 授权会话访问某个账本（幂等）。
func GrantSessionUser(sessionID, userID int64) error {
	_, err := DB.Exec(`INSERT OR IGNORE INTO session_users(session_id,user_id) VALUES(?,?)`, sessionID, userID)
	return err
}

// SessionUsers 会话被授权访问的账本列表（保持 id 升序，前端下拉顺序稳定）。
func SessionUsers(sessionID int64) ([]User, error) {
	rows, err := DB.Query(`SELECT u.id,u.name,u.created_at FROM users u
		JOIN session_users su ON su.user_id=u.id WHERE su.session_id=? ORDER BY u.id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SessionHasUser 会话是否被授权访问该账本。
func SessionHasUser(sessionID, userID int64) bool {
	var n int
	if err := DB.QueryRow(`SELECT COUNT(1) FROM session_users WHERE session_id=? AND user_id=?`,
		sessionID, userID).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

// ---- 配对码 ----

// CreatePairCode 生成一次性配对码。scope=device 绑定本机；scope=invite 邀请家人。
func CreatePairCode(userID int64, scope, label string, ttl time.Duration) (*PairCode, error) {
	if scope == "" {
		scope = "device"
	}
	if ttl <= 0 {
		ttl = PairCodeTTL
	}
	secret, err := RandToken(24)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	exp := now.Add(ttl)
	// 6 位码只用于手输，# 空间 1e6：5 分钟内有效且全局最多 5 个活跃码，碰撞可控。
	var code string
	for attempt := 0; attempt < 8; attempt++ {
		c, e := randomDigits(6)
		if e != nil {
			return nil, e
		}
		var n int
		DB.QueryRow(`SELECT COUNT(1) FROM pair_codes WHERE code=? AND used=0 AND expires_at>?`, c,
			now.Format(sessionTimeFmt)).Scan(&n)
		if n == 0 {
			code = c
			break
		}
	}
	if code == "" {
		return nil, errors.New("配对码生成失败，请重试")
	}
	res, err := DB.Exec(`INSERT INTO pair_codes(code,secret,user_id,scope,label,created_at,expires_at)
		VALUES(?,?,?,?,?,?,?)`, code, secret, userID, scope, clip(label, 60),
		now.Format(sessionTimeFmt), exp.Format(sessionTimeFmt))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &PairCode{ID: id, Code: code, Secret: secret, UserID: userID, Scope: scope, Label: clip(label, 60),
		ExpiresAt: exp.Format(sessionTimeFmt)}, nil
}

func randomDigits(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	var sb strings.Builder
	for _, v := range b {
		sb.WriteByte(byte('0' + int(v)%10))
	}
	return sb.String(), nil
}

// FindPairCode 同时支持 6 位码与二维码 secret；未使用且在有效期内才算命中。
func FindPairCode(codeOrSecret string) (*PairCode, error) {
	codeOrSecret = strings.TrimSpace(codeOrSecret)
	if codeOrSecret == "" {
		return nil, nil
	}
	var p PairCode
	err := DB.QueryRow(`SELECT id,code,secret,user_id,scope,label,expires_at FROM pair_codes
		WHERE (code=? OR secret=?) AND used=0 AND expires_at>?`,
		codeOrSecret, codeOrSecret, time.Now().Format(sessionTimeFmt)).
		Scan(&p.ID, &p.Code, &p.Secret, &p.UserID, &p.Scope, &p.Label, &p.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ConsumePairCode 标记已用（一次性）。返回 false 表示已被别人抢先用掉。
func ConsumePairCode(id int64) bool {
	res, err := DB.Exec(`UPDATE pair_codes SET used=1 WHERE id=? AND used=0`, id)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

// PurgePairCodes 清理过期/已用码，避免堆积（启动时调用即可）。
func PurgePairCodes() {
	DB.Exec(`DELETE FROM pair_codes WHERE used=1 OR expires_at<?`, time.Now().Add(-24*time.Hour).Format(sessionTimeFmt))
}

// ---- auth_meta：PIN ----

// GetAuthMeta 读取认证层配置项（pin_hash 等）；不存在返回空串。
func GetAuthMeta(k string) string {
	var v string
	if err := DB.QueryRow(`SELECT v FROM auth_meta WHERE k=?`, k).Scan(&v); err != nil {
		return ""
	}
	return v
}

// SetAuthMeta 写入认证层配置项。
func SetAuthMeta(k, v string) error {
	_, err := DB.Exec(`INSERT INTO auth_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v)
	return err
}

// HasPIN 是否已设置操作 PIN。
func HasPIN() bool { return GetAuthMeta("pin_hash") != "" }

// SetPIN 保存 PIN（bcrypt）。PIN 为 4–6 位数字，由上层校验格式。
func SetPIN(pin string) error {
	h, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return SetAuthMeta("pin_hash", string(h))
}

// CheckPIN 校验 PIN；未设置 PIN 时一律返回 false（调用方据此判定"不需要"）。
func CheckPIN(pin string) bool {
	h := GetAuthMeta("pin_hash")
	if h == "" || pin == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(h), []byte(pin)) == nil
}

// ClearPIN 关闭 PIN（需要先验证旧 PIN，由上层保证）。
func ClearPIN() error { return SetAuthMeta("pin_hash", "") }

// ---- 用户改名（认领首次设备时可顺手把「默认」改成人名）----

// RenameUser 仅改显示名，id 与全部业务数据不动。
func RenameUser(id int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("用户名不能为空")
	}
	_, err := DB.Exec(`UPDATE users SET name=? WHERE id=?`, clip(name, 32), id)
	return err
}
