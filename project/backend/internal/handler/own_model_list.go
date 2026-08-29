package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// ownModelListItem is the OpenAI-compatible model list item returned by the
// own model list endpoint. `owned_by` mirrors the configured provider name
// so OpenAI-compatible clients can display it directly.
type ownModelListItem struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	OwnedBy string `json:"owned_by"`
}

// OwnModelList returns hapiy's aggregated model list in OpenAI-compatible
// format ({ "object": "list", "data": [{id, object, owned_by}, ...] }).
// The data source is the union of every enabled provider's compiled
// ModelSet — i.e. the models the relay can actually serve right now.
func OwnModelList(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		if engine == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "引擎未就绪"})
			return
		}
		models := engine.OwnModels()
		items := make([]ownModelListItem, 0, len(models))
		for _, m := range models {
			items = append(items, ownModelListItem{
				ID:      m.ID,
				Object:  "model",
				OwnedBy: m.OwnedBy,
			})
		}
		c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
	}
}
