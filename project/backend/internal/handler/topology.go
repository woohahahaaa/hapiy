package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

const topologySchemaVersion = 1

type TopologySlot struct {
	ID        string          `json:"id"`
	ChannelID string          `json:"channel_id"`
	SlotType  string          `json:"slot_type"`
	Order     int             `json:"order"`
	Enabled   bool            `json:"enabled"`
	RuleID    *string         `json:"rule_id"`
	Config    json.RawMessage `json:"config"`
}

type TopologyDocument struct {
	SchemaVersion int            `json:"schema_version"`
	Revision      uint64         `json:"revision"`
	Slots         []TopologySlot `json:"slots"`
}

type TopologyRefresher interface {
	PrepareTopologyRefresh(*gorm.DB) (func(), error)
}

func TopologyGet(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		document, err := loadTopologyDocument(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, document)
	}
}

func TopologyPut(db *gorm.DB, refresher TopologyRefresher) gin.HandlerFunc {
	return func(c *gin.Context) {
		document, err := decodeTopologyDocument(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		rows, err := validateTopologyDocument(db, document)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		currentRevision, publish, err := replaceTopology(db, document, rows, refresher)
		if errors.Is(err, errTopologyRevisionConflict) {
			c.JSON(http.StatusConflict, gin.H{
				"current_revision": currentRevision,
				"error":            "topology_revision_conflict",
			})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if publish != nil {
			publish()
		}

		saved, err := loadTopologyDocument(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, saved)
	}
}

func decodeTopologyDocument(reader io.Reader) (TopologyDocument, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	var document TopologyDocument
	if err := decoder.Decode(&document); err != nil {
		return TopologyDocument{}, fmt.Errorf("decode topology: %w", err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return TopologyDocument{}, errors.New("decode topology: trailing JSON value")
		}
		return TopologyDocument{}, fmt.Errorf("decode topology trailing value: %w", err)
	}
	if document.Slots == nil {
		return TopologyDocument{}, errors.New("slots must be an array")
	}
	return document, nil
}

func loadTopologyDocument(db *gorm.DB) (TopologyDocument, error) {
	document := TopologyDocument{SchemaVersion: topologySchemaVersion, Slots: []TopologySlot{}}
	var state model.TopologyState
	err := db.First(&state, 1).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return TopologyDocument{}, fmt.Errorf("load topology state: %w", err)
	}
	if err == nil {
		document.SchemaVersion = state.SchemaVersion
		document.Revision = state.Revision
	}

	var rows []model.TopologySlotAssignment
	if err := db.Find(&rows).Error; err != nil {
		return TopologyDocument{}, fmt.Errorf("load topology assignments: %w", err)
	}
	for _, row := range rows {
		document.Slots = append(document.Slots, TopologySlot{
			ID: row.ID, ChannelID: row.ChannelID, SlotType: row.SlotType,
			Order: row.Order, Enabled: row.Enabled, RuleID: row.RuleID,
			Config: json.RawMessage(row.Config),
		})
	}
	sortTopologySlots(document.Slots)
	return document, nil
}

var errTopologyRevisionConflict = errors.New("topology revision conflict")

func replaceTopology(db *gorm.DB, document TopologyDocument, rows []model.TopologySlotAssignment, refresher TopologyRefresher) (uint64, func(), error) {
	currentRevision := uint64(0)
	var publish func()
	err := db.Transaction(func(tx *gorm.DB) error {
		var state model.TopologyState
		err := tx.First(&state, 1).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("load topology revision: %w", err)
		}
		if err == nil {
			currentRevision = state.Revision
		}
		if currentRevision != document.Revision {
			return errTopologyRevisionConflict
		}
		if err := tx.Where("1 = 1").Delete(&model.TopologySlotAssignment{}).Error; err != nil {
			return fmt.Errorf("replace topology assignments: %w", err)
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return fmt.Errorf("create topology assignments: %w", err)
			}
		}
		next := model.TopologyState{ID: 1, SchemaVersion: topologySchemaVersion, Revision: currentRevision + 1}
		if err == nil {
			if err := tx.Model(&model.TopologyState{}).Where("id = ?", 1).Updates(map[string]any{
				"schema_version": next.SchemaVersion,
				"revision":       next.Revision,
			}).Error; err != nil {
				return err
			}
		} else if err := tx.Create(&next).Error; err != nil {
			return err
		}
		if refresher != nil {
			candidate, err := refresher.PrepareTopologyRefresh(tx)
			if err != nil {
				return fmt.Errorf("prepare topology plans: %w", err)
			}
			publish = candidate
		}
		return nil
	})
	return currentRevision, publish, err
}

func sortTopologySlots(slots []TopologySlot) {
	sort.Slice(slots, func(i, j int) bool {
		left, right := slots[i], slots[j]
		if left.ChannelID != right.ChannelID {
			return left.ChannelID < right.ChannelID
		}
		if slotRank(left.SlotType) != slotRank(right.SlotType) {
			return slotRank(left.SlotType) < slotRank(right.SlotType)
		}
		if left.Order != right.Order {
			return left.Order < right.Order
		}
		return left.ID < right.ID
	})
}
