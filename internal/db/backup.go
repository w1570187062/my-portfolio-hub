package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// dbFile 记录 Init 时打开的 SQLite 文件路径，供冷备（VACUUM INTO）定位数据目录。
var dbFile string

// FilePath 返回当前 SQLite 文件路径（未初始化时为空串）。
func FilePath() string { return dbFile }

// VacuumInto 用 SQLite 官方的 VACUUM INTO 生成一份一致的热备快照。
// 相比直接 cp 文件：VACUUM INTO 在同一个读事务里完成读取，不会抄到「写入中」的脏页，
// 也不会把 -wal / -shm 的中间状态漏掉。目标文件已存在时会报错，调用方需先删除。
func VacuumInto(dst string) error {
	if DB == nil {
		return fmt.Errorf("db 未初始化")
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("mkdir backup dir: %w", err)
	}
	// 同名文件残留（同一天重复跑）先删掉，否则 VACUUM INTO 会因目标已存在而失败。
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove old backup: %w", err)
	}
	// 路径用字面量拼进 SQL（单引号转义）而不是绑定参数：VACUUM 的 INTO 子句
	// 在部分驱动上对占位符支持不一致，字面量最稳。路径来自服务端配置，不是用户输入。
	lit := "'" + strings.ReplaceAll(dst, "'", "''") + "'"
	if _, err := DB.Exec(`VACUUM INTO ` + lit); err != nil {
		return fmt.Errorf("vacuum into: %w", err)
	}
	return nil
}

// VerifyBackup 自检备份文件：能打开、能读出 sqlite_master（防止写出半截 / 0 字节文件）。
// PRAGMA quick_check 会做页级校验但不做全表索引比对，对「文件是否完整可读」足够且够快。
func VerifyBackup(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat backup: %w", err)
	}
	if st.Size() <= 0 {
		return fmt.Errorf("备份文件为空（%s）", path)
	}
	h, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("open backup: %w", err)
	}
	defer h.Close()
	var check string
	if err := h.QueryRow(`PRAGMA quick_check`).Scan(&check); err != nil {
		return fmt.Errorf("quick_check: %w", err)
	}
	if check != "ok" {
		return fmt.Errorf("quick_check 未通过：%s", check)
	}
	var n int
	if err := h.QueryRow(`SELECT COUNT(1) FROM sqlite_master`).Scan(&n); err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("备份文件无任何表结构（%s）", path)
	}
	return nil
}

// BackupFilePath 按日期拼接备份文件名：portfolio-YYYY-MM-DD.db
func BackupFilePath(dir string, day time.Time) string {
	return filepath.Join(dir, "portfolio-"+day.Format("2006-01-02")+".db")
}

// PruneBackups 按保留策略清理备份目录：最近 keepDaily 份全留 + 每月 1 号那份额外永久保留。
// 返回删除的文件数。命名不合规的文件一律跳过（不认识的别动）。
func PruneBackups(dir string, keepDaily int) (int, error) {
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	type item struct {
		name string
		day  time.Time
	}
	var list []item
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if len(name) != len("portfolio-2006-01-02.db") || name[:10] != "portfolio-" || filepath.Ext(name) != ".db" {
			continue
		}
		day, err := time.Parse("2006-01-02", name[10:20])
		if err != nil {
			continue
		}
		list = append(list, item{name: name, day: day})
	}
	// 新的在前：最近 keepDaily 份直接留
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j].day.After(list[i].day) {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	if keepDaily < 1 {
		keepDaily = 1
	}
	deleted := 0
	for i, it := range list {
		if i < keepDaily {
			continue // 最近 N 份
		}
		if it.day.Day() == 1 {
			continue // 每月 1 号那份额外保留（月度锚点）
		}
		if err := os.Remove(filepath.Join(dir, it.name)); err != nil {
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}
