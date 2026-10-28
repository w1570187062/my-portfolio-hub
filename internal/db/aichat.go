package db

import (
	"time"
)

// ---- AI 助手会话（右下角悬浮聊天面板）----
//
// 两张表：
//   ai_chats          —— 一条会话（左侧历史列表的一项）
//   ai_chat_messages  —— 会话内的消息（role: user/assistant/system/tool）
//
// 与 holdings 等实体一样按 user_id 隔离；用户清空/删除时一并清理（见 users.go ClearUserData）。

type AIChat struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Title     string `json:"title"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type AIChatMessage struct {
	ID        int64  `json:"id"`
	ChatID    int64  `json:"chat_id"`
	Role      string `json:"role"` // user / assistant / tool
	Content   string `json:"content"`
	ToolName  string `json:"tool_name,omitempty"`
	CreatedAt string `json:"created_at"`
}

func initAIChats() error {
	if _, err := DB.Exec(`CREATE TABLE IF NOT EXISTS ai_chats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL DEFAULT 0,
		title TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		return err
	}
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id INTEGER NOT NULL DEFAULT 0,
		role TEXT NOT NULL DEFAULT 'user',
		content TEXT NOT NULL DEFAULT '',
		tool_name TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT ''
	)`)
	return err
}

const aiChatMaxMessages = 200 // 单会话保留的最大消息条数（超出丢最旧的，避免无限膨胀）

// ListAIChats 返回某用户的会话列表（最近更新的在前）。
func ListAIChats(userID int64) ([]AIChat, error) {
	rows, err := DB.Query(`SELECT id, user_id, title, created_at, updated_at
		FROM ai_chats WHERE user_id=? ORDER BY updated_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIChat{}
	for rows.Next() {
		var c AIChat
		if err := rows.Scan(&c.ID, &c.UserID, &c.Title, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateAIChat 新建会话并返回 id。
func CreateAIChat(userID int64, title string) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := DB.Exec(`INSERT INTO ai_chats (user_id, title, created_at, updated_at) VALUES (?,?,?,?)`,
		userID, title, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetAIChat 取会话（带用户归属校验）。
func GetAIChat(id, userID int64) (*AIChat, error) {
	var c AIChat
	err := DB.QueryRow(`SELECT id, user_id, title, created_at, updated_at FROM ai_chats WHERE id=? AND user_id=?`,
		id, userID).Scan(&c.ID, &c.UserID, &c.Title, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// RenameAIChat 重命名会话。
func RenameAIChat(id, userID int64, title string) error {
	_, err := DB.Exec(`UPDATE ai_chats SET title=?, updated_at=? WHERE id=? AND user_id=?`,
		title, time.Now().Format("2006-01-02 15:04:05"), id, userID)
	return err
}

// DeleteAIChat 删除会话及其全部消息。
func DeleteAIChat(id, userID int64) error {
	if _, err := DB.Exec(`DELETE FROM ai_chat_messages WHERE chat_id=?`, id); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM ai_chats WHERE id=? AND user_id=?`, id, userID)
	return err
}

// ListAIChatMessages 按时间正序列出会话消息。
func ListAIChatMessages(chatID int64) ([]AIChatMessage, error) {
	rows, err := DB.Query(`SELECT id, chat_id, role, content, tool_name, created_at
		FROM ai_chat_messages WHERE chat_id=? ORDER BY id ASC`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIChatMessage{}
	for rows.Next() {
		var m AIChatMessage
		if err := rows.Scan(&m.ID, &m.ChatID, &m.Role, &m.Content, &m.ToolName, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AppendAIChatMessage 追加一条消息并刷新会话的 updated_at；超出上限时丢最旧的几条。
func AppendAIChatMessage(chatID int64, role, content, toolName string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	if _, err := DB.Exec(`INSERT INTO ai_chat_messages (chat_id, role, content, tool_name, created_at)
		VALUES (?,?,?,?,?)`, chatID, role, content, toolName, now); err != nil {
		return err
	}
	// 配额裁剪：保留最近 aiChatMaxMessages 条
	if _, err := DB.Exec(`DELETE FROM ai_chat_messages WHERE chat_id=? AND id NOT IN (
		SELECT id FROM ai_chat_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?
	)`, chatID, chatID, aiChatMaxMessages); err != nil {
		return err
	}
	_, err := DB.Exec(`UPDATE ai_chats SET updated_at=? WHERE id=?`, now, chatID)
	return err
}

// DeleteAIChatsByUser 清理某用户的全部会话（ClearUserData 用）。
func DeleteAIChatsByUser(userID int64) error {
	if _, err := DB.Exec(`DELETE FROM ai_chat_messages WHERE chat_id IN (SELECT id FROM ai_chats WHERE user_id=?)`, userID); err != nil {
		return err
	}
	_, err := DB.Exec(`DELETE FROM ai_chats WHERE user_id=?`, userID)
	return err
}
