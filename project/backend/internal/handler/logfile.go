package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ensureLogCaptureWriter returns the initialized log capture writer.
func ensureLogCaptureWriter(db *gorm.DB) *service.LogCaptureWriter {
	writer := service.LogCapture()
	if writer != nil {
		return writer
	}
	service.InitLogCaptureWriter(db)
	return service.LogCapture()
}

// ListLogFiles lists captured log entries, newest first.
// Query params: prefix, type (comma-separated), from, to (RFC3339),
// headerKey, headerValue, limit, offset.
func ListLogFiles(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		params := service.LogListParams{
			Prefix:      c.Query("prefix"),
			HeaderKey:   c.Query("headerKey"),
			HeaderValue: c.Query("headerValue"),
			Limit:       parseInt(c.Query("limit"), 50),
			Offset:      parseInt(c.Query("offset"), 0),
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

		writer := ensureLogCaptureWriter(db)
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

// ListLogCapturePairs lists pair summaries, newest-first by MIN(created_at).
// Query params: prefix, type (comma-separated — "包含" semantics, system is
// ignored by the service), from, to (RFC3339), headerKey, headerValue, limit, offset.
// Returns {data: []LogCapturePairSummary, total: int}.
func ListLogCapturePairs(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		params := service.LogListParams{
			Prefix:        c.Query("prefix"),
			HeaderKey:     c.Query("headerKey"),
			HeaderValue:   c.Query("headerValue"),
			Limit:         parseInt(c.Query("limit"), 50),
			Offset:        parseInt(c.Query("offset"), 0),
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

		writer := ensureLogCaptureWriter(db)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		pairs, total, err := writer.ListPairs(params)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": pairs, "total": total})
	}
}

// ReadLogCapturePair returns the full pair (with bodies) for :request_id.
// 404 if no rows exist for the request_id.
func ReadLogCapturePair(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.Param("request_id")
		if rid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing request_id"})
			return
		}
		writer := ensureLogCaptureWriter(db)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		pair, err := writer.ReadPair(rid)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": pair})
	}
}

// ReadLogFile returns the JSON content of a single captured log entry.
func ReadLogFile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		writer := ensureLogCaptureWriter(db)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		row, err := writer.ReadFile(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": row})
	}
}

// ClearLogFiles deletes captured log entries. Body (optional):
// {scope: "filtered"|"all", prefix?, type?, from?, to?}. filtered mode removes
// entries matching the filters; all mode removes every entry. Responds {deleted}.
func ClearLogFiles(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Scope  string `json:"scope"`
			Prefix string `json:"prefix"`
			Type   string `json:"type"`
			From   string `json:"from"`
			To     string `json:"to"`
		}
		_ = c.ShouldBindJSON(&body)
		writer := ensureLogCaptureWriter(db)
		if writer == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "log capture not initialized"})
			return
		}
		params := service.LogDeleteParams{All: body.Scope != "filtered"}
		if !params.All {
			params.Prefix = body.Prefix
			params.Types = splitComma(body.Type)
			if t, err := time.Parse(time.RFC3339, body.From); err == nil {
				params.From = t
			}
			if t, err := time.Parse(time.RFC3339, body.To); err == nil {
				params.To = t
			}
		}
		deleted, err := writer.DeleteFiles(params)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": deleted})
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