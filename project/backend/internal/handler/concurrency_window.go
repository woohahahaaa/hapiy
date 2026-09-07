package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// ListConcurrencyWindows returns the current active-window occupancy for every
// 并行控制 slot node. Rows live only while the workflow runs: the engine
// writes them (throttled ~1/s/bucket) as requests enter/leave windows and
// wipes them on plan republish. The frontend polls this endpoint to show the
// live in-window count on each concurrency card.
func ListConcurrencyWindows(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rows []model.ConcurrencyWindowCounter
		if err := db.Order("node_id asc").Find(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		items := make([]gin.H, 0, len(rows))
		for _, r := range rows {
			items = append(items, gin.H{
				"node_id":      r.NodeID,
				"window_count": r.WindowCount,
				"max_count":    r.MaxCount,
			})
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}
