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

// TestExchangeRate fetches a rate from a caller-supplied URL + field path
// without persisting anything. Used by the settings dialog to validate a
// candidate endpoint before saving.
func TestExchangeRate() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			URL   string `json:"url"`
			Field string `json:"field"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.URL == "" {
			respondError(c, http.StatusBadRequest, "EXCHANGE_URL_REQUIRED", "接口地址不能为空")
			return
		}
		rate, err := service.FetchRateFromAPI(req.URL, req.Field)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"rate": rate}})
	}
}
