package mcp

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultConfig 返回一份默认（关闭）的配置。
func DefaultConfig() Config {
	return Config{
		Enabled:       false,
		Transport:     "http",
		HTTPAddr:      ":9988",
		Token:         "",
		UserID:        0,
		ServerName:    "portfolio-mcp",
		ServerVersion: "1.0.0",
	}
}

// LoadConfig 从配置文件（ConfigPath()，即 <data-dir>/mcp.json）读取配置，
// 并以环境变量覆盖（MCP_ENABLED / MCP_TRANSPORT / MCP_HTTP_ADDR / MCP_TOKEN / MCP_USER_ID）。
// 文件不存在时返回默认关闭配置，不视为错误（主程序据此不自动拉起 MCP）。
func LoadConfig() Config {
	cfg := DefaultConfig()
	path := ConfigPath()
	if data, err := os.ReadFile(path); err == nil {
		if e := json.Unmarshal(data, &cfg); e != nil {
			log.Printf("[mcp] 解析 %s 失败: %v，使用默认配置", path, e)
		} else {
			log.Printf("[mcp] 已加载配置 %s", path)
		}
	}
	applyEnv(&cfg)
	if cfg.Transport == "" {
		cfg.Transport = "http"
	}
	return cfg
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("MCP_ENABLED"); v != "" {
		cfg.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	if v := os.Getenv("MCP_TRANSPORT"); v != "" {
		cfg.Transport = v
	}
	if v := os.Getenv("MCP_HTTP_ADDR"); v != "" {
		cfg.HTTPAddr = v
	}
	if v := os.Getenv("MCP_TOKEN"); v != "" {
		cfg.Token = v
	}
	if v := os.Getenv("MCP_USER_ID"); v != "" {
		if n, e := strconv.ParseInt(v, 10, 64); e == nil {
			cfg.UserID = n
		}
	}
}

// configBaseDir 返回配置文件所在目录：优先取 DATA_DIR 的父目录（DATA_DIR 指向
// sqlite 文件，如 /data/portfolio.db → /data），缺省本地开发目录 data/。
// 这样 mcp.json 与数据库落在同一持久化卷上，容器重建后配置不丢失。
func configBaseDir() string {
	d := os.Getenv("DATA_DIR")
	if d == "" {
		d = "data/portfolio.db"
	}
	if filepath.Ext(d) != "" {
		d = filepath.Dir(d)
	}
	return d
}

// ConfigPath 返回当前生效的配置文件路径（MCP_CONFIG 环境变量或默认 <data-dir>/mcp.json）。
func ConfigPath() string {
	if p := os.Getenv("MCP_CONFIG"); p != "" {
		return p
	}
	return filepath.Join(configBaseDir(), "mcp.json")
}

// ReadConfigFile 仅读取配置文件内容（不合并环境变量），供前端展示/编辑持久化配置。
// 返回 (config, exists)；文件不存在时返回默认关闭配置且 exists=false。
func ReadConfigFile() (Config, bool) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(ConfigPath())
	if err != nil {
		return cfg, false
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, false
	}
	return cfg, true
}

// SaveConfig 将配置写回配置文件（格式化 JSON）。目标目录不存在时自动创建。
func SaveConfig(cfg Config) error {
	path := ConfigPath()
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// Run 以配置指定的传输方式阻塞运行（stdio 或 http）。由 `portfolio mcp` 子命令调用。
func Run(cfg Config) error {
	cfgUserID = cfg.UserID
	srv := NewServer(cfg.ServerName, cfg.ServerVersion)
	if strings.EqualFold(cfg.Transport, "stdio") {
		return srv.RunStdio()
	}
	return srv.RunHTTP(cfg)
}

// ExampleConfigJSON 供生成示例配置文件使用（写入仓库根 mcp.example.json）。
func ExampleConfigJSON() string {
	cfg := DefaultConfig()
	cfg.Enabled = true
	cfg.Transport = "http"
	cfg.HTTPAddr = ":9988"
	cfg.Token = "请替换为你的令牌"
	cfg.UserID = 0
	cfg.ServerName = "portfolio-mcp"
	cfg.ServerVersion = "1.0.0"
	b, _ := json.MarshalIndent(cfg, "", "  ")
	return string(b)
}
