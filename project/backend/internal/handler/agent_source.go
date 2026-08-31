package handler

import (
	"net/http"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AgentModelConfigSourceView is the storage shape of a 模型配置参考供应商
// selection exposed to the sync dialog: mode is "none" | "self" | "link",
// self_supplier stores the models.dev supplier in "self" mode, and
// link_provider_id stores our provider whose same-named model's reference to
// follow in "link" mode. Nothing resolved is persisted.
type AgentModelConfigSourceView struct {
	Mode           string `json:"mode"`
	SelfSupplier   string `json:"self_supplier"`
	LinkProviderID string `json:"link_provider_id"`
}

// ListAgentModelConfigSources returns every persisted 模型配置参考供应商
// selection of a config file as { providerId: { modelId: source } }.
func ListAgentModelConfigSources(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var rows []model.AgentModelConfigSource
		if err := db.Where("agent_config_file_id = ?", id).Find(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make(map[string]map[string]AgentModelConfigSourceView)
		for _, row := range rows {
			provider := out[row.ProviderID]
			if provider == nil {
				provider = make(map[string]AgentModelConfigSourceView)
				out[row.ProviderID] = provider
			}
			provider[row.ModelID] = AgentModelConfigSourceView{
				Mode:           row.Mode,
				SelfSupplier:   row.SelfSupplier,
				LinkProviderID: row.LinkProviderID,
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": out})
	}
}

// SaveAgentModelConfigSources upserts a batch of 模型配置参考供应商 selections
// for one config file. The submitted map replaces the file's existing rows
// (keep-it-simple replace: the dialog always saves the full set). An empty
// value stores mode "none" so the map stays complete for the next prefill.
func SaveAgentModelConfigSources(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Sources map[string]map[string]AgentModelConfigSourceView `json:"sources"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		var count int64
		if err := db.Model(&model.AgentConfigFile{}).Where("id = ?", id).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "agent config file not found"})
			return
		}
		valid := map[string]bool{"none": true, "self": true, "link": true}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("agent_config_file_id = ?", id).Delete(&model.AgentModelConfigSource{}).Error; err != nil {
				return err
			}
			for providerID, models := range body.Sources {
				if strings.TrimSpace(providerID) == "" {
					continue
				}
				for modelID, view := range models {
					mode := strings.TrimSpace(view.Mode)
					if mode == "" || !valid[mode] {
						mode = "none"
					}
					row := model.AgentModelConfigSource{
						AgentConfigFileID: id,
						ProviderID:        providerID,
						ModelID:           modelID,
						Mode:              mode,
						SelfSupplier:      strings.TrimSpace(view.SelfSupplier),
						LinkProviderID:    strings.TrimSpace(view.LinkProviderID),
					}
					if err := tx.Create(&row).Error; err != nil {
						return err
					}
				}
			}
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "saved"})
	}
}