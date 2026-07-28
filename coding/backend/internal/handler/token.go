package handler

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

func ListTokens(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokens []model.Token
		if err := db.Find(&tokens).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": tokens})
	}
}

func GetToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var token model.Token
		if err := db.First(&token, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": token})
	}
}

func CreateToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var token model.Token
		if err := c.ShouldBindJSON(&token); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Generate key if not provided
		if token.Key == "" {
			token.Key = generateTokenKey()
		}

		if err := db.Create(&token).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"data": token})
	}
}

func UpdateToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var token model.Token
		if err := db.First(&token, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
			return
		}

		if err := c.ShouldBindJSON(&token); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Save(&token).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": token})
	}
}

func DeleteToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := db.Delete(&model.Token{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "token deleted"})
	}
}

func ToggleToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var token model.Token
		if err := db.First(&token, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
			return
		}

		token.Status = !token.Status
		if err := db.Save(&token).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": token})
	}
}

func RotateTokenKey(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var token model.Token
		if err := db.First(&token, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
			return
		}

		// Move current key to history
		var history []string
		if token.HistoryKeys != "" {
			json.Unmarshal([]byte(token.HistoryKeys), &history)
		}
		history = append([]string{token.Key}, history...)
		if len(history) > 5 {
			history = history[:5]
		}
		historyJSON, _ := json.Marshal(history)
		token.HistoryKeys = string(historyJSON)

		// Generate new key
		token.Key = generateTokenKey()

		if err := db.Save(&token).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": token})
	}
}

func generateTokenKey() string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, 32)
	for i := range result {
		result[i] = chars[rand.Intn(len(chars))]
	}
	return "hk-" + string(result)
}
