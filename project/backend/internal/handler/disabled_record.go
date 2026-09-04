package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
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

// backfillMissingDisabledRecords reconciles auto_disable_states with
// disabled_records in both directions:
//   - states that are disabled but have no record get one created (so the
//     pending table always reflects reality even if the original disable
//     predates record-keeping or the record was cleaned up). The captured
//     request body is best-effort recovered from the latest log_captures
//     row for that provider; when nothing is found the record is stored
//     with an empty body and the replay falls back to a default probe.
//   - records whose underlying disable state is gone (manually restored
//     elsewhere, e.g. the provider editor) are dropped so the pending
//     table never shows items that are no longer disabled.
func backfillMissingDisabledRecords(db *gorm.DB) {
	var states []model.AutoDisableState
	if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
		return
	}
	// States with a pending state but no record -> create one.
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
	// Records whose disable state is no longer active -> drop them.
	var records []model.DisabledRecord
	if err := db.Where("resolved_at IS NULL").Find(&records).Error; err != nil {
		return
	}
	for _, rec := range records {
		var stateCount int64
		if err := db.Model(&model.AutoDisableState{}).
			Where("provider_id = ? AND dimension = ? AND value = ? AND disabled = ?",
				rec.ProviderID, rec.Dimension, rec.Value, true).
			Count(&stateCount).Error; err != nil {
			continue
		}
		if stateCount == 0 {
			if err := db.Delete(&model.DisabledRecord{}, "id = ?", rec.ID).Error; err != nil {
				log.Printf("backfill drop stale record %s: %v", rec.ID, err)
			}
		}
	}
}

// providerDisplayName resolves the provider's display name for event
// logging; returns "" when the provider no longer exists.
func providerDisplayName(db *gorm.DB, providerID string) string {
	var p model.Provider
	if err := db.First(&p, "id = ?", providerID).Error; err != nil {
		return ""
	}
	return p.Name
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
		if resolved {
			service.LogEvent(service.LogSourceChannelRecoveredManual, providerDisplayName(db, record.ProviderID), service.ChannelEventMessage(record.Dimension, record.Value), "操作: 重放该禁用记录进行恢复")
		}
		c.JSON(http.StatusOK, gin.H{"data": record, "resolved": resolved})
	}
}

// ExtendDisabledRecordCountdown pushes a record's countdown deadline
// forward by `minutes` — timed-recovery mode lets the user defer a
// past-deadline record's recovery to the next cycle instead of either
// restoring immediately or waiting for auto-recovery to fire. The
// record's disabled_at is shifted so the remaining countdown gains the
// full configured duration on top of whatever is already elapsed.
func ExtendDisabledRecordCountdown(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Minutes int `json:"minutes"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请求体格式无效"})
			return
		}
		if body.Minutes <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "minutes 必须为正数"})
			return
		}
		var record model.DisabledRecord
		if err := db.First(&record, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		if record.ResolvedAt != nil {
			c.JSON(http.StatusOK, gin.H{"data": record, "extended": false})
			return
		}
		record.DisabledAt = record.DisabledAt.Add(time.Duration(body.Minutes) * time.Minute)
		if err := db.Model(&model.DisabledRecord{}).
			Where("id = ?", id).
			Update("disabled_at", record.DisabledAt).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": record, "extended": true})
	}
}

// RestoreDisabledRecordDirectly clears the disable state behind a record
// without running a probe — an explicit user action. The record row and
// its underlying AutoDisableState are reset.
func RestoreDisabledRecordDirectly(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var record model.DisabledRecord
		if err := db.First(&record, "id = ?", id).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "记录不存在"})
			return
		}
		if err := db.Model(&model.AutoDisableState{}).
			Where("provider_id = ? AND dimension = ? AND value = ?", record.ProviderID, record.Dimension, record.Value).
			Update("disabled", false).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	result := db.Delete(&model.DisabledRecord{}, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected > 0 {
		service.LogEvent(service.LogSourceChannelRecoveredManual, providerDisplayName(db, record.ProviderID), service.ChannelEventMessage(record.Dimension, record.Value), "操作: 直接清除该禁用记录")
		_ = db.Where("provider_id = ? AND dimension = ? AND value = ?", record.ProviderID, record.Dimension, record.Value).
			Delete(&model.FailoverHitCounter{}).Error
	}
	engine.LoadProviders()
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}, "resolved": true})
}
}
