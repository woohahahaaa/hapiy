package mcp

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// StatusHandler serves GET /v1/dashboard/mcp.
func StatusHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := ReadStatus(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": status})
	}
}

// UpdateHandler serves PUT /v1/dashboard/mcp with {"enabled": bool}.
func UpdateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		status, err := UpdateStatus(db, req.Enabled)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": status})
	}
}

// RotateKeyHandler serves POST /v1/dashboard/mcp/key.
func RotateKeyHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := RotateKey(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": status})
	}
}
