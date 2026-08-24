package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"gorm.io/gorm"
)

// ListDisabledRecords returns every still-open DisabledRecord sorted by
// disabled_at descending. Resolved rows are filtered out so the table
// stays focused on work that actually needs attention.
func ListDisabledRecords(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rows []model.DisabledRecord
		if err := db.Where("resolved_at IS NULL").Order("disabled_at desc").Find(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if rows == nil {
			rows = []model.DisabledRecord{}
		}
		c.JSON(http.StatusOK, gin.H{"data": rows})
	}
}

// ReplayDisabledRecord triggers a manual replay of a recorded disable
// event. On success the underlying disable is cleared (with cascade),
// and the response includes whether the replay resolved the row.
func ReplayDisabledRecord(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var record model.DisabledRecord
		if err := db.First(&record, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		if record.ResolvedAt != nil {
			c.JSON(http.StatusOK, gin.H{"data": record, "resolved": true})
			return
		}
		resolved := engine.ReplayDisabledRecord(&record)
		// Re-read the row so the client sees the updated retry_count / resolved_at.
		_ = db.First(&record, "id = ?", id).Error
		c.JSON(http.StatusOK, gin.H{"data": record, "resolved": resolved})
	}
}
