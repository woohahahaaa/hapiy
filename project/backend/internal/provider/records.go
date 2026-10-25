package provider

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

var (
	ErrRecordNotFound = errors.New("记录不存在")
	ErrMinutesInvalid = errors.New("minutes 必须为正数")
)

// ListPendingRecords returns every still-open DisabledRecord sorted by
// disabled_at descending, after reconciling the table with the live disable
// states. Resolved rows are filtered out.
func ListPendingRecords(db *gorm.DB) ([]model.DisabledRecord, error) {
	backfillRecords(db)
	var rows []model.DisabledRecord
	if err := db.Where("resolved_at IS NULL").Order("disabled_at desc").Find(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []model.DisabledRecord{}
	}
	return rows, nil
}

// ReplayRecord probes upstream again using the captured request and clears the
// disable when the probe passes. resolved is false when the record stays open.
func ReplayRecord(db *gorm.DB, engine *relay.Engine, id string) (*model.DisabledRecord, bool, error) {
	record, err := loadRecord(db, id)
	if err != nil {
		return nil, false, err
	}
	if record.ResolvedAt != nil {
		return record, true, nil
	}
	if engine == nil {
		return nil, false, errors.New("relay engine unavailable")
	}
	resolved := engine.ReplayDisabledRecord(record)
	var fresh model.DisabledRecord
	if err := db.First(&fresh, "id = ?", id).Error; err == nil {
		*record = fresh
	}
	if resolved {
		service.LogEvent(service.LogSourceChannelRecoveredManual, displayName(db, record.ProviderID),
			service.ChannelEventMessage(record.Dimension, record.Value),
			"操作: 重放该禁用记录进行恢复")
	}
	return record, resolved, nil
}

// ExtendRecordCountdown pushes a record's countdown deadline forward by
// `minutes`, shifting disabled_at so the remaining time gains the full
// duration. extended is false when the record is already resolved.
func ExtendRecordCountdown(db *gorm.DB, id string, minutes int) (*model.DisabledRecord, bool, error) {
	if minutes <= 0 {
		return nil, false, ErrMinutesInvalid
	}
	record, err := loadRecord(db, id)
	if err != nil {
		return nil, false, err
	}
	if record.ResolvedAt != nil {
		return record, false, nil
	}
	record.DisabledAt = record.DisabledAt.Add(time.Duration(minutes) * time.Minute)
	if err := db.Model(&model.DisabledRecord{}).
		Where("id = ?", id).
		Update("disabled_at", record.DisabledAt).Error; err != nil {
		return nil, false, err
	}
	return record, true, nil
}

// RestoreRecordDirectly clears the disable state behind a record without
// probing upstream, and drops the record plus its failover hit counter.
func RestoreRecordDirectly(db *gorm.DB, engine *relay.Engine, id string) error {
	record, err := loadRecord(db, id)
	if err != nil {
		return err
	}
	if err := db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ? AND value = ?", record.ProviderID, record.Dimension, record.Value).
		Update("disabled", false).Error; err != nil {
		return err
	}
	result := db.Delete(&model.DisabledRecord{}, "id = ?", id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		service.LogEvent(service.LogSourceChannelRecoveredManual, displayName(db, record.ProviderID),
			service.ChannelEventMessage(record.Dimension, record.Value),
			"操作: 直接清除该禁用记录")
		_ = db.Where("provider_id = ? AND dimension = ? AND value = ?",
			record.ProviderID, record.Dimension, record.Value).
			Delete(&model.FailoverHitCounter{}).Error
	}
	reload(engine)
	return nil
}

func loadRecord(db *gorm.DB, id string) (*model.DisabledRecord, error) {
	var record model.DisabledRecord
	if err := db.First(&record, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordNotFound
		}
		return nil, err
	}
	return &record, nil
}

// backfillRecords reconciles auto_disable_states with disabled_records in both
// directions:
//   - states that are disabled but have no record get one created (so the
//     pending table always reflects reality even if the original disable
//     predates record-keeping or the record was cleaned up). The captured
//     request body is best-effort recovered from the latest log_captures row
//     for that provider; when nothing is found the record is stored with an
//     empty body and the replay falls back to a default probe.
//   - records whose underlying disable state is gone (manually restored
//     elsewhere, e.g. the provider editor) are dropped so the pending table
//     never shows items that are no longer disabled.
func backfillRecords(db *gorm.DB) {
	var states []model.AutoDisableState
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
		row := model.DisabledRecord{
			ProviderID:     st.ProviderID,
			Dimension:      st.Dimension,
			Value:          st.Value,
			RequestHeaders: headers,
			RequestBody:    body,
			DisabledAt:     time.Now(),
			RetryCount:     0,
		}
		if err := db.Create(&row).Error; err != nil {
			log.Printf("backfill disabled record %s/%s/%s: %v", st.ProviderID, st.Dimension, st.Value, err)
		}
	}
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
