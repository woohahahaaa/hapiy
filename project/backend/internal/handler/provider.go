package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

type providerDisableStatus struct {
	ProviderID string          `json:"provider_id"`
	Provider   bool            `json:"provider"`
	BaseURLs   map[string]bool `json:"base_urls"`
	Keys       map[string]bool `json:"keys"`
}

type resetProviderDisableRequest struct {
	Dimension string `json:"dimension" binding:"required,oneof=provider base_url key"`
	Value     string `json:"value"`
}

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

func ListProviderDisableStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var providers []model.Provider
		if err := db.Order("id asc").Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var states []model.ProviderDisableState
		if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		byProvider := make(map[string][]model.ProviderDisableState)
		for _, state := range states {
			byProvider[state.ProviderID] = append(byProvider[state.ProviderID], state)
		}
		data := make([]providerDisableStatus, 0, len(providers))
		for _, provider := range providers {
			status := providerDisableStatus{ProviderID: provider.ID, Provider: provider.AutoDisabled, BaseURLs: map[string]bool{}, Keys: map[string]bool{}}
			for _, state := range byProvider[provider.ID] {
				switch state.Dimension {
				case model.FailoverDimensionProvider:
					status.Provider = true
				case model.FailoverDimensionBaseURL:
					status.BaseURLs[state.Value] = true
				case model.FailoverDimensionKey:
					status.Keys[state.Value] = true
				}
			}
			data = append(data, status)
		}
		c.JSON(http.StatusOK, gin.H{"data": data})
	}
}

func ResetProviderDisableStatus(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var provider model.Provider
		if err := db.First(&provider, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			return
		}
		var req resetProviderDisableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.Dimension == model.FailoverDimensionProvider {
			req.Value = provider.ID
		}
		if req.Value == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "value is required for base_url and key"})
			return
		}
		if err := db.Model(&model.ProviderDisableState{}).Where("provider_id = ? AND dimension = ? AND value = ?", provider.ID, req.Dimension, req.Value).Update("disabled", false).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if req.Dimension == model.FailoverDimensionProvider && provider.AutoDisabled {
			provider.AutoDisabled = false
			if err := db.Save(&provider).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// Manual restore only clears the exact restored entity: drop the
		// matching pending record so it stops showing in the recovery list.
		if err := db.Where("provider_id = ? AND dimension = ? AND value = ?",
			provider.ID, req.Dimension, req.Value).
			Delete(&model.DisabledRecord{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		engine.LoadProviders()
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"provider_id": provider.ID, "dimension": req.Dimension, "value": req.Value}})
	}
}

type resetProviderDimensionRequest struct {
	Dimension string `json:"dimension" binding:"required,oneof=provider base_url key"`
}

// ResetProviderDisableDimension clears every auto-disable state of one
// dimension for a single provider. For the provider dimension the
// provider's auto_disabled flag is reset too. Used by the provider
// editor dialog's "自动禁用" block (恢复 Provider 行 / 恢复该供应商全部 BaseURL / 全部 Key).
func ResetProviderDisableDimension(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var req resetProviderDimensionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		stateResult := db.Model(&model.ProviderDisableState{}).
			Where("provider_id = ? AND dimension = ?", id, req.Dimension).
			Update("disabled", false)
		if stateResult.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": stateResult.Error.Error()})
			return
		}
		if req.Dimension == model.FailoverDimensionProvider {
			if err := db.Model(&model.Provider{}).
				Where("id = ?", id).
				Update("auto_disabled", false).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// Manual dimension restore drops every pending record of this
		// provider+dimension (they no longer represent an active disable).
		delResult := db.Where("provider_id = ? AND dimension = ?", id, req.Dimension).
			Delete(&model.DisabledRecord{})
		if delResult.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": delResult.Error.Error()})
			return
		}
		if stateResult.RowsAffected > 0 || delResult.RowsAffected > 0 {
			service.LogEvent(service.LogSourceChannelRecoveredManual, providerDisplayName(db, id), service.ChannelEventMessage(req.Dimension, ""))
		}
		engine.LoadProviders()
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"provider_id": id, "dimension": req.Dimension}})
	}
}

type resetAllProviderDisableRequest struct {
	Dimension string `json:"dimension" binding:"required,oneof=provider base_url key"`
}

// ResetAllProviderDisableStatus clears every auto-disable state of one
// dimension across all providers. For the provider dimension the
// providers' auto_disabled flag is reset too. Used by the dashboard's
// "自动禁用" summary block (恢复 provider 行 / 恢复全部 baseURL / 恢复全部 key).
func ResetAllProviderDisableStatus(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req resetAllProviderDisableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		stateResult := db.Model(&model.ProviderDisableState{}).
			Where("dimension = ?", req.Dimension).
			Update("disabled", false)
		if stateResult.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": stateResult.Error.Error()})
			return
		}
		if stateResult.RowsAffected > 0 {
			service.LogEvent(service.LogSourceChannelRecoveredManual, "", "重置全部 "+service.DimensionLabel(req.Dimension)+" 禁用状态")
		}
		if req.Dimension == model.FailoverDimensionProvider {
			if err := db.Model(&model.Provider{}).
				Where("auto_disabled = ?", true).
				Update("auto_disabled", false).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		engine.LoadProviders()
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"dimension": req.Dimension}})
	}
}
