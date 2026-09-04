package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

const (
	topologySchemaVersion = 1
	topologyConfigRowID   = "topology-main"
)

type TopologyNode struct {
	Type       string          `json:"type"`
	Name       string          `json:"name"`
	ProviderID *string         `json:"provider_id,omitempty"`
	RuleID     *string         `json:"rule_id,omitempty"`
	Order      *int            `json:"order,omitempty"`
	Enabled    *bool           `json:"enabled,omitempty"`
	Config     json.RawMessage `json:"config,omitempty"`
}

type TopologyDocument [][]TopologyNode

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
		canonical, rows, err := validateTopologyDocument(db, document)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		publish, err := replaceTopology(db, canonical, rows, refresher)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if publish != nil {
			publish()
		}
		c.JSON(http.StatusOK, canonical)
	}
}

func decodeTopologyDocument(reader io.Reader) (TopologyDocument, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	var document TopologyDocument
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("decode topology: %w", err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("decode topology: trailing JSON value")
		}
		return nil, fmt.Errorf("decode topology trailing value: %w", err)
	}
	return document, nil
}

func loadTopologyDocument(db *gorm.DB) (TopologyDocument, error) {
	var config model.TopologyConfig
	if err := db.Where("id = ?", topologyConfigRowID).First(&config).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return TopologyDocument{}, nil
		}
		return nil, fmt.Errorf("load topology config: %w", err)
	}
	var document TopologyDocument
	if err := json.Unmarshal([]byte(config.Nodes), &document); err != nil {
		return nil, fmt.Errorf("decode stored topology document: %w", err)
	}
	return document, nil
}

// replaceTopology persists the canonical JSON document as the source of truth
// and derives the normalized assignment rows from it in the same transaction,
// so the two can never diverge.
func replaceTopology(db *gorm.DB, document TopologyDocument, rows []model.TopologySlotAssignment, refresher TopologyRefresher) (func(), error) {
	var publish func()
	err := db.Transaction(func(tx *gorm.DB) error {
		encoded, err := json.Marshal(document)
		if err != nil {
			return fmt.Errorf("encode topology document: %w", err)
		}
		config := model.TopologyConfig{
			ID:      topologyConfigRowID,
			Version: topologySchemaVersion,
			Nodes:   string(encoded),
			Edges:   "[]",
		}
		if err := tx.Where("id = ?", topologyConfigRowID).Delete(&model.TopologyConfig{}).Error; err != nil {
			return fmt.Errorf("replace topology config: %w", err)
		}
		if err := tx.Create(&config).Error; err != nil {
			return fmt.Errorf("create topology config: %w", err)
		}
		if err := tx.Where("1 = 1").Delete(&model.TopologySlotAssignment{}).Error; err != nil {
			return fmt.Errorf("replace topology assignments: %w", err)
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return fmt.Errorf("create topology assignments: %w", err)
			}
		}
		state := model.TopologyState{ID: 1, SchemaVersion: topologySchemaVersion}
		if err := tx.Where("id = ?", 1).FirstOrCreate(&state).Error; err != nil {
			return fmt.Errorf("upsert topology state: %w", err)
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
	return publish, err
}
