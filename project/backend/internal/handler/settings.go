package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Setting handlers

func ListSettings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := make([]model.Setting, 0)
		if err := db.Order("key asc").Find(&settings).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": settings})
	}
}

func UpsertSetting(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var setting model.Setting
		if err := c.ShouldBindJSON(&setting); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if setting.Key == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "key 不能为空"})
			return
		}

		if err := db.Where("key = ?", setting.Key).
			Assign(model.Setting{Value: setting.Value}).
			FirstOrCreate(&setting).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": setting})
	}
}
