package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Provider handlers

func ListProviders(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var providers []model.Provider
		if err := db.Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": providers})
	}
}

func GetProvider(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var provider model.Provider
		if err := db.First(&provider, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}

func CreateProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var provider model.Provider
		if err := c.ShouldBindJSON(&provider); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Create(&provider).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		engine.LoadProviders()

		c.JSON(http.StatusCreated, gin.H{"data": provider})
	}
}

func UpdateProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var provider model.Provider
		if err := db.First(&provider, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			return
		}

		if err := c.ShouldBindJSON(&provider); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Save(&provider).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		engine.InvalidatePlan(provider.ID)

		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}

func DeleteProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := db.Delete(&model.Provider{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		engine.LoadProviders()

		c.JSON(http.StatusOK, gin.H{"message": "provider deleted"})
	}
}

func ToggleProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var provider model.Provider
		if err := db.First(&provider, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			return
		}

		provider.Status = !provider.Status
		if err := db.Save(&provider).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		engine.LoadProviders()

		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}
