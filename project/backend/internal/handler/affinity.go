package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetChannelAffinity returns the stored affinity setting.
func GetChannelAffinity(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		setting, err := affinity.NewStore(db).Load()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": setting})
	}
}

// SaveChannelAffinity persists the affinity setting and hot-reloads the engine.
func SaveChannelAffinity(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var setting affinity.AffinitySetting
		if err := c.ShouldBindJSON(&setting); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := affinity.NewStore(db).Save(&setting); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		engine.ReloadAffinity()
		c.JSON(http.StatusOK, gin.H{"data": setting})
	}
}
