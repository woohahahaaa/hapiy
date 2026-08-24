package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

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
		backfillMissingDisabledRecords(db)
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

// backfillMissingDisabledRecords reconciles provider_disable_states with
// disabled_records: any state that is disabled but has no matching record
// gets one created (so the pending table always reflects reality even if
// the original disable predates record-keeping or the record was cleaned
// up). The captured request body is best-effort recovered from the latest
// log_captures row for that provider; when nothing is found the record is
// stored with an empty body and the replay falls back to a default probe.
func backfillMissingDisabledRecords(db *gorm.DB) {
	var states []model.ProviderDisableState
	if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
		return
	}
	for _, st := range states {
		var count int64
		if err := db.Model(&model.DisabledRecord{}).
			Where("provider_id = ? AND dimension = ? AND value = ?", st.ProviderID, st.Dimension, st.Value).
			Count(&count).Error; err != nil || count > 0 {
			continue
		}
		headers := ""
		body := ""
		var capture model.LogCapture
		if err := db.Where("provider_id = ?", st.ProviderID).
			Order("created_at desc").First(&capture).Error; err == nil {
			if capture.Headers != nil {
				if raw, err := json.Marshal(capture.Headers); err == nil {
					headers = string(raw)
				}
			}
			if capture.RequestBody != nil {
				if raw, err := json.Marshal(capture.RequestBody); err == nil {
					body = string(raw)
				}
			}
		}
		now := time.Now()
		row := model.DisabledRecord{
			ProviderID:     st.ProviderID,
			Dimension:      st.Dimension,
			Value:          st.Value,
			RequestHeaders: headers,
			RequestBody:    body,
			DisabledAt:     now,
			RetryCount:     0,
		}
		if err := db.Create(&row).Error; err != nil {
			log.Printf("backfill disabled record %s/%s/%s: %v", st.ProviderID, st.Dimension, st.Value, err)
		}
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

// RestoreDisabledRecordDirectly clears the disable state behind a record
// without running a probe — an explicit user action. The record row and
// its underlying ProviderDisableState/auto_disabled flag are reset.
func RestoreDisabledRecordDirectly(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var record model.DisabledRecord
		if err := db.First(&record, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		if err := db.Model(&model.ProviderDisableState{}).
			Where("provider_id = ? AND dimension = ? AND value = ?", record.ProviderID, record.Dimension, record.Value).
			Update("disabled", false).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if record.Dimension == model.FailoverDimensionProvider {
			if err := db.Model(&model.Provider{}).
				Where("id = ?", record.ProviderID).
				Update("auto_disabled", false).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if err := db.Delete(&model.DisabledRecord{}, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		engine.LoadProviders()
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "resolved": true}})
	}
}
