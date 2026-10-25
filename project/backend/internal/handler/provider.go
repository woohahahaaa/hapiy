package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	providerops "github.com/hapiy/hapiy/internal/provider"
	"github.com/hapiy/hapiy/internal/relay"
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

// fillAutoDisabled derives each provider's AutoDisabled flag from the
// provider-dimension AutoDisableState rows so the API contract
// (auto_disabled in provider payloads) is preserved without a stored column.
func fillAutoDisabled(db *gorm.DB, providers []model.Provider) error {
	if len(providers) == 0 {
		return nil
	}
	ids := make([]string, 0, len(providers))
	for _, p := range providers {
		ids = append(ids, p.ID)
	}
	var states []model.AutoDisableState
	if err := db.Where("dimension = ? AND disabled = ? AND provider_id IN ?",
		model.FailoverDimensionProvider, true, ids).Find(&states).Error; err != nil {
		return err
	}
	disabled := make(map[string]bool, len(states))
	for _, s := range states {
		disabled[s.ProviderID] = true
	}
	for i := range providers {
		providers[i].AutoDisabled = disabled[providers[i].ID]
	}
	return nil
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
		if err := db.Find(&providers).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// 供应商页面按名称字母表排序（中文按拼音）。
		sortByNameStable(providers, func(p model.Provider) string { return p.Name })
		providers = sliceWindow(providers, offset, limit)
		if err := fillAutoDisabled(db, providers); err != nil {
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
		if err := fillAutoDisabled(db, []model.Provider{provider}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		if err := providerops.Create(db, engine, &provider); err != nil {
			if errors.Is(err, providerops.ErrNameTaken) {
				respondError(c, http.StatusConflict, "PROVIDER_NAME_EXISTS", "供应商名称已存在")
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
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

		if err := providerops.Update(db, engine, &provider); err != nil {
			if errors.Is(err, providerops.ErrNameTaken) {
				respondError(c, http.StatusConflict, "PROVIDER_NAME_EXISTS", "供应商名称已存在")
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if err := fillAutoDisabled(db, []model.Provider{provider}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}

// SetProviderDedupeV1Suffix updates only the model-list /v1 dedupe
// preference. It is a narrow endpoint so toggling the checkbox in the
// "fetch models" dialog never rewrites the rest of the provider form.
func SetProviderDedupeV1Suffix(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Enabled bool `json:"dedupe_v1_suffix"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			respondError(c, http.StatusBadRequest, "REQUEST_BODY_INVALID", "请求体格式错误")
			return
		}
		if err := providerops.SetDedupeV1(db, id, body.Enabled); err != nil {
			if errors.Is(err, providerops.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "dedupe_v1_suffix": body.Enabled}})
	}
}

func DeleteProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if err := providerops.Delete(db, engine, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "provider deleted"})
	}
}

func ToggleProvider(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		provider, err := providerops.ToggleStatus(db, engine, c.Param("id"))
		if err != nil {
			if errors.Is(err, providerops.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": provider})
	}
}

// ToggleWorkflow switches the workflow-level enable flag of a provider
// (the switch on the topology node), independent of the channel-level Status.
// Only one workflow per provider name may be enabled at a time.
func ToggleWorkflow(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		provider, err := providerops.ToggleWorkflow(db, engine, c.Param("id"))
		if err != nil {
			switch {
			case errors.Is(err, providerops.ErrNotFound):
				c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			case errors.Is(err, providerops.ErrWorkflowTaken):
				respondError(c, http.StatusConflict, "PROVIDER_WORKFLOW_ALREADY_ENABLED", err.Error())
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}
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
		var states []model.AutoDisableState
		if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		byProvider := make(map[string][]model.AutoDisableState)
		for _, state := range states {
			byProvider[state.ProviderID] = append(byProvider[state.ProviderID], state)
		}
		data := make([]providerDisableStatus, 0, len(providers))
		for _, provider := range providers {
			status := providerDisableStatus{ProviderID: provider.ID, BaseURLs: map[string]bool{}, Keys: map[string]bool{}}
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
		var req resetProviderDisableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		id := c.Param("id")
		if err := providerops.ResetDisableValue(db, engine, id, req.Dimension, req.Value); err != nil {
			switch {
			case errors.Is(err, providerops.ErrNotFound):
				c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
			case errors.Is(err, providerops.ErrValueRequired), errors.Is(err, providerops.ErrDimension):
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}
		if req.Dimension == model.FailoverDimensionProvider {
			req.Value = id
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"provider_id": id, "dimension": req.Dimension, "value": req.Value}})
	}
}

type resetProviderDimensionRequest struct {
	Dimension string `json:"dimension" binding:"required,oneof=provider base_url key"`
}

// ResetProviderDisableDimension clears every auto-disable state of one
// dimension for a single provider. Used by the provider editor dialog's
// "故障转移" block (恢复 Provider 行 / 恢复该供应商全部 BaseURL / 全部 Key).
func ResetProviderDisableDimension(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var req resetProviderDimensionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := providerops.ResetDisableDimension(db, engine, id, req.Dimension); err != nil {
			if errors.Is(err, providerops.ErrDimension) {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"provider_id": id, "dimension": req.Dimension}})
	}
}

type resetAllProviderDisableRequest struct {
	Dimension string `json:"dimension" binding:"required,oneof=provider base_url key"`
}

// ResetAllProviderDisableStatus clears every auto-disable state of one
// dimension across all providers. Used by the dashboard's "故障转移"
// summary block (恢复 provider 行 / 恢复全部 baseURL / 恢复全部 key).
func ResetAllProviderDisableStatus(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req resetAllProviderDisableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := providerops.ResetAllDisable(db, engine, req.Dimension); err != nil {
			if errors.Is(err, providerops.ErrDimension) {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"dimension": req.Dimension}})
	}
}
