package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CORS middleware
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

// RequestID middleware
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set("request_id", requestID)
		c.Writer.Header().Set("X-Request-ID", requestID)
		c.Next()
	}
}

// AuthRequired middleware (dashboard authentication)
func AuthRequired(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// TODO: Implement JWT authentication
		// For now, skip authentication in development
		c.Set("user_id", "admin")
		c.Next()
	}
}

// TokenAuth middleware (API token authentication)
func TokenAuth(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			c.Abort()
			return
		}

		// Parse Bearer token
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization format"})
			c.Abort()
			return
		}

		tokenKey := parts[1]

		// Validate token
		var token model.Token
		if err := db.Where("key = ? AND status = ?", tokenKey, true).First(&token).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			}
			c.Abort()
			return
		}

		// Check quota
		if token.Quota != nil && token.UsedQuota >= *token.Quota {
			c.JSON(http.StatusForbidden, gin.H{"error": "quota exceeded"})
			c.Abort()
			return
		}

		// Set context
		c.Set("token_id", token.ID)
		c.Set("token_name", token.Name)
		c.Set("user_id", token.UserID)

		c.Next()
	}
}
