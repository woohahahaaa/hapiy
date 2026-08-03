package handler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func GetCurrentUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		username, _ := c.Get("user_id")
		_ = userID
		var user model.User
		if err := db.Where("username = ?", username).First(&user).Error; err != nil {
			user = model.User{
				Username: fmtUsername(username),
				Role:     "admin",
				Status:   true,
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": user})
	}
}

func fmtUsername(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return "admin"
}

func Login(db *gorm.DB, sessions *middleware.SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required"`
			Password string `json:"password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var user model.User
		if err := db.First(&user, "username = ?", req.Username).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}

		token := sessions.Issue(user.Username)
		c.SetCookie("hapiy_admin_session", token, 3600*8, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{
			"message": "login successful",
			"user":    user,
		})
	}
}

func Logout(db *gorm.DB, sessions *middleware.SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cookie, err := c.Cookie("hapiy_admin_session"); err == nil {
			sessions.Revoke(cookie)
		}
		c.SetCookie("hapiy_admin_session", "", -1, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"message": "logout successful"})
	}
}

func UpdateUsername(db *gorm.DB, sessions *middleware.SessionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username string `json:"username"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		username, ok := c.Get("user_id")
		currentUsername, ok := username.(string)
		if !ok || currentUsername == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}

		newUsername := strings.TrimSpace(req.Username)
		if newUsername == "" || newUsername == currentUsername {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username must be different and non-empty"})
			return
		}

		var duplicateCount int64
		if err := db.Model(&model.User{}).Where("username = ?", newUsername).Count(&duplicateCount).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check username"})
			return
		}
		if duplicateCount > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "username already exists"})
			return
		}

		var user model.User
		if err := db.Where("username = ?", currentUsername).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
			return
		}

		user.Username = newUsername
		if err := db.Save(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update username"})
			return
		}

		if sessions == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "session store not initialised"})
			return
		}
		if cookie, err := c.Cookie("hapiy_admin_session"); err == nil && cookie != "" {
			sessions.Revoke(cookie)
		}
		token := sessions.Issue(user.Username)
		c.SetCookie("hapiy_admin_session", token, 3600*8, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"data": user})
	}
}

func UpdatePassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.TrimSpace(req.CurrentPassword) == "" || len(req.NewPassword) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "current password is required and new password must be at least 8 characters"})
			return
		}

		username, ok := c.Get("user_id")
		currentUsername, ok := username.(string)
		if !ok || currentUsername == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}

		var user model.User
		if err := db.Where("username = ?", currentUsername).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "current password is incorrect"})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to secure password"})
			return
		}
		user.Password = string(hash)
		if err := db.Save(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "password updated"})
	}
}

type DefaultAdminCredentials struct {
	Username string
	Password string
}

func CreateDefaultAdmin(db *gorm.DB) (DefaultAdminCredentials, error) {
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil {
		return DefaultAdminCredentials{}, err
	}
	if count > 0 {
		return DefaultAdminCredentials{}, nil
	}

	username := strings.TrimSpace(os.Getenv("HAPIY_ADMIN_USERNAME"))
	if username == "" {
		username = "admin"
	}

	password := os.Getenv("HAPIY_ADMIN_PASSWORD")
	generated := false
	if password == "" {
		password = randomPassword(16)
		generated = true
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return DefaultAdminCredentials{}, err
	}

	admin := model.User{
		Username: username,
		Password: string(hash),
		Role:     "admin",
		Status:   true,
	}
	if err := db.Create(&admin).Error; err != nil {
		return DefaultAdminCredentials{}, err
	}

	if generated {
		log.Printf("default admin created with random password (HAPIY_ADMIN_PASSWORD was unset); set HAPIY_ADMIN_PASSWORD to a known value and re-init if you want a fixed one")
	}
	return DefaultAdminCredentials{Username: username, Password: password}, nil
}

func randomPassword(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("x", n)
	}
	return hex.EncodeToString(b)[:n]
}
