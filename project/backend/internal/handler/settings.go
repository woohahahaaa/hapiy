package handler

import (
	"fmt"
	"net/http"
	"strings"

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

// ListBaseUrlPaths returns the display-only BaseURL path names, ordered by
// their position in the settings page.
func ListBaseUrlPaths(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		paths := make([]model.BaseUrlPath, 0)
		if err := db.Order("sort_order asc").Find(&paths).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": paths})
	}
}

// ReplaceBaseUrlPaths replaces the whole display-only path list. Entries are
// validated (no "/", no "__", max 32 chars), deduplicated, and stored in
// submission order. This table never gates relay traffic.
func ReplaceBaseUrlPaths(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Paths []string `json:"paths"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		cleaned := make([]string, 0, len(req.Paths))
		seen := make(map[string]bool)
		for _, raw := range req.Paths {
			p := strings.TrimSpace(raw)
			if p == "" {
				continue
			}
			if strings.ContainsAny(p, "/") || strings.Contains(p, "__") || len(p) > 32 {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": fmt.Sprintf("路径名 %q 无效：不能包含 / 或 __，且长度不超过 32", p),
				})
				return
			}
			if seen[p] {
				continue
			}
			seen[p] = true
			cleaned = append(cleaned, p)
		}

		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("1 = 1").Delete(&model.BaseUrlPath{}).Error; err != nil {
				return err
			}
			for i, p := range cleaned {
				if err := tx.Create(&model.BaseUrlPath{Path: p, SortOrder: i}).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": cleaned})
	}
}
