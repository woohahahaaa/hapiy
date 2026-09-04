package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// ownModelListItem is the OpenAI-compatible model list item returned by the
// own model list endpoint. Provider information is intentionally omitted —
// the endpoint exposes only the model names that the topology currently
// routes, not how they are backed.
type ownModelListItem struct {
	ID     string `json:"id"`
	Object string `json:"object"`
}

// OwnModelList returns hapiy's aggregated model list in OpenAI-compatible
// format ({ "object": "list", "data": [{id, object}, ...] }). The data
// source is the union of every enabled provider's compiled ModelSet —
// the same set that drives the model-hub column on the topology page.
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
				ID:     m.ID,
				Object: "model",
			})
		}
		c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
	}
}