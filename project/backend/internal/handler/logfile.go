package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ensureLogFileWriter returns the initialized log file writer, falling back to
// (re)initializing with logDir when it has not been set up (e.g. a handler
// test that mounts the route without running main).
func ensureLogFileWriter(db *gorm.DB, logDir string) *service.LogFileWriter {
	writer := service.LogFile()
	if writer != nil {
		return writer
	}
	service.InitLogFileWriter(logDir, db)
	return service.LogFile()
}

// ListLogFiles lists captured request log files on disk, newest first.
// Query params: prefix, type (comma-separated), from, to (RFC3339), limit, offset.
func ListLogFiles(db *gorm.DB, logDir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		params := service.LogListParams{
			Prefix: c.Query("prefix"),
			Limit:  parseInt(c.Query("limit"), 50),
			Offset: parseInt(c.Query("offset"), 0),
		}
		if types := c.Query("type"); types != "" {
			params.Types = splitComma(types)
		}
		if from := c.Query("from"); from != "" {
			if t, err := time.Parse(time.RFC3339, from); err == nil {
				params.From = t
			}
		}
		if to := c.Query("to"); to != "" {
			if t, err := time.Parse(time.RFC3339, to); err == nil {
				params.To = t
			}
		}

		writer := ensureLogFileWriter(db, logDir)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		entries, total, err := writer.ListFiles(params)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": entries, "total": total})
	}
}

// ReadLogFile returns the JSON content of a single captured log file.
func ReadLogFile(db *gorm.DB, logDir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		writer := ensureLogFileWriter(db, logDir)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		content, err := writer.ReadFile(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.Data(http.StatusOK, "application/json", content)
	}
}

// splitComma splits a comma-separated query value, trimming and dropping empties.
func splitComma(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
