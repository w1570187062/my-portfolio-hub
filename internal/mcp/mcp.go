// Package mcp 实现了一个自包含、零依赖的 MCP（Model Context Protocol）服务端，
// 让外部 AI 客户端（如 hermes）可以通过标准 MCP 协议连接本持仓项目，并基于实体的
// 「备注(mcp 标记)」来记录流水（加仓/减仓/分红、现金存取、理财申赎）。
//
// 设计参考 mayswind/ezbookkeeping 的 pkg/mcp：以 JSON-RPC 2.0 暴露 tools/list 与
// tools/call，工具内部复用以有的 db 层完成账本写入。本实现额外支持 stdio 与 HTTP(SSE)
// 两种传输，并通过 JSON 配置驱动（见 Config）。
package mcp

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Config 描述 MCP 服务端如何启动，通常由 mcp.json（或环境变量）提供。
type Config struct {
	Enabled       bool   `json:"enabled"`         // 是否启用（HTTP 模式下随主程序自动拉起）
	Transport     string `json:"transport"`       // stdio | http，默认 http
	HTTPAddr      string `json:"http_addr"`       // HTTP(SSE) 监听地址，默认 :9988
	Token         string `json:"token"`           // 可选：HTTP 模式下的 Bearer 鉴权令牌
	UserID        int64  `json:"user_id"`         // MCP 操作归属的用户；0 表示默认（首个）用户
	ServerName    string `json:"server_name"`     // 暴露给客户端的服务名
	ServerVersion string `json:"server_version"`  // 版本号
}

// cfgUserID 记录 MCP 操作归属的用户（由配置 user_id 决定，0=默认首个用户）。
var cfgUserID int64

// SetUserID 设置 MCP 操作归属用户，供主程序在拉起前注入。
func SetUserID(id int64) { cfgUserID = id }

// Tool 是一个 MCP 工具的静态描述 + 处理函数。
type Tool struct {
	Name        string                 // 工具名（英文、无空格）
	Description string                 // 工具说明（给 LLM 看）
	InputSchema map[string]interface{} // JSON Schema（draft-07 子集）
	// Handler 接收已解析的参数，返回给客户端的纯文本结果；err 会被包装为 isError 响应。
	Handler func(args map[string]interface{}) (string, error)
}

// Server 持有已注册的工具，并负责 JSON-RPC 分发。
type Server struct {
	name    string
	version string
	tools   []*Tool
}

// NewServer 构造一个 MCP 服务端并注册默认工具。
func NewServer(name, version string) *Server {
	if name == "" {
		name = "portfolio-mcp"
	}
	if version == "" {
		version = "1.0.0"
	}
	s := &Server{name: name, version: version}
	s.registerDefaultTools()
	return s
}

// ---- JSON-RPC 2.0 处理 ----

// Handle 解析一条 JSON-RPC 消息并返回响应（通知类返回 nil）。
func (s *Server) Handle(raw map[string]interface{}) map[string]interface{} {
	method, _ := raw["method"].(string)
	id := raw["id"] // 可能为 nil（通知）
	// 通知（无 id 或以 notifications/ 开头）无需回复。
	if id == nil || strings.HasPrefix(method, "notifications/") {
		return nil
	}
	resp := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
	}
	switch method {
	case "initialize":
		resp["result"] = map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
			"serverInfo":      map[string]interface{}{"name": s.name, "version": s.version},
		}
	case "ping":
		resp["result"] = map[string]interface{}{}
	case "tools/list":
		tools := make([]map[string]interface{}, 0, len(s.tools))
		for _, t := range s.tools {
			tools = append(tools, map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": t.InputSchema,
			})
		}
		resp["result"] = map[string]interface{}{"tools": tools}
	case "tools/call":
		params, _ := raw["params"].(map[string]interface{})
		name, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]interface{})
		if args == nil {
			args = map[string]interface{}{}
		}
		var text string
		var err error
		if tool := s.findTool(name); tool != nil {
			text, err = tool.Handler(args)
		} else {
			err = fmt.Errorf("未知工具: %s", name)
		}
		if err != nil {
			resp["result"] = map[string]interface{}{
				"content": []map[string]interface{}{
					{"type": "text", "text": "操作失败：" + err.Error()},
				},
				"isError": true,
			}
		} else {
			resp["result"] = map[string]interface{}{
				"content": []map[string]interface{}{
					{"type": "text", "text": text},
				},
				"isError": false,
			}
		}
	default:
		resp["error"] = map[string]interface{}{
			"code":    -32601,
			"message": "method not found: " + method,
		}
	}
	return resp
}

func (s *Server) findTool(name string) *Tool {
	for _, t := range s.tools {
		if t.Name == name {
			return t
		}
	}
	return nil
}

// ---- 传输层：stdio ----

// RunStdio 以 stdio（换行分隔的 JSON-RPC）方式阻塞运行，供本地 MCP 客户端（如 hermes）拉起子进程。
// 所有诊断日志走 stderr，只有 JSON 响应写到 stdout，避免污染协议流。
func (s *Server) RunStdio() error {
	log.SetOutput(os.Stderr)
	log.Printf("[mcp] stdio 传输已启动，服务端 %s %s", s.name, s.version)
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimSpace(line)
			if line != "" {
				var msg map[string]interface{}
				if jErr := json.Unmarshal([]byte(line), &msg); jErr == nil {
					if resp := s.Handle(msg); resp != nil {
						if b, mErr := json.Marshal(resp); mErr == nil {
							writer.Write(b)
							writer.WriteByte('\n')
							writer.Flush()
						}
					}
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// ---- 传输层：HTTP + SSE（经典 MCP SSE 传输）----

type sseSession struct {
	ch       chan string
	lastSeen time.Time
}

// buildMux 构造 HTTP(SSE) 传输的路由（供 RunHTTP 与受管 StartHTTP 共用）。
// 客户端先 GET /mcp 建立 SSE 流（首帧 endpoint 事件给出 POST 地址），再 POST 消息到该地址；
// POST /mcp/rpc 为便捷调试端点，直接返回 JSON 响应（非 SSE），便于 curl/脚本联调。
func (s *Server) buildMux(cfg Config) *http.ServeMux {
	cfgUserID = cfg.UserID
	sessions := map[string]*sseSession{}
	var mu sync.Mutex
	genID := func() string {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		return hex.EncodeToString(b)
	}
	auth := func(r *http.Request) bool {
		if cfg.Token == "" {
			return true
		}
		h := r.Header.Get("Authorization")
		return strings.EqualFold(h, "Bearer "+cfg.Token) || h == "Bearer "+cfg.Token
	}

	mux := http.NewServeMux()
	// SSE 流：GET /mcp
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !auth(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		sid := genID()
		ch := make(chan string, 32)
		mu.Lock()
		sessions[sid] = &sseSession{ch: ch, lastSeen: time.Now()}
		mu.Unlock()
		defer func() {
			mu.Lock()
			delete(sessions, sid)
			mu.Unlock()
		}()
		fmt.Fprintf(w, "event: endpoint\ndata: /mcp/messages?sessionId=%s\n\n", sid)
		flusher.Flush()
		for {
			select {
			case <-r.Context().Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				fmt.Fprintf(w, "event: message\ndata: %s\n\n", msg)
				flusher.Flush()
			}
		}
	})
	// 消息入口：POST /mcp/messages?sessionId=xxx
	mux.HandleFunc("/mcp/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !auth(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body failed", http.StatusBadRequest)
			return
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(body, &msg); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		resp := s.Handle(msg)
		if resp != nil {
			if b, mErr := json.Marshal(resp); mErr == nil {
				sid := r.URL.Query().Get("sessionId")
				mu.Lock()
				ses := sessions[sid]
				mu.Unlock()
				if ses != nil {
					select {
					case ses.ch <- string(b):
					default:
						log.Printf("[mcp] 会话 %s 消息队列已满，丢弃响应", sid)
					}
				}
			}
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("accepted"))
	})
	// 便捷调试端点：POST /mcp/rpc 直接返回 JSON 响应（非 SSE），便于 curl/脚本联调。
	mux.HandleFunc("/mcp/rpc", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !auth(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body failed", http.StatusBadRequest)
			return
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(body, &msg); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if resp := s.Handle(msg); resp != nil {
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	return mux
}

// httpAddr 返回规范化后的 HTTP 监听地址（缺省 :9988）。
func httpAddr(cfg Config) string {
	if cfg.HTTPAddr == "" {
		return ":9988"
	}
	return cfg.HTTPAddr
}

// RunHTTP 以 HTTP(SSE) 方式阻塞运行，监听 cfg.HTTPAddr。
// 客户端先 GET /mcp 建立 SSE 流（首帧 endpoint 事件给出 POST 地址），再 POST 消息到该地址。
func (s *Server) RunHTTP(cfg Config) error {
	addr := httpAddr(cfg)
	log.Printf("[mcp] HTTP(SSE) 监听 %s（SSE: GET /mcp，消息: POST /mcp/messages，调试: POST /mcp/rpc）", addr)
	return http.ListenAndServe(addr, s.buildMux(cfg))
}

// ---- 受管 HTTP 传输：随主 Web 进程拉起，支持平滑重启与状态查询 ----

var (
	mcpMu         sync.Mutex
	activeServer  *http.Server
	activeErr     string
	activeRunning bool
)

// StartHTTP 在后台 goroutine 启动 HTTP(SSE) 传输（非阻塞），供主 Web 进程随同拉起。
// 与 RunHTTP 不同，本函数托管 *http.Server，支持通过 RestartHTTP 平滑重启、通过 HTTPStatus 查询状态。
func StartHTTP(cfg Config) {
	cfgUserID = cfg.UserID
	srv := NewServer(cfg.ServerName, cfg.ServerVersion)
	s := &http.Server{Addr: httpAddr(cfg), Handler: srv.buildMux(cfg)}
	mcpMu.Lock()
	activeServer = s
	activeRunning = true
	activeErr = ""
	mcpMu.Unlock()
	go func() {
		err := s.ListenAndServe()
		mcpMu.Lock()
		if activeServer == s {
			activeRunning = false
		}
		if err != nil && err != http.ErrServerClosed {
			activeErr = err.Error()
		}
		mcpMu.Unlock()
	}()
}

// RestartHTTP 平滑重启 HTTP 传输：先优雅关闭旧实例，再按最新配置拉起新实例。
// 仅在 enabled 且 transport=http 时拉起；其余情况仅关闭旧实例（如 stdio 由客户端拉起，无需常驻）。
func RestartHTTP(cfg Config) {
	mcpMu.Lock()
	old := activeServer
	activeServer = nil
	activeRunning = false
	mcpMu.Unlock()
	if old != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		_ = old.Shutdown(ctx)
		cancel()
	}
	if cfg.Enabled && strings.EqualFold(cfg.Transport, "http") {
		StartHTTP(cfg)
	}
}

// HTTPStatus 返回受管 HTTP 传输的运行状态与最近一次错误（空串表示无错误）。
func HTTPStatus() (bool, string) {
	mcpMu.Lock()
	defer mcpMu.Unlock()
	return activeRunning, activeErr
}
