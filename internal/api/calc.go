package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"portfolio/internal/db"

	"github.com/gin-gonic/gin"
)

// calcInputsGet returns the stored payload for a calculator kind.
// kind=equity (权益盈亏) | usd (美元资产盈亏). Missing row => empty "[]".
func calcInputsGet(c *gin.Context) {
	kind := c.Query("kind")
	if kind != "equity" && kind != "usd" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind 必须是 equity 或 usd"})
		return
	}
	payload, ok, err := db.GetCalcInput(kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusOK, gin.H{"kind": kind, "payload": "[]"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": kind, "payload": payload})
}

// calcInputsPut upserts the payload JSON for a calculator kind.
func calcInputsPut(c *gin.Context) {
	var b struct {
		Kind    string          `json:"kind"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	if b.Kind != "equity" && b.Kind != "usd" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind 必须是 equity 或 usd"})
		return
	}
	s := strings.TrimSpace(string(b.Payload))
	if s == "" || s == "null" {
		s = "[]"
	}
	// Validate it is well-formed JSON before persisting.
	if !json.Valid([]byte(s)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload 不是合法 JSON"})
		return
	}
	if err := db.SaveCalcInput(b.Kind, s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// calcInputsDelete clears the stored inputs for a calculator kind.
func calcInputsDelete(c *gin.Context) {
	kind := c.Query("kind")
	if kind != "equity" && kind != "usd" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind 必须是 equity 或 usd"})
		return
	}
	if err := db.DeleteCalcInput(kind); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
