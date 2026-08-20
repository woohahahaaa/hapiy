package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RefreshExchangeRate fetches a fresh USD→CNY rate from the configured API,
// persists it and returns the new value.
func RefreshExchangeRate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rate, err := service.RefreshExchangeRate(db)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"rate": rate}})
	}
}
