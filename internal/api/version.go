package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// BuildInfo 由构建时通过 -ldflags -X 注入，格式 "commit|commitTime"（commitTime 为 ISO8601）。
// 未注入时为 "dev"。
var BuildInfo = "dev"

func versionGet(c *gin.Context) {
	commit, commitTime := "dev", ""
	if BuildInfo != "" && BuildInfo != "dev" {
		parts := strings.SplitN(BuildInfo, "|", 2)
		commit = parts[0]
		if len(parts) == 2 {
			commitTime = parts[1]
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"commit":      commit,
		"commit_time": commitTime,
	})
}
