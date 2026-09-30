package service

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// LogCaptureWriter writes per-request capture data to the log_captures table.
// Each capture event produces one row. Unlike the old disk-backed writer, the
// DB table supports indexed queries including header-based filtering.
type LogCaptureWriter struct {
	db *gorm.DB
}

var globalLogCaptureWriter *LogCaptureWriter
var logCaptureWriterOnce sync.Once

// InitLogCaptureWriter initializes the global log capture writer.
func InitLogCaptureWriter(db *gorm.DB) {
	logCaptureWriterOnce.Do(func() {
		globalLogCaptureWriter = &LogCaptureWriter{db: db}
	})
}

// LogCapture returns the global log capture writer. Must call InitLogCaptureWriter first.
func LogCapture() *LogCaptureWriter {
	return globalLogCaptureWriter
}

// WriteLog inserts a single capture row into the database.
// The data.Request field populates request_before/after; data.Response
// populates response_before/after.
func (w *LogCaptureWriter) WriteLog(data *LogCaptureData) {
	if w == nil || data == nil || data.RequestID == "" {
		return
	}

	row := model.LogCapture{
		RequestID:  data.RequestID,
		Type:       data.Type,
		Prefix:     data.Prefix,
		Source:     data.Source,
		ProviderID: data.ProviderID,
		ProviderName: data.ProviderName,
		ModelName:  data.ModelName,
		TokenName:  data.TokenName,
		Stage:      data.Stage,
		Error:      data.Error,
		// Always keep stage timings, even when body recording is off.
		ConnectMs:         data.ConnectMs,
		FirstByteMs:       data.FirstByteMs,
		RequestRewriteMs:  data.RequestRewriteMs,
		ResponseRewriteMs: data.ResponseRewriteMs,
		StreamRewriteMs:   data.StreamRewriteMs,
		QueueWaitMs:       data.QueueWaitMs,
	}

	// Populate headers and body from whichever capture is relevant
	var cap *HTTPCapture
	switch data.Stage {
	case "request_before", "request_after":
		cap = data.Request
	case "response_before", "response_after":
		cap = data.Response
	}
	if cap != nil {
		if cap.Headers != nil {
			m := make(model.JSONMap, len(cap.Headers))
			for k, v := range cap.Headers {
				m[k] = v
			}
			row.Headers = m
		}
		if cap.Body != nil {
			switch body := cap.Body.(type) {
			case map[string]interface{}:
				row.RequestBody = model.JSONMap(body)
			case string:
				row.RequestBody = model.JSONMap{"raw": body}
			case []byte:
				row.RequestBody = model.JSONMap{"raw": string(body)}
			default:
				b, _ := json.Marshal(cap.Body)
				row.RequestBody = model.JSONMap{"raw": string(b)}
			}
		}
	}

	if data.SystemLog != nil {
		sl := make(model.JSONSlice, len(data.SystemLog))
		for i, s := range data.SystemLog {
			sl[i] = s
		}
		row.SystemLog = sl
	}

	if err := w.db.Create(&row).Error; err != nil {
		println("logcapture: insert failed:", err.Error())
	}
}

// UpdateStreamTimings backfills first-byte and stream-rewrite timings on the
// captured rows of a request. Those two values are only known after the
// streaming body has been fully forwarded, so the handler calls this once
// the stream ends. Values < 0 are ignored (stage does not apply).
func (w *LogCaptureWriter) UpdateStreamTimings(requestID string, firstByteMs, streamRewriteMs int) {
	if w == nil || requestID == "" {
		return
	}
	updates := map[string]interface{}{}
	if firstByteMs >= 0 {
		updates["first_byte_ms"] = firstByteMs
	}
	if streamRewriteMs >= 0 {
		updates["stream_rewrite_ms"] = streamRewriteMs
	}
	if len(updates) == 0 {
		return
	}
	if err := w.db.Model(&model.LogCapture{}).
		Where("request_id = ?", requestID).
		Updates(updates).Error; err != nil {
		println("logcapture: update stream timings failed:", err.Error())
	}
}

// UpdateStreamBody replaces the response_before/response_after rows' bodies
// for every log output node of a request with the bytes the relay handler
// captured while forwarding the SSE stream. Both stages are backfilled with
// the same final bytes so the pair assembler does not report a false
// "modified" diff between a placeholder before-row and the real after-row.
// A no-op when the request has no streaming capture row (e.g. non-streaming
// request, or no log output configured). Headers, status, and timings are
// preserved.
func (w *LogCaptureWriter) UpdateStreamBody(requestID string, body []byte) {
	if w == nil || requestID == "" || body == nil {
		return
	}
	wrapped := model.JSONMap{"raw": string(body)}
	if err := w.db.Model(&model.LogCapture{}).
		Where("request_id = ? AND stage IN ?", requestID, []string{"response_before", "response_after"}).
		Update("request_body", wrapped).Error; err != nil {
		println("logcapture: update stream body failed:", err.Error())
	}
}

// LogCaptureData is the payload for a single capture event.
type LogCaptureData struct {
	RequestID  string
	Stage      string // request_before | request_after | response_before | response_after
	Type       string // request | response | system
	ProviderID string
	ProviderName string
	ModelName  string
	TokenName  string
	Prefix     string
	Source     string
	Request    *HTTPCapture
	Response   *HTTPCapture
	SystemLog  []string
	Error      string
	// Stage timings (nil = not applicable / not yet known).
	ConnectMs         *int
	FirstByteMs       *int
	RequestRewriteMs  *int
	ResponseRewriteMs *int
	StreamRewriteMs   *int
	QueueWaitMs       *int
}

// HTTPCapture is a single captured HTTP message (headers + body).
type HTTPCapture struct {
	Headers map[string]string
	Body    interface{}
}

// LogListParams filters the captured log entries during listing.
type LogListParams struct {
	Prefix       string
	Types        []string
	From         time.Time
	To           time.Time
	HeaderKey    string
	HeaderValue  string
	TokenName    string
	ProviderName string
	ModelName    string
	Source       string
	Limit        int
	Offset       int
}

// LogFileEntry is one captured log entry surfaced to the dashboard.
type LogFileEntry struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Prefix    string    `json:"prefix"`
	Source    string    `json:"source"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

// ListFiles queries the log_captures table with the given filters.
func (w *LogCaptureWriter) ListFiles(params LogListParams) ([]LogFileEntry, int, error) {
	if w == nil {
		return nil, 0, nil
	}

	query := w.db.Model(&model.LogCapture{})

	if params.Prefix != "" {
		query = query.Where("prefix = ?", params.Prefix)
	}
	if len(params.Types) > 0 {
		query = query.Where("type IN ?", params.Types)
	}
	if !params.From.IsZero() {
		query = query.Where("created_at >= ?", params.From)
	}
	if !params.To.IsZero() {
		query = query.Where("created_at <= ?", params.To)
	}
	if params.HeaderKey != "" && params.HeaderValue != "" {
		// Filter by a header key+value pair stored in the JSON headers column.
		// SQLite JSON path: headers->>'$.key' = value
		query = query.Where("json_extract(headers, ?) = ?",
			"$."+params.HeaderKey, params.HeaderValue)
	}
	if params.TokenName != "" {
		query = query.Where("token_name = ?", params.TokenName)
	}
	if params.ProviderName != "" {
		query = query.Where("provider_name = ?", params.ProviderName)
	}
	if params.ModelName != "" {
		query = query.Where("model_name = ?", params.ModelName)
	}
	if params.Source != "" {
		query = ApplySourceFilter(query, params.Source)
	}

	var total int64
	query.Count(&total)

	var rows []model.LogCapture
	if err := query.Order("created_at DESC").Limit(params.Limit).Offset(params.Offset).Find(&rows).Error; err != nil {
		return nil, 0, err
	}

	entries := make([]LogFileEntry, 0, len(rows))
	for _, r := range rows {
		entries = append(entries, LogFileEntry{
			ID:        r.ID,
			Name:      r.ID,
			Prefix:    r.Prefix,
			Source:    r.Source,
			Type:      r.Type,
			CreatedAt: r.CreatedAt,
		})
	}

	return entries, int(total), nil
}

// ReadFile returns the full LogCapture row for a given ID.
func (w *LogCaptureWriter) ReadFile(id string) (*model.LogCapture, error) {
	if w == nil {
		return nil, nil
	}
	var row model.LogCapture
	if err := w.db.First(&row, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// LogDeleteParams controls which captured entries DeleteFiles removes.
type LogDeleteParams struct {
	Prefix string
	Types  []string
	From   time.Time
	To     time.Time
	Source string
	All    bool
}

// ApplySourceFilter narrows a query by the dashboard source filter. An empty
// source means "no filter"; LogSourceUnmarked matches rows without a source
// mark; anything else matches that exact source.
func ApplySourceFilter(query *gorm.DB, source string) *gorm.DB {
	if source == LogSourceUnmarked {
		return query.Where("(source IS NULL OR source = '')")
	}
	return query.Where("source = ?", source)
}

// DeleteFiles removes captured entries matching the params and returns the
// count of deleted rows.
func (w *LogCaptureWriter) DeleteFiles(params LogDeleteParams) (int, error) {
	if w == nil {
		return 0, nil
	}

	query := w.db.Model(&model.LogCapture{})
	if params.All {
		query = query.Where("1 = 1")
	} else {
		if params.Prefix != "" {
			query = query.Where("prefix = ?", params.Prefix)
		}
		if len(params.Types) > 0 {
			query = query.Where("type IN ?", params.Types)
		}
		if params.Source != "" {
			query = ApplySourceFilter(query, params.Source)
		}
		if !params.From.IsZero() {
			query = query.Where("created_at >= ?", params.From)
		}
		if !params.To.IsZero() {
			query = query.Where("created_at <= ?", params.To)
		}
	}

	result := query.Delete(&model.LogCapture{})
	if result.Error != nil {
		return 0, result.Error
	}
	// Reclaim the pages the delete just freed so the file does not stay at its
	// historical high-water mark. Best effort: a failure here must not hide
	// the successful delete.
	if result.RowsAffected > 0 {
		if err := model.ShrinkDatabase(w.db); err != nil {
			log.Printf("Warning: shrink database after log capture delete: %v", err)
		}
	}
	return int(result.RowsAffected), nil
}

// ExtractSourceFromPath returns the source mark from a relay request path.
func ExtractSourceFromPath(path string) string {
	idx := strings.Index(path, "/__")
	if idx < 0 {
		return ""
	}
	seg := path[idx+1:]
	if end := strings.IndexByte(seg, '/'); end >= 0 {
		seg = seg[:end]
	}
	return seg
}

// ResolveSourceMark returns the header-carried source mark, falling back to path extraction.
func ResolveSourceMark(header, path string) string {
	if header != "" {
		return header
	}
	return ExtractSourceFromPath(path)
}

// We keep the old types for backward compatibility with the relay engine until
// its next refactor, but they are no longer used for file I/O.
// LogCaptureData is defined above; HTTPCapture is defined above.