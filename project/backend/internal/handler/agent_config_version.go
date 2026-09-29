package handler

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// maxAgentConfigVersions caps how many snapshots are kept per config file; the
// oldest entries are trimmed once the cap is exceeded.
const maxAgentConfigVersions = 50

// agentConfigVersionRef points at the version a snapshot was restored from.
type agentConfigVersionRef struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

// agentConfigVersionDTO is one history entry. The newest entry is marked
// current; RestoredFrom is set when a restore produced this entry.
type agentConfigVersionDTO struct {
	ID           string                 `json:"id"`
	CreatedAt    time.Time              `json:"created_at"`
	Current      bool                   `json:"current"`
	RestoredFrom *agentConfigVersionRef `json:"restored_from"`
}

// archiveAgentConfigVersion stores content as a new snapshot of a config file.
// Ordinary saves whose content equals the newest snapshot are a no-op (force
// false) so repeated saves don't crowd out the history; restores pass force
// true so the operation always shows up on the timeline.
func archiveAgentConfigVersion(db *gorm.DB, configID, content, sourceVersionID string, force bool) (*model.AgentConfigVersion, error) {
	if !force {
		var latest model.AgentConfigVersion
		err := db.Where("config_id = ?", configID).Order("created_at DESC, id DESC").First(&latest).Error
		if err == nil && latest.Content == content {
			return nil, nil
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("load latest agent config version: %w", err)
		}
	}
	version := model.AgentConfigVersion{ConfigID: configID, Content: content, SourceVersionID: sourceVersionID}
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

// recordAgentConfigVersion is the best-effort hook called after a live-file
// write. A history failure must never fail the write that already succeeded,
// so the error is only logged.
func recordAgentConfigVersion(db *gorm.DB, configID, content string) {
	if _, err := archiveAgentConfigVersion(db, configID, content, "", false); err != nil {
		log.Printf("agent config history: %v", err)
	}
}

// agentConfigVersionList returns a config's history, newest first, with each
// restore's source resolved to its timestamp.
func agentConfigVersionList(db *gorm.DB, configID string) ([]agentConfigVersionDTO, error) {
	var versions []model.AgentConfigVersion
	if err := db.Where("config_id = ?", configID).Order("created_at DESC, id DESC").Find(&versions).Error; err != nil {
		return nil, fmt.Errorf("list agent config versions: %w", err)
	}
	createdByID := make(map[string]time.Time, len(versions))
	for _, v := range versions {
		createdByID[v.ID] = v.CreatedAt
	}
	out := make([]agentConfigVersionDTO, 0, len(versions))
	for i, v := range versions {
		dto := agentConfigVersionDTO{ID: v.ID, CreatedAt: v.CreatedAt, Current: i == 0}
		if v.SourceVersionID != "" {
			dto.RestoredFrom = &agentConfigVersionRef{ID: v.SourceVersionID, CreatedAt: createdByID[v.SourceVersionID]}
		}
		out = append(out, dto)
	}
	return out, nil
}

// ListAgentConfigVersions returns the snapshot history for one config file. On
// the first call for a config that has no history yet, the live file is
// captured as the baseline entry so configs taken over before this feature
// existed get a starting point.
func ListAgentConfigVersions(db *gorm.DB, key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		var row model.AgentConfigFile
		if err := db.First(&row, "id = ?", c.Param("id")).Error; err != nil {
			respondError(c, http.StatusNotFound, "CONFIG_NOT_FOUND", "配置不存在")
			return
		}
		var count int64
		if err := db.Model(&model.AgentConfigVersion{}).Where("config_id = ?", row.ID).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count == 0 {
			// Best effort: if the live file cannot be read the history simply
			// starts empty instead of failing the request.
			if content, err := readAgentConfigFileContent(&row, key); err == nil {
				if _, err := archiveAgentConfigVersion(db, row.ID, content, "", false); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}
		versions, err := agentConfigVersionList(db, row.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"versions": versions}})
	}
}

// RestoreAgentConfigVersion writes an archived snapshot back to the live file
// and records it as a new version annotated with the restored-from id, so the
// timeline keeps every state and the restore itself is auditable.
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
		if err := writeAgentConfigFileContent(&row, version.Content, key); err != nil {
			respondErrorWithParams(c, http.StatusBadRequest, "SAVE_FAILED", "恢复失败: "+err.Error(), gin.H{"error": err.Error()})
			return
		}
		if err := db.Model(&row).Update("content", version.Content).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := archiveAgentConfigVersion(db, row.ID, version.Content, version.ID, true); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		versions, err := agentConfigVersionList(db, row.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"versions": versions}})
	}
}
