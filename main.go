package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"

	"portfolio/internal/api"
	"portfolio/internal/db"
	"portfolio/internal/market"

	"github.com/gin-gonic/gin"
)

//go:embed web
var webFS embed.FS

func main() {
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
	go api.ScheduleDailySnapshot()
	go api.ScheduleDailyAISummary()

	// 每日 00:00 归零结算：先兜底落库上一交易日盈亏，再把当日盈亏归零（不带入下一交易日）。
	api.EnsureMidnightReset()
	go api.ScheduleMidnightReset()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	// 强制浏览器/代理不缓存静态资源；并对 index.html 注入带版本的 app.js/style.css URL，
	// 这样每次部署（VERSION 变化）都会让浏览器拉取全新的前端，彻底规避"改了前端却不生效"的缓存问题。
	noCache := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			if data, err := fs.ReadFile(webFS, "web/index.html"); err == nil {
				v := api.BuildInfo
				if i := strings.IndexByte(v, '|'); i >= 0 {
					v = v[:i]
				}
				if v == "" {
					v = "dev"
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
	api.RegisterRoutes(r)
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
