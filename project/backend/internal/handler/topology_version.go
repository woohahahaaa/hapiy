package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

const (
	topologyArchiveWindow    = 5 * time.Minute
	maxTopologyVersions      = 20
	topologyArchiveLoopEvery = 5 * time.Second
)

// ── Response shapes ──

// topologyVersionDTO is one archived history entry.
type topologyVersionDTO struct {
	ID             string    `json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	WorkflowTotal  int       `json:"workflow_total"`
	WorkflowActive int       `json:"workflow_active"`
	NodeCount      int       `json:"node_count"`
}

// topologyCurrentDTO describes the live (current) topology and whether it has
// been archived yet.
type topologyCurrentDTO struct {
	Archived       bool      `json:"archived"`
	UpdatedAt      time.Time `json:"updated_at"`
	WorkflowTotal  int       `json:"workflow_total"`
	WorkflowActive int       `json:"workflow_active"`
	NodeCount      int       `json:"node_count"`
}

// topologyVersionList returns the view the modal renders: the current live
// topology (first row, always) plus the archived history (newest first).
func topologyVersionList(db *gorm.DB) (gin.H, error) {
	var config model.TopologyConfig
	err := db.Where("id = ?", topologyConfigRowID).First(&config).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return gin.H{"current": nil, "versions": []topologyVersionDTO{}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load topology config: %w", err)
	}

	archived, err := topologyCurrentArchived(db, config.UpdatedAt)
	if err != nil {
		return nil, err
	}

	var versions []model.TopologyVersion
	if err := db.Order("created_at DESC, id DESC").Find(&versions).Error; err != nil {
		return nil, fmt.Errorf("list topology versions: %w", err)
	}

	summary := make([]topologyVersionDTO, 0, len(versions))
	for _, v := range versions {
		// The newest version duplicates the live current state when it has just
		// been archived; the frontend shows that as the "current" row, so skip it.
		if archived && v.ConfigUpdatedAt.Equal(config.UpdatedAt) {
			continue
		}
		summary = append(summary, topologyVersionDTO{
			ID:             v.ID,
			CreatedAt:      v.CreatedAt,
			WorkflowTotal:  v.WorkflowTotal,
			WorkflowActive: v.WorkflowActive,
			NodeCount:      v.NodeCount,
		})
	}

	total, active, count := topologyStats([]byte(config.Nodes))
	return gin.H{
		"current": topologyCurrentDTO{
			Archived:       archived,
			UpdatedAt:      config.UpdatedAt,
			WorkflowTotal:  total,
			WorkflowActive: active,
			NodeCount:      count,
		},
		"versions": summary,
	}, nil
}

// topologyCurrentArchived reports whether the newest archived version matches
// the given live config UpdatedAt (i.e. the live state has been captured).
func topologyCurrentArchived(db *gorm.DB, configUpdatedAt time.Time) (bool, error) {
	var latest model.TopologyVersion
	err := db.Order("created_at DESC, id DESC").First(&latest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load latest topology version: %w", err)
	}
	return latest.ConfigUpdatedAt.Equal(configUpdatedAt), nil
}

// topologyStats derives the summary counters from the stored document. Model
// nodes are never persisted in the document (the frontend derives them from
// the provider config), so every stored node is a workflow node and node_count
// therefore already excludes model nodes.
func topologyStats(nodesJSON []byte) (workflowTotal, workflowActive, nodeCount int) {
	var document TopologyDocument
	if err := json.Unmarshal(nodesJSON, &document); err != nil {
		return 0, 0, 0
	}
	for _, workflow := range document {
		workflowTotal++
		nodeCount += len(workflow)
		if len(workflow) > 0 && workflow[0].Enabled != nil && *workflow[0].Enabled {
			workflowActive++
		}
	}
	return workflowTotal, workflowActive, nodeCount
}

// archiveCurrentTopology snapshots the live topology into a new version when it
// has not been archived yet. force bypasses the 5-minute quiet window (used for
// manual archive and restore); the "already archived" check always applies.
func archiveCurrentTopology(db *gorm.DB, force bool) (*model.TopologyVersion, error) {
	var config model.TopologyConfig
	err := db.Where("id = ?", topologyConfigRowID).First(&config).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load topology config: %w", err)
	}

	archived, err := topologyCurrentArchived(db, config.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if archived {
		return nil, nil
	}
	if !force && time.Since(config.UpdatedAt) < topologyArchiveWindow {
		return nil, nil
	}

	total, active, count := topologyStats([]byte(config.Nodes))
	version := model.TopologyVersion{
		Nodes:           config.Nodes,
		ConfigUpdatedAt: config.UpdatedAt,
		WorkflowTotal:   total,
		WorkflowActive:  active,
		NodeCount:       count,
	}
	if err := db.Create(&version).Error; err != nil {
		return nil, fmt.Errorf("create topology version: %w", err)
	}

	// Enforce the history cap (keep the newest maxTopologyVersions).
	var keep []string
	if err := db.Model(&model.TopologyVersion{}).Order("created_at DESC, id DESC").
		Limit(maxTopologyVersions).Pluck("id", &keep).Error; err != nil {
		return nil, fmt.Errorf("select kept topology versions: %w", err)
	}
	if len(keep) > 0 {
		if err := db.Where("id NOT IN ?", keep).Delete(&model.TopologyVersion{}).Error; err != nil {
			return nil, fmt.Errorf("trim topology versions: %w", err)
		}
	}
	return &version, nil
}

// ── Handlers ──

func TopologyVersionList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		payload, err := topologyVersionList(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}

func TopologyVersionArchive(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := archiveCurrentTopology(db, true); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		payload, err := topologyVersionList(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}

func TopologyVersionGet(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var version model.TopologyVersion
		if err := db.Where("id = ?", id).First(&version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "版本不存在"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"id":              version.ID,
			"created_at":      version.CreatedAt,
			"workflow_total":  version.WorkflowTotal,
			"workflow_active": version.WorkflowActive,
			"node_count":      version.NodeCount,
			"document":        json.RawMessage(version.Nodes),
		}})
	}
}

func TopologyVersionRestore(db *gorm.DB, refresher TopologyRefresher) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var version model.TopologyVersion
		if err := db.Where("id = ?", id).First(&version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "版本不存在"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 恢复前先存档当前版本（若尚未存档）.
		if _, err := archiveCurrentTopology(db, true); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var document TopologyDocument
		if err := json.Unmarshal([]byte(version.Nodes), &document); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("decode stored topology version: %v", err)})
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
		payload, err := topologyVersionList(db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}

// StartTopologyVersionAutoArchive runs the startup compensation check once and
// then periodically archives the live topology once it has been stable for
// topologyArchiveWindow. Returns a stop function for main to defer.
func StartTopologyVersionAutoArchive(db *gorm.DB) func() {
	stop := make(chan struct{})
	go func() {
		// Startup compensation: if the process was down past the quiet window,
		// the last save should be archived before serving new traffic.
		if _, err := archiveCurrentTopology(db, false); err != nil {
			log.Printf("topology auto-archive (startup): %v", err)
		}
		ticker := time.NewTicker(topologyArchiveLoopEvery)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if _, err := archiveCurrentTopology(db, false); err != nil {
					log.Printf("topology auto-archive: %v", err)
				}
			}
		}
	}()
	return func() { close(stop) }
}