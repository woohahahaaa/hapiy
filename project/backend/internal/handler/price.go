package handler

import (
	"errors"
	"net/http"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ListPrices(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var prices []model.PriceConfig
		if err := db.Order("model asc").Find(&prices).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": prices})
	}
}

func CreatePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var price model.PriceConfig
		if err := c.ShouldBindJSON(&price); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if price.Model == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "model is required"})
			return
		}
		if err := db.Create(&price).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": price})
	}
}

func UpdatePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var price model.PriceConfig
		if err := db.First(&price, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "price not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var patch model.PriceConfig
		if err := c.ShouldBindJSON(&patch); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if patch.Model != "" {
			price.Model = patch.Model
		}
		price.InputPrice = patch.InputPrice
		price.OutputPrice = patch.OutputPrice
		price.CacheWritePrice = patch.CacheWritePrice
		price.CacheReadPrice = patch.CacheReadPrice
		if err := db.Save(&price).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": price})
	}
}

func DeletePrice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := db.Delete(&model.PriceConfig{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "price deleted"})
	}
}