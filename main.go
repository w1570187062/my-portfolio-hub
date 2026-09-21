package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"portfolio/internal/api"
	"portfolio/internal/db"
	"portfolio/internal/market"
	"portfolio/internal/mcp"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

//go:embed web/dist
var webFS embed.FS

func main() {
	// MCP 子命令：以 stdio / http 传输独立运行 MCP 服务端，供 hermes 等客户端连接。
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		os.Exit(runMCP(os.Args[2:]))
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data/portfolio.db"
	}
	if err := db.Init(dataDir); err != nil {
		log.Fatalf("init db: %v", err)
	}
	// 多用户体系：建 users 表、补充 user_id 列、重建按用户隔离的表、确保默认用户。
	if err := db.EnsureUsers(); err != nil {
		log.Fatalf("ensure users: %v", err)
	}

	// FX rates: warm cache from DB and refresh in background (handlers no longer block on upstream).
	market.StartFXUpdater()

	// Daily P&L snapshot: backfill today on startup, then record every day at 15:15.
	api.EnsureSnapshot()
	// 补齐历史 pnl_daily 的 base_cny（盈亏率视图依赖），再启动定时快照。
	api.BackfillPnlBaseCNY()
	go api.ScheduleDailySnapshot()
	go api.ScheduleDailyAISummary()

	// 每日 00:00 归零结算：先兜底落库上一交易日盈亏，再把当日盈亏归零（不带入下一交易日）。
	api.EnsureMidnightReset()
	go api.ScheduleMidnightReset()

	// 待还款提前一天提醒：每天在配置时间（默认 07:00）检查次日到期的待还款并推送。
	go api.ScheduleCashflowReminder()

	sub, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatalf("embed fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	// 强制浏览器/代理不缓存静态资源；并对 index.html 注入带版本的 app.js/style.css URL，
	// 这样每次部署（VERSION 变化）都会让浏览器拉取全新的前端，彻底规避"改了前端却不生效"的缓存问题。
	noCache := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			if data, err := fs.ReadFile(webFS, "web/dist/index.html"); err == nil {
				// 用含时间戳的完整 VERSION 作为缓存戳：每次部署（时间戳变化）都会
				// 让浏览器重新拉取 app.js / style.css，彻底规避“改了前端却不生效”。
				v := api.BuildInfo
				if v == "" || v == "dev" {
					v = "dev"
				} else {
					v = strings.NewReplacer("|", "-", ":", "-", "+", "-").Replace(v)
				}
				html := string(data)
				html = strings.Replace(html, `src="/app.js"`, `src="/app.js?v=`+v+`"`, 1)
				html = strings.Replace(html, `href="/style.css"`, `href="/style.css?v=`+v+`"`, 1)
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Pragma", "no-cache")
				// 首页经 NoRoute 兜底：gin 会先把响应状态置为 404（serveError），
				// 这里必须显式覆盖为 200，否则首页一直以 404 状态返回（浏览器无感但 curl/监控报警）。
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(html))
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Pragma", "no-cache")
		fileServer.ServeHTTP(w, r)
	})

	r := gin.Default()
	// 启用 HTTP 响应 gzip 压缩（JS/CSS/HTML/JSON 均受益；客户端未带 Accept-Encoding: gzip 时自动透传）。
	r.Use(gzip.Gzip(gzip.DefaultCompression))
	api.RegisterRoutes(r)

	// MCP：若配置启用且为 HTTP 传输，随 Web 服务一起在后台拉起，供远程 hermes 连接。
	if mcpCfg := mcp.LoadConfig(); mcpCfg.Enabled && strings.EqualFold(mcpCfg.Transport, "http") {
		mcp.StartHTTP(mcpCfg)
	}

	r.NoRoute(gin.WrapH(noCache))

	addr := os.Getenv("PORT")
	if addr == "" {
		addr = "9989"
	}
	addr = ":" + addr
	log.Printf("portfolio listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// runMCP 以 MCP 子命令运行独立服务端：先初始化数据库，再按配置/参数启动传输。
func runMCP(args []string) int {
	fs := flag.NewFlagSet("mcp", flag.ContinueOnError)
	configPath := fs.String("config", "", "MCP 配置文件路径（缺省读 MCP_CONFIG 或 mcp.json）")
	transport := fs.String("transport", "", "传输方式：stdio | http")
	addr := fs.String("addr", "", "HTTP 监听地址，如 :9988")
	token := fs.String("token", "", "HTTP Bearer 鉴权令牌")
	userID := fs.Int64("user", 0, "MCP 操作归属用户 id（0=默认首个用户）")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data/portfolio.db"
	}
	if err := db.Init(dataDir); err != nil {
		log.Fatalf("init db: %v", err)
	}
	if err := db.EnsureUsers(); err != nil {
		log.Fatalf("ensure users: %v", err)
	}
	if *configPath != "" {
		os.Setenv("MCP_CONFIG", *configPath)
	}
	cfg := mcp.LoadConfig()
	if *transport != "" {
		cfg.Transport = *transport
	}
	if *addr != "" {
		cfg.HTTPAddr = *addr
	}
	if *token != "" {
		cfg.Token = *token
	}
	if *userID != 0 {
		cfg.UserID = *userID
	}
	if err := mcp.Run(cfg); err != nil {
		log.Fatalf("mcp server: %v", err)
	}
	return 0
}
