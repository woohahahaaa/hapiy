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
		rows, err := validateTopologyDocument(db, document)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		publish, err := replaceTopology(db, rows, refresher)
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
	var rows []model.TopologySlotAssignment
	if err := db.Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load topology assignments: %w", err)
	}
	byProvider := make(map[string][]model.TopologySlotAssignment)
	for _, row := range rows {
		byProvider[row.ProviderID] = append(byProvider[row.ProviderID], row)
	}
	document := TopologyDocument{}
	for providerID, assignments := range byProvider {
		workflow := []TopologyNode{}
		var provider model.Provider
		providerName := ""
		if err := db.Where("id = ?", providerID).First(&provider).Error; err == nil {
			providerName = provider.Name
		}
		pid := providerID
		workflow = append(workflow, TopologyNode{
			Type: "provider", Name: providerName, ProviderID: &pid,
		})
		sortTopologyAssignments(assignments)
		for _, a := range assignments {
			node := TopologyNode{
				Type: a.SlotType, Name: a.Name, Enabled: &a.Enabled,
			}
			if a.RuleID != nil {
				rid := *a.RuleID
				node.RuleID = &rid
			}
			if a.SlotType != "logOutput" {
				order := a.Order
				node.Order = &order
			}
			if a.SlotType == "logOutput" {
				node.Config = json.RawMessage(a.Config)
			}
			workflow = append(workflow, node)
		}
		document = append(document, workflow)
	}
	sortWorkflowsByProvider(document)
	return document, nil
}

func replaceTopology(db *gorm.DB, rows []model.TopologySlotAssignment, refresher TopologyRefresher) (func(), error) {
	var publish func()
	err := db.Transaction(func(tx *gorm.DB) error {
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

func sortTopologyAssignments(assignments []model.TopologySlotAssignment) {
	sort.Slice(assignments, func(i, j int) bool {
		left, right := assignments[i], assignments[j]
		if slotRank(left.SlotType) != slotRank(right.SlotType) {
			return slotRank(left.SlotType) < slotRank(right.SlotType)
		}
		if left.Order != right.Order {
			return left.Order < right.Order
		}
		return left.ID < right.ID
	})
}

func sortWorkflowsByProvider(document TopologyDocument) {
	sort.Slice(document, func(i, j int) bool {
		pi, pj := "", ""
		if len(document[i]) > 0 && document[i][0].ProviderID != nil {
			pi = *document[i][0].ProviderID
		}
		if len(document[j]) > 0 && document[j][0].ProviderID != nil {
			pj = *document[j][0].ProviderID
		}
		return pi < pj
	})
}
