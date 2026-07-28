package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Channel handlers

func ListChannels(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var channels []model.Channel
		if err := db.Find(&channels).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": channels})
	}
}

func GetChannel(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var channel model.Channel
		if err := db.First(&channel, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": channel})
	}
}

func CreateChannel(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var channel model.Channel
		if err := c.ShouldBindJSON(&channel); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Create(&channel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Reload channels in engine
		engine.LoadChannels()

		c.JSON(http.StatusCreated, gin.H{"data": channel})
	}
}

func UpdateChannel(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var channel model.Channel
		if err := db.First(&channel, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
			return
		}

		if err := c.ShouldBindJSON(&channel); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Save(&channel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Invalidate plan cache
		engine.InvalidatePlan(channel.ID)

		c.JSON(http.StatusOK, gin.H{"data": channel})
	}
}

func DeleteChannel(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := db.Delete(&model.Channel{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Reload channels in engine
		engine.LoadChannels()

		c.JSON(http.StatusOK, gin.H{"message": "channel deleted"})
	}
}

func ToggleChannel(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var channel model.Channel
		if err := db.First(&channel, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
			return
		}

		channel.Status = !channel.Status
		if err := db.Save(&channel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Reload channels in engine
		engine.LoadChannels()

		c.JSON(http.StatusOK, gin.H{"data": channel})
	}
}
