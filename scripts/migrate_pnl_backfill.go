// +build ignore

// migrate_pnl_backfill.go — 一次性脚本：给存量 adjust_sell 流水回填 realized_pnl。
//
// 背景：realized_pnl 字段 2026-11-27 新增，新写入的 adjust_sell 流水自动带真实盈亏，
//       但部署前落库的历史流水 realized_pnl=0，前端着色无法区分盈亏。
// 做法：用 position_tx 表的 SELL 记录（holding_id + 金额精确匹配 + 时间最近）反查
//       当时那笔减仓的真实 realized_pnl，UPDATE 回填到 cash_flow。
// 幂等：WHERE 限定只处理 realized_pnl≈0 的行，重复执行不会覆盖已回填的。
// 仅匹配：adjust_sell（减仓回款）。wealth_redeem / wealth_clear 等后端还没算 realized，
//       将来算好后再扩展。
//
// 用法：
//   go run scripts/migrate_pnl_backfill.go                      # 默认 data/portfolio.db
//   DATA_DIR=/path/to/portfolio.db go run scripts/migrate_pnl_backfill.go

package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data/portfolio.db"
	}
	db, err := sql.Open("sqlite3", dataDir+"?_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		log.Fatalf("打开 db 失败: %v", err)
	}
	defer db.Close()

	// 先确认 realized_pnl 列已存在
	var colCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('cash_flow') WHERE name='realized_pnl'`).Scan(&colCount); err != nil {
		log.Fatalf("查 realized_pnl 列失败: %v", err)
	}
	if colCount == 0 {
		log.Fatal("cash_flow.realized_pnl 列不存在！请先启动一次主程序让 addColumnIfMissing 补列，再跑本脚本")
	}

	// 存量数量（将被处理的）
	var pending int
	if err := db.QueryRow(`SELECT COUNT(*) FROM cash_flow WHERE type='adjust_sell' AND ABS(COALESCE(realized_pnl,0)) < 0.005 AND ref_id > 0`).Scan(&pending); err != nil {
		log.Fatalf("查存量 adjust_sell 失败: %v", err)
	}
	fmt.Printf("将要回填 %d 条 adjust_sell 流水的 realized_pnl\n", pending)

	// 执行回填
	res, err := db.Exec(`UPDATE cash_flow SET realized_pnl = COALESCE((
		SELECT ROUND(tx.realized_pnl*100)/100 FROM position_tx tx
		WHERE tx.holding_id = cash_flow.ref_id
			AND tx.tx_type = 'SELL'
			AND COALESCE(tx.reverted,0) = 0
			AND ABS(ROUND((tx.amount - tx.fee - cash_flow.amount)*100)/100) < 0.02
		ORDER BY ABS(julianday(tx.created_at) - julianday(cash_flow.date)) ASC
		LIMIT 1
	), 0) WHERE cash_flow.type = 'adjust_sell' AND ABS(COALESCE(realized_pnl,0)) < 0.005 AND ref_id > 0`)
	if err != nil {
		log.Fatalf("UPDATE 失败: %v", err)
	}
	affected, _ := res.RowsAffected()
	fmt.Printf("UPDATE 命中 %d 行（已回填 realized_pnl 的数量可能小于此值——匹配不上的被置为 0）\n", affected)

	// 匹配结果统计
	var matched, stillZero int
	if err := db.QueryRow(`SELECT
		COUNT(*) FILTER (WHERE ABS(realized_pnl) > 0.005) as matched,
		COUNT(*) FILTER (WHERE ABS(realized_pnl) < 0.005) as still_zero
		FROM cash_flow WHERE type='adjust_sell' AND ref_id > 0`).Scan(&matched, &stillZero); err != nil {
		log.Fatalf("统计失败: %v", err)
	}
	fmt.Printf("其中 realized_pnl 非零（匹配成功）: %d\n", matched)
	fmt.Printf("仍为 0（position_tx 匹配不上）: %d\n", stillZero)
	fmt.Println("完成。wealth_redeem/wealth_clear 等留待后端算好 realized_pnl 后再扩展。")
}
