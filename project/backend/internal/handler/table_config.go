package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// GetTableConfig returns the saved config for the table id (404 if none).
func GetTableConfig(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var cfg model.TableConfig
		if err := db.First(&cfg, "table_id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "table config not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": cfg})
	}
}

// UpsertTableConfig writes the configs blob for the table id. The body's
// `configs` field must be a JSON array; we store it as a JSON string.
func UpsertTableConfig(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Configs json.RawMessage `json:"configs"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if len(body.Configs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "configs is required"})
			return
		}
		var probe []map[string]interface{}
		if err := json.Unmarshal(body.Configs, &probe); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "configs must be a JSON array"})
			return
		}

		var existing model.TableConfig
		err := db.First(&existing, "table_id = ?", id).Error
		now := time.Now()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			cfg := model.TableConfig{
				ID:        uuid.New().String(),
				TableID:   id,
				Configs:   string(body.Configs),
				UpdatedAt: now,
			}
			if err := db.Create(&cfg).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"data": cfg})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		existing.Configs = string(body.Configs)
		existing.UpdatedAt = now
		if err := db.Save(&existing).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": existing})
	}
}