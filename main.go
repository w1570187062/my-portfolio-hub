package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

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

	r := gin.Default()
	api.RegisterRoutes(r)
	r.NoRoute(gin.WrapH(fileServer))

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
