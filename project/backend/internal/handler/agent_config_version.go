package handler

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// maxAgentConfigVersions caps how many snapshots are kept per config file; the
// oldest entries are trimmed once the cap is exceeded.
const maxAgentConfigVersions = 50

// agentConfigVersionDTO is one archived history entry.
type agentConfigVersionDTO struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Lines     int       `json:"lines"`
	Size      int       `json:"size"`
}

// agentConfigCurrentVersionDTO describes the live (current) file content and
// whether it has already been captured as a snapshot. UpdatedAt is set only
// when archived and points at that snapshot's time.
type agentConfigCurrentVersionDTO struct {
	Archived  bool       `json:"archived"`
	Lines     int        `json:"lines"`
	Size      int        `json:"size"`
	UpdatedAt *time.Time `json:"updated_at"`
}

func countAgentConfigLines(content string) int {
	if content == "" {
		return 0
	}
	lines := strings.Count(content, "\n")
	if !strings.HasSuffix(content, "\n") {
		lines++
	}
	return lines
}

// archiveAgentConfigVersion appends content as a new snapshot unless it is
// already the newest snapshot, then trims the history to the cap.
func archiveAgentConfigVersion(db *gorm.DB, configID, content string) (*model.AgentConfigVersion, error) {
	var latest model.AgentConfigVersion
	err := db.Where("config_id = ?", configID).Order("created_at DESC, id DESC").First(&latest).Error
	if err == nil && latest.Content == content {
		return nil, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("load latest agent config version: %w", err)
	}

	version := model.AgentConfigVersion{ConfigID: configID, Content: content}
	if err := db.Create(&version).Error; err != nil {
		return nil, fmt.Errorf("create agent config version: %w", err)
	}

	// Trim history to the newest maxAgentConfigVersions for this config.
	var keep []string
	if err := db.Model(&model.AgentConfigVersion{}).Where("config_id = ?", configID).
		Order("created_at DESC, id DESC").Limit(maxAgentConfigVersions).Pluck("id", &keep).Error; err != nil {
		return nil, fmt.Errorf("select kept agent config versions: %w", err)
	}
	if len(keep) > 0 {
		if err := db.Where("config_id = ? AND id NOT IN ?", configID, keep).Delete(&model.AgentConfigVersion{}).Error; err != nil {
			return nil, fmt.Errorf("trim agent config versions: %w", err)
		}
	}
	return &version, nil
}

// archiveCurrentAgentConfig snapshots the live file as a version. It is a
// no-op when the live content already matches the newest snapshot.
func archiveCurrentAgentConfig(db *gorm.DB, row *model.AgentConfigFile, key []byte) (*model.AgentConfigVersion, error) {
	content, err := readAgentConfigFileContent(row, key)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}
	return archiveAgentConfigVersion(db, row.ID, content)
}

// recordAgentConfigVersion is the best-effort hook called after a live-file
// write to snapshot the freshly written content. A history failure must never
// fail the write that already succeeded, so the error is only logged.
func recordAgentConfigVersion(db *gorm.DB, configID, content string) {
	if _, err := archiveAgentConfigVersion(db, configID, content); err != nil {
		log.Printf("agent config history: %v", err)
	}
}

// agentConfigVersionList returns the view the dialog renders: the current live
// file (derived, not stored) plus the archived history (newest first). When the
// current content has been archived, that newest duplicate is skipped because
// the UI shows it as the current row.
func agentConfigVersionList(db *gorm.DB, row *model.AgentConfigFile, key []byte) (gin.H, error) {
	var versions []model.AgentConfigVersion
	if err := db.Where("config_id = ?", row.ID).Order("created_at DESC, id DESC").Find(&versions).Error; err != nil {
		return nil, fmt.Errorf("list agent config versions: %w", err)
	}

	content, readErr := readAgentConfigFileContent(row, key)
	archived := readErr == nil && len(versions) > 0 && versions[0].Content == content

	var current *agentConfigCurrentVersionDTO
	if readErr == nil {
		current = &agentConfigCurrentVersionDTO{
			Archived: archived,
			Lines:    countAgentConfigLines(content),
			Size:     len(content),
		}
		if archived {
			current.UpdatedAt = &versions[0].CreatedAt
		}
	}

	summary := make([]agentConfigVersionDTO, 0, len(versions))
	for i, v := range versions {
		if archived && i == 0 {
			continue
		}
		summary = append(summary, agentConfigVersionDTO{
			ID:        v.ID,
			CreatedAt: v.CreatedAt,
			Lines:     countAgentConfigLines(v.Content),
			Size:      len(v.Content),
		})
	}

	return gin.H{"current": current, "versions": summary}, nil
}

// ListAgentConfigVersions returns the current state plus the snapshot history
// for one config file.
func ListAgentConfigVersions(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		payload, err := agentConfigVersionList(db, &row, key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}

// ArchiveAgentConfigVersion snapshots the live file on demand (used by the
// "存档" button when the current state has not been captured yet).
func ArchiveAgentConfigVersion(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		if _, err := archiveCurrentAgentConfig(db, &row, key); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "ARCHIVE_FAILED", "存档失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		payload, err := agentConfigVersionList(db, &row, key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}

// RestoreAgentConfigVersion archives the current file first, then writes the
// selected snapshot back to the live file. The restored content becomes the
// live "current" state (no new snapshot is recorded for it).
func RestoreAgentConfigVersion(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var version model.AgentConfigVersion
		if err := db.Where("id = ? AND config_id = ?", c.Param("vid"), row.ID).First(&version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondError(c, http.StatusNotFound, "AGENT_CONFIG_VERSION_NOT_FOUND", "历史版本不存在")
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// 恢复前先存档当前版本（若尚未存档），避免当前状态丢失.
		if _, err := archiveCurrentAgentConfig(db, &row, key); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := writeAgentConfigFileContent(&row, version.Content, key); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "SAVE_FAILED", "恢复失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", version.Content).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		payload, err := agentConfigVersionList(db, &row, key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": payload})
	}
}
