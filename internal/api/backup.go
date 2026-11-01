package api

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// ===== 自动备份（方案 1）=====
// 服务端单机 SQLite + 单块盘，磁盘坏掉就是全量丢失，而界面上只有一个需要手动点的「导出数据」。
// 这里做最低成本的兜底：每日 03:10 用 VACUUM INTO 生成一份一致快照，
// 保留最近 30 份 + 每月 1 号那份额外保留；启动时检查当天那份是否存在，缺了就补跑。
// 备份目录默认放在数据库同级的 backups/（可用 BACKUP_DIR 改到另一块盘 / NAS ——
// 同一块物理盘上的备份不算备份，这一点只能靠部署时指定）。

const backupKeepDaily = 30

var backupLoc = time.FixedZone("CST", 8*3600)

// BackupDir 备份目录：BACKUP_DIR 优先，否则 <数据目录>/backups。
func BackupDir() string {
	if v := strings.TrimSpace(os.Getenv("BACKUP_DIR")); v != "" {
		return v
	}
	if p := db.FilePath(); p != "" {
		return filepath.Join(filepath.Dir(p), "backups")
	}
	return "backups"
}

// RunBackup 立即备份一次（按北京时间归日）：写入 → 自检 → 清理旧份。
// 自检不通过时删掉坏文件并返回错误，避免「当天已有备份」的假象。
func RunBackup(now time.Time) (string, error) {
	dir := BackupDir()
	dst := db.BackupFilePath(dir, now.In(backupLoc))
	if err := db.VacuumInto(dst); err != nil {
		return "", err
	}
	if err := db.VerifyBackup(dst); err != nil {
		_ = os.Remove(dst)
		return "", err
	}
	if n, err := db.PruneBackups(dir, backupKeepDaily); err != nil {
		log.Printf("[backup] 清理旧备份失败：%v", err)
	} else if n > 0 {
		log.Printf("[backup] 已清理 %d 份旧备份（保留最近 %d 份 + 每月 1 号那份）", n, backupKeepDaily)
	}
	return dst, nil
}

// EnsureBackup 启动补跑：当天那份不存在就立刻做一次（服务重启 / 昨晚停机都不会漏）。
// 异步执行，不阻塞启动；失败只记日志，不影响服务可用性。
func EnsureBackup() {
	go func() {
		day := time.Now().In(backupLoc)
		dst := db.BackupFilePath(BackupDir(), day)
		if _, err := os.Stat(dst); err == nil {
			return // 今天已有
		}
		if p, err := RunBackup(time.Now()); err != nil {
			log.Printf("[backup] 启动补跑失败：%v", err)
		} else {
			log.Printf("[backup] 启动补跑完成：%s", p)
		}
	}()
}

// ScheduleBackup 每日 03:10（北京时间）备份一次。凌晨时段没有行情刷新与快照任务，
// 与 07:00 / 15:15 / 21:00 的三次快照、21:10 的净值扫描都不冲突。
func ScheduleBackup() {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), 3, 10, 0, 0, backupLoc)
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		time.Sleep(time.Until(next))
		if p, err := RunBackup(time.Now()); err != nil {
			log.Printf("[backup] 定时备份失败：%v", err)
		} else {
			log.Printf("[backup] 定时备份完成：%s", p)
		}
	}
}

// backupStatusGet 备份状态（设置页一行小字用）：目录 / 份数 / 最近一次时间。
// 读目录即可，不查库、不引入额外表，失败也不影响设置页其他功能。
func backupStatusGet(c *gin.Context) {
	dir := BackupDir()
	ents, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	type fileInfo struct {
		name string
		mod  time.Time
	}
	var files []fileInfo
	for _, e := range ents {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "portfolio-") || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fileInfo{name: e.Name(), mod: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	resp := gin.H{
		"dir":   dir,
		"count": len(files),
		"keep":  backupKeepDaily,
	}
	if len(files) > 0 {
		resp["latest"] = files[0].name
		resp["last_at"] = files[0].mod.In(backupLoc).Format("2006-01-02 15:04")
	}
	c.JSON(200, resp)
}
