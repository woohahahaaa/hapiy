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
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)
		var total int64
		if err := db.Model(&model.Provider{}).Count(&total).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := db.Order("id asc").Limit(limit).Offset(offset).Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": providers, "total": total})
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

// ToggleWorkflow switches the workflow-level enable flag of a provider
// (the switch on the topology node), independent of the channel-level Status.
// Only one workflow per provider name may be enabled at a time.
func ToggleWorkflow(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var provider model.Provider
		if err := db.First(&provider, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			return
		}

		next := !provider.WorkflowEnabled
		if next {
			var count int64
			if err := db.Model(&model.Provider{}).
				Where("name = ? AND id <> ? AND workflow_enabled = ?", provider.Name, provider.ID, true).
				Count(&count).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if count > 0 {
				c.JSON(http.StatusConflict, gin.H{"error": "当前已有一个同名供应商的工作流在启用，请先将另一个关闭"})
				return
			}
		}

		provider.WorkflowEnabled = next
		if err := db.Save(&provider).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		engine.LoadProviders()

		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}
