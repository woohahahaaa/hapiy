package handler

import (
	"net/http"

	"github.com/hapiy/hapiy/internal/middleware"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
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

// CreateDefaultAdmin creates default admin user if not exists
func CreateDefaultAdmin(db *gorm.DB) error {
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count > 0 {
		return nil
	}

	password, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	admin := model.User{
		Username: "admin",
		Password: string(password),
		Role:     "admin",
		Status:   true,
	}
	return db.Create(&admin).Error
}