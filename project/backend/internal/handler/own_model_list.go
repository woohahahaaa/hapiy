package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ownModelListItem is the OpenAI-compatible model list item returned by the
// own model list endpoint. `owned_by` mirrors the upstream provider name so
// OpenAI-compatible clients can display it directly.
type ownModelListItem struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	OwnedBy string `json:"owned_by"`
}

// OwnModelList returns hapiy's aggregated model list in OpenAI-compatible
// format ({ "object": "list", "data": [{id, object, owned_by}, ...] }).
// The data source is the same models.dev snapshot used by the dashboard.
func OwnModelList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		models, err := modelsDev.load()
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "获取模型列表失败，请稍后重试"})
			return
		}
		items := make([]ownModelListItem, 0, len(models))
		for _, m := range models {
			ownedBy := m.ProviderName
			if ownedBy == "" {
				ownedBy = m.ProviderID
			}
			items = append(items, ownModelListItem{
				ID:      m.ID,
				Object:  "model",
				OwnedBy: ownedBy,
			})
		}
		c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
	}
}
