package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
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

// ReadLogCaptureMergedResponse returns the merged JSON for the response stage
// of a captured pair. Query params: stage=before|after (default after), and
// index=N for the Nth response node (0-based; default 0). For non-streaming
// JSON bodies the merged value equals the parsed body; for SSE bodies the
// chunks are reconstructed per provider (OpenAI Chat, OpenAI Responses,
// Anthropic). Empty response bodies return null with status 200.
func ReadLogCaptureMergedResponse(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.Param("request_id")
		if rid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing request_id"})
			return
		}
		stageName := c.DefaultQuery("stage", "after")
		var stage string
		switch stageName {
		case "before":
			stage = "response_before"
		case "after":
			stage = "response_after"
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "stage must be 'before' or 'after'"})
			return
		}
		responseIndex := parseInt(c.Query("index"), 0)
		if responseIndex < 0 {
			responseIndex = 0
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
		if responseIndex >= len(pair.Responses) {
			c.JSON(http.StatusNotFound, gin.H{"error": "response index out of range"})
			return
		}
		node := pair.Responses[responseIndex]
		stageRow := node.After
		if stage == "response_before" {
			stageRow = node.Before
		}
		if stageRow == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "stage row not present"})
			return
		}

		rawText, ok := extractRawText(stageRow.Body)
		if !ok {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"value": stageRow.Body, "content_type": "", "merged": false}})
			return
		}
		contentType := extractContentType(stageRow.Headers)
		merged, err := service.MergeLLMBody(rawText, contentType)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"value":        merged,
			"content_type": contentType,
			"raw":          rawText,
			"merged":       true,
		}})
	}
}

// extractRawText pulls the raw text out of a stored body. The capture writer
// wraps non-JSON string bodies as JSONMap{"raw": "<text>"}; bodies that are
// already a map (i.e. parsed JSON) have no "raw" entry.
func extractRawText(body model.JSONMap) (string, bool) {
	if body == nil {
		return "", false
	}
	v, ok := body["raw"]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

// extractContentType looks up Content-Type case-insensitively in the stored
// headers map and returns its value.
func extractContentType(headers model.JSONMap) string {
	if headers == nil {
		return ""
	}
	for k, v := range headers {
		if strings.EqualFold(k, "Content-Type") {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
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