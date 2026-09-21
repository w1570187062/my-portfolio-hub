package api

import (
	"net/http"

	"portfolio/internal/mcp"

	"github.com/gin-gonic/gin"
)

// mcpConfigGet 返回当前持久化的 MCP 配置（不含环境变量覆盖），供前端「AI 设置 → MCP 参数」页展示与编辑。
func mcpConfigGet(c *gin.Context) {
	cfg, exists := mcp.ReadConfigFile()
	c.JSON(http.StatusOK, gin.H{
		"config": cfg,
		"exists": exists,
		"path":   mcp.ConfigPath(),
	})
}

// mcpConfigPut 将前端保存的 MCP 配置写回配置文件。
func mcpConfigPut(c *gin.Context) {
	var cfg mcp.Config
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cfg.Transport == "" {
		cfg.Transport = "http"
	}
	if cfg.ServerName == "" {
		cfg.ServerName = "portfolio-mcp"
	}
	if cfg.ServerVersion == "" {
		cfg.ServerVersion = "1.0.0"
	}
	if err := mcp.SaveConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "path": mcp.ConfigPath()})
}

// mcpConfigStatus 返回受管 MCP HTTP 传输的运行状态，供前端「MCP 参数」页状态圆点展示。
func mcpConfigStatus(c *gin.Context) {
	cfg := mcp.LoadConfig()
	running, errMsg := mcp.HTTPStatus()
	c.JSON(http.StatusOK, gin.H{
		"enabled":   cfg.Enabled,
		"transport": cfg.Transport,
		"running":   running,
		"error":     errMsg,
	})
}

// mcpConfigRestart 按最新配置文件平滑重启受管 MCP HTTP 传输，无需重启整个 Web 服务。
func mcpConfigRestart(c *gin.Context) {
	cfg := mcp.LoadConfig()
	mcp.RestartHTTP(cfg)
	running, errMsg := mcp.HTTPStatus()
	c.JSON(http.StatusOK, gin.H{
		"ok":        true,
		"enabled":   cfg.Enabled,
		"transport": cfg.Transport,
		"running":   running,
		"error":     errMsg,
	})
}
