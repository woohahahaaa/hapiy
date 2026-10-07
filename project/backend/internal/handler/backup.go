package handler

import (
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/relay"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// ListBackups returns the backup history, newest first, plus the absolute
// directory the configured relative path currently resolves to.
func ListBackups(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := parseInt(c.Query("limit"), 50)
		offset := parseInt(c.Query("offset"), 0)
		records, total, err := service.ListBackupRecords(db, limit, offset)
		if err != nil {
			respondError(c, http.StatusInternalServerError, "BACKUP_LIST_FAILED", err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"data":          records,
			"total":         total,
			"resolved_path": service.ResolveBackupDir(service.ReadBackupPath(db)),
			"base_dir":      service.BackupBaseDir(),
		})
	}
}

// CreateBackup runs a manual backup. The body is optional: modules/path given
// here apply to this run only; without a body the saved settings are used.
func CreateBackup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Modules []string `json:"modules"`
			Path    string   `json:"path"`
		}
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		result, err := service.RunBackup(db, service.BackupOptions{
			Modules: req.Modules,
			Path:    req.Path,
			Source:  "manual",
		})
		if err != nil {
			respondError(c, http.StatusInternalServerError, "BACKUP_CREATE_FAILED", err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result.Record, "file_created": result.FileCreated})
	}
}

// RestoreBackup replaces the modules stored in a record's file back into the
// live database, after writing a pre-restore safety copy.
func RestoreBackup(db *gorm.DB, engine *relay.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		result, err := service.RestoreBackup(db, c.Param("id"))
		if err != nil {
			respondError(c, http.StatusInternalServerError, "BACKUP_RESTORE_FAILED", err.Error())
			return
		}
		if engine != nil {
			if err := engine.LoadProviders(); err != nil {
				log.Printf("backup restore: reload providers: %v", err)
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"modules":       result.Modules,
			"safety_backup": result.SafetyBackup,
		}})
	}
}

// DeleteBackup removes a history entry and its file when present.
func DeleteBackup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := service.DeleteBackupRecord(db, c.Param("id")); err != nil {
			respondError(c, http.StatusInternalServerError, "BACKUP_DELETE_FAILED", err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": true})
	}
}

// DownloadBackup streams a backup file as an attachment.
func DownloadBackup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		path, err := service.BackupFilePath(db, c.Param("id"))
		if err != nil {
			respondError(c, http.StatusNotFound, "BACKUP_FILE_NOT_FOUND", err.Error())
			return
		}
		c.FileAttachment(path, filepath.Base(path))
	}
}

// ResolveBackupPath previews where a relative backup path lands on the machine
// running the backend.
func ResolveBackupPath() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"absolute_path": service.ResolveBackupDir(c.Query("path")),
		}})
	}
}
