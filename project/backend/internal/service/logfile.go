package service

import (
	"encoding/json"
	"log"
	"net/url"
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

// ResetLogWritersForTest tears down the global log writer and log capture
// writer so a subsequent Init call can bind them to a fresh test database.
// Without this, go test -count=N reruns a test under the same process and
// sync.Once keeps the writer pointed at the first run's discarded DB, so
// rows silently land in a database no assertion can read.
func ResetLogWritersForTest() {
	if globalLogWriter != nil {
		globalLogWriter.Stop()
	}
	globalLogWriter = nil
	globalLogCaptureWriter = nil
	logWriterOnce = sync.Once{}
	logCaptureWriterOnce = sync.Once{}
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
		RequestID:    data.RequestID,
		Type:         data.Type,
		Prefix:       data.Prefix,
		Source:       data.Source,
		ProviderID:   data.ProviderID,
		ProviderName: data.ProviderName,
		ModelName:    data.ModelName,
		TokenName:    data.TokenName,
		Stage:        data.Stage,
		Error:        data.Error,
		RuleNotes:    RuleNotesJSON(data.RuleNotes),
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
			body := captureBodyMap(cap.Body)
			// The bytes go to disk next to any uploaded file slices; only the
			// key lands in the row. File slices only belong to the request
			// stages — a response never carries the upload.
			if strings.HasPrefix(data.Stage, "request") {
				storeCapturedFiles(data.RequestID, body, data.Files)
			}
			if store := Captures(); store != nil {
				encoded, err := json.Marshal(body)
				if err == nil {
					if key, err := store.Put(data.RequestID, data.Stage, encoded); err == nil {
						row.BodyKey = key
						row.BodySize = int64(len(encoded))
					} else {
						row.RequestBody = model.JSONMap(body)
					}
				} else {
					row.RequestBody = model.JSONMap(body)
				}
			} else {
				row.RequestBody = model.JSONMap(body)
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

// UpdateRuleNotes backfills the rule notes on the response-stage rows of a
// request. Streaming responses only finish rewriting after the capture rows
// were written, so the handler calls this once the stream ends.
func (w *LogCaptureWriter) UpdateRuleNotes(requestID string, notes []RuleNote) {
	if w == nil || requestID == "" || len(notes) == 0 {
		return
	}
	if err := w.db.Model(&model.LogCapture{}).
		Where("request_id = ? AND stage IN ?", requestID, []string{"response_before", "response_after"}).
		Update("rule_notes", RuleNotesJSON(notes)).Error; err != nil {
		println("logcapture: update rule notes failed:", err.Error())
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
	encoded, err := json.Marshal(wrapped)
	if err != nil {
		return
	}
	var rows []model.LogCapture
	if err := w.db.Select("id", "body_key").
		Where("request_id = ? AND stage IN ?", requestID, []string{"response_before", "response_after"}).
		Find(&rows).Error; err != nil {
		println("logcapture: load stream body rows failed:", err.Error())
		return
	}
	store := Captures()
	for _, row := range rows {
		if store != nil && row.BodyKey != "" {
			if err := store.PutAt(row.BodyKey, encoded); err != nil {
				println("logcapture: update stream body file failed:", err.Error())
			}
			continue
		}
		if err := w.db.Model(&model.LogCapture{}).
			Where("id = ?", row.ID).
			Update("request_body", wrapped).Error; err != nil {
			println("logcapture: update stream body failed:", err.Error())
		}
	}
}

// LogCaptureData is the payload for a single capture event.
type LogCaptureData struct {
	RequestID    string
	Stage        string // request_before | request_after | response_before | response_after
	Type         string // request | response | system
	ProviderID   string
	ProviderName string
	ModelName    string
	TokenName    string
	Prefix       string
	Source       string
	Request      *HTTPCapture
	Response     *HTTPCapture
	SystemLog    []string
	Error        string
	// RuleNotes carries this stage's per-rule outcomes (request rewrite on
	// the request nodes, response rewrite + failover on the response nodes);
	// stored as JSON on the row and rendered for display by the pair API.
	RuleNotes []RuleNote
	// Files carries the request's multipart file slices so the captured body
	// can show them as previewable chips instead of dropping them.
	Files []CapturedFile
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

// ReadFile returns the full LogCapture row for a given ID, with its body
// loaded from disk when the row only carries a key.
func (w *LogCaptureWriter) ReadFile(id string) (*model.LogCapture, error) {
	if w == nil {
		return nil, nil
	}
	var row model.LogCapture
	if err := w.db.First(&row, "id = ?", id).Error; err != nil {
		return nil, err
	}
	hydrateCapturedBody(&row)
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

	// Capture the affected requests before the rows disappear: their bodies
	// and file slices live in directories keyed by request id.
	var requestIDs []string
	if err := query.Session(&gorm.Session{}).Distinct().Pluck("request_id", &requestIDs).Error; err != nil {
		requestIDs = nil
	}

	result := query.Delete(&model.LogCapture{})
	if result.Error != nil {
		return 0, result.Error
	}
	if params.All {
		if store := Captures(); store != nil {
			store.DeleteAll()
		}
	} else if len(requestIDs) > 0 {
		if store := Captures(); store != nil {
			store.DeleteRequests(requestIDs)
		}
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

// ResolveSourceMark returns the request-carried source mark, falling back to
// path extraction when the caller bypassed the `/proxy/__<source>` prefix
// handling.
func ResolveSourceMark(mark, path string) string {
	if mark != "" {
		return mark
	}
	return ExtractSourceFromPath(path)
}

// We keep the old types for backward compatibility with the relay engine until
// its next refactor, but they are no longer used for file I/O.
// LogCaptureData is defined above; HTTPCapture is defined above.
// captureFileMarker mirrors relay.FileMarker: the view key that marks a value
// as a file slice instead of a text field. It is duplicated here because the
// service package must not import the relay package (relay imports service).
const captureFileMarker = "$file"

// captureBodyMap normalizes a captured body into the map the log view renders.
// Bodies that are not objects (a plain error string, a raw SSE stream) keep
// the historical {"raw": ...} shape.
func captureBodyMap(body interface{}) map[string]interface{} {
	switch value := body.(type) {
	case map[string]interface{}:
		return value
	case string:
		return map[string]interface{}{"raw": value}
	case []byte:
		return map[string]interface{}{"raw": string(value)}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return map[string]interface{}{"raw": ""}
	}
	return map[string]interface{}{"raw": string(encoded)}
}

// storeCapturedFiles writes a request's file slices to disk and links them
// from the captured body, so the dashboard can render each one as a chip with
// a preview/download URL.
func storeCapturedFiles(requestID string, body interface{}, files []CapturedFile) {
	if len(files) == 0 || requestID == "" {
		return
	}
	store := Captures()
	if store == nil {
		return
	}
	keys := make(map[int]string, len(files))
	for _, file := range files {
		key, err := store.PutFile(requestID, file)
		if err != nil {
			continue
		}
		keys[file.Index] = key
	}
	if len(keys) == 0 {
		return
	}
	linkCapturedFiles(body, keys)
}

// linkCapturedFiles walks the decoded body and annotates every file marker
// with the key it was stored under and the URL that serves it.
func linkCapturedFiles(value interface{}, keys map[int]string) {
	switch v := value.(type) {
	case map[string]interface{}:
		if rawIndex, ok := v[captureFileMarker]; ok {
			if index, ok := captureFileIndex(rawIndex); ok {
				if key, ok := keys[index]; ok {
					v["key"] = key
					v["url"] = "/v1/dashboard/logs/capture-file?key=" + url.QueryEscape(key)
				}
			}
		}
		for _, child := range v {
			linkCapturedFiles(child, keys)
		}
	case []interface{}:
		for _, child := range v {
			linkCapturedFiles(child, keys)
		}
	}
}

// captureFileIndex reads the file slice index from its marker value.
func captureFileIndex(value interface{}) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case json.Number:
		parsed, err := v.Int64()
		return int(parsed), err == nil
	}
	return 0, false
}

// hydrateCapturedBody loads a row's body from disk into RequestBody so the API
// keeps returning one shape whether the row predates disk-backed capture or
// not.
func hydrateCapturedBody(row *model.LogCapture) {
	if row == nil || row.BodyKey == "" || len(row.RequestBody) > 0 {
		return
	}
	store := Captures()
	if store == nil {
		return
	}
	raw, err := store.Get(row.BodyKey)
	if err != nil {
		return
	}
	body := model.JSONMap{}
	if err := json.Unmarshal(raw, &body); err != nil {
		return
	}
	row.RequestBody = body
}
