package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ChannelAffinityPayload is the combined payload returned by
// GetChannelAffinity and accepted by SaveChannelAffinity. The regular
// rules and the fallback feature are persisted independently, but the
// UI works with them as a single screen so we expose both here.
type ChannelAffinityPayload struct {
	Setting *affinity.AffinitySetting   `json:"setting"`
	Fallback *affinity.FallbackSetting  `json:"fallback"`
}

// GetChannelAffinity returns the affinity setting and the fallback config.
func GetChannelAffinity(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		setting, err := affinity.NewStore(db).Load()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		fallback, err := affinity.NewFallbackStore(db).Load()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": ChannelAffinityPayload{Setting: setting, Fallback: fallback}})
	}
}

// SaveChannelAffinity persists both the affinity setting and the fallback
// config, then hot-reloads the engine.
func SaveChannelAffinity(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload ChannelAffinityPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if payload.Setting != nil {
			if err := affinity.NewStore(db).Save(payload.Setting); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if payload.Fallback != nil {
			if err := affinity.NewFallbackStore(db).Save(payload.Fallback); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		engine.ReloadAffinity()
		engine.ReloadFallbackAffinity()
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}
