package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

// LogFileWriter writes per-request JSON log files to disk. Unlike the batched
// LogWriter (database), each request produces one self-contained JSON file so
// it can be inspected and retrieved independently of the usage log table.
type LogFileWriter struct {
	dir string
}

var globalLogFileWriter *LogFileWriter
var logFileWriterOnce sync.Once

// InitLogFileWriter initializes the global log file writer and creates the
// base output directory if missing. The db argument is retained for signature
// symmetry with InitLogWriter; file capture is disk-backed, not DB-backed.
func InitLogFileWriter(dir string, db *gorm.DB) {
	logFileWriterOnce.Do(func() {
		if dir == "" {
			dir = "./logs"
		}
		_ = os.MkdirAll(dir, 0o755)
		globalLogFileWriter = &LogFileWriter{dir: dir}
	})
}

// LogFile returns the global log file writer. Must call InitLogFileWriter first.
func LogFile() *LogFileWriter {
	return globalLogFileWriter
}

// LogCaptureData is the JSON payload written for a single request.
type LogCaptureData struct {
	RequestID        string       `json:"request_id"`
	Timestamp        time.Time    `json:"timestamp"`
	Type             string       `json:"type"` // request | response | system
	ProviderID       string       `json:"provider_id,omitempty"`
	Prefix           string       `json:"prefix,omitempty"`
	Source           string       `json:"source,omitempty"`
	Request          *HTTPCapture `json:"request,omitempty"`
	Response         *HTTPCapture `json:"response,omitempty"`
	Timings          *Timings     `json:"timings,omitempty"`
	ModifiedRequest  *HTTPCapture `json:"modified_request,omitempty"`
	ModifiedResponse *HTTPCapture `json:"modified_response,omitempty"`
	SystemLog        []string     `json:"system_log,omitempty"`
	Error            string       `json:"error,omitempty"`
}

// HTTPCapture is a single captured HTTP message (headers + body).
type HTTPCapture struct {
	Headers map[string]string `json:"headers,omitempty"`
	Body    interface{}       `json:"body,omitempty"`
}

// Timings records request duration breakdowns in milliseconds.
type Timings struct {
	TotalMs    int64 `json:"total_ms"`
	UpstreamMs int64 `json:"upstream_ms"`
	RewriteMs  int64 `json:"rewrite_ms"`
}

// ExtractSourceFromPath returns the source mark from a relay request path.
// Paths carry the convention "/proxy/__<source>/<endpoint>" (e.g.
// "/proxy/__opencodetest/chat/completions"); the source segment is the part
// starting at "__" up to the next slash. Returns "" when no mark is present.
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

// ResolveSourceMark returns the header-carried source mark, falling back to
// path extraction when the header is absent (direct hits to the backend).
func ResolveSourceMark(header, path string) string {
	if header != "" {
		return header
	}
	return ExtractSourceFromPath(path)
}

// WriteLog serializes data and writes it to {dir}/{prefix}/{filename}.json.
// File I/O is synchronous: per-request capture volume is low enough that a
// batch layer (as used by LogWriter for the DB) would only add latency.
func (w *LogFileWriter) WriteLog(data *LogCaptureData) {
	if w == nil || data == nil || data.RequestID == "" {
		return
	}
	if data.Timestamp.IsZero() {
		data.Timestamp = time.Now().UTC()
	}
	if data.Type == "" {
		data.Type = "request"
	}
	filename := fmt.Sprintf("%s-%s-%s.json",
		fileTimestamp(data.Timestamp), sanitizeFileComponent(data.RequestID), data.Type)
	if data.Source != "" {
		filename = fmt.Sprintf("%s-%s-%s-%s.json",
			fileTimestamp(data.Timestamp), sanitizeFileComponent(data.Source),
			sanitizeFileComponent(data.RequestID), data.Type)
	}
	targetDir := w.dir
	if data.Prefix != "" {
		prefix := sanitizeFileComponent(data.Prefix)
		if prefix != "" && prefix != "." && prefix != ".." {
			targetDir = filepath.Join(targetDir, prefix)
		}
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		println("logfile: create directory failed:", err.Error())
		return
	}
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		println("logfile: marshal failed:", err.Error())
		return
	}
	if err := os.WriteFile(filepath.Join(targetDir, filename), payload, 0o644); err != nil {
		println("logfile: write failed:", err.Error())
	}
}

// LogListParams filters the captured log files during listing.
type LogListParams struct {
	Prefix string
	Types  []string
	From   time.Time // zero value = no lower bound
	To     time.Time // zero value = no upper bound
	Limit  int
	Offset int
}

// LogFileEntry is one captured log file surfaced to the dashboard.
type LogFileEntry struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Prefix    string    `json:"prefix"`
	Source    string    `json:"source"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

// ListFiles enumerates captured files, applies the filters, and returns the
// newest-first page plus the total count before pagination.
func (w *LogFileWriter) ListFiles(params LogListParams) ([]LogFileEntry, int, error) {
	if w == nil {
		return nil, 0, errors.New("log file writer not initialized")
	}
	var entries []LogFileEntry
	baseEntries, err := os.ReadDir(w.dir)
	if err != nil {
		return nil, 0, err
	}
	for _, entry := range baseEntries {
		if entry.IsDir() {
			files, err := os.ReadDir(filepath.Join(w.dir, entry.Name()))
			if err != nil {
				continue
			}
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				if fe, ok := parseLogFileEntry(entry.Name(), file); ok && fe.matches(params) {
					entries = append(entries, fe)
				}
			}
			continue
		}
		if fe, ok := parseLogFileEntry("", entry); ok && fe.matches(params) {
			entries = append(entries, fe)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name > entries[j].Name })
	total := len(entries)
	if params.Offset >= total {
		return []LogFileEntry{}, total, nil
	}
	entries = entries[params.Offset:]
	if params.Limit > 0 && len(entries) > params.Limit {
		entries = entries[:params.Limit]
	}
	return entries, total, nil
}

// ReadFile returns the raw JSON content of a captured file, identified by its
// filename. The name is validated to prevent path traversal.
func (w *LogFileWriter) ReadFile(id string) ([]byte, error) {
	if w == nil {
		return nil, errors.New("log file writer not initialized")
	}
	if !validLogFileName(id) {
		return nil, errors.New("invalid log file name")
	}
	baseEntries, err := os.ReadDir(w.dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range baseEntries {
		if entry.IsDir() {
			if content, err := os.ReadFile(filepath.Join(w.dir, entry.Name(), id)); err == nil {
				return content, nil
			}
			continue
		}
		if entry.Name() == id {
			return os.ReadFile(filepath.Join(w.dir, id))
		}
	}
	return nil, fmt.Errorf("log file %q not found", id)
}

// LogDeleteParams controls which captured files DeleteFiles removes.
type LogDeleteParams struct {
	Prefix string
	Types  []string
	From   time.Time // zero value = no lower bound
	To     time.Time // zero value = no upper bound
	All    bool      // delete every file under the log directory
}

// DeleteFiles removes captured files matching the params and returns the
// number of files deleted. In All mode every file under the log directory is
// removed; otherwise the same filters as ListFiles apply.
func (w *LogFileWriter) DeleteFiles(params LogDeleteParams) (int, error) {
	if w == nil {
		return 0, errors.New("log file writer not initialized")
	}
	if params.All {
		return deleteAllLogFiles(w.dir)
	}
	entries, _, err := w.ListFiles(LogListParams{
		Prefix: params.Prefix,
		Types:  params.Types,
		From:   params.From,
		To:     params.To,
	})
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, entry := range entries {
		if err := os.Remove(filepath.Join(w.dir, entry.Prefix, entry.Name)); err == nil {
			deleted++
		}
	}
	return deleted, nil
}

func deleteAllLogFiles(dir string) (int, error) {
	deleted := 0
	baseEntries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	for _, entry := range baseEntries {
		full := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			files, err := os.ReadDir(full)
			if err != nil {
				continue
			}
			for _, file := range files {
				if !file.IsDir() && os.Remove(filepath.Join(full, file.Name())) == nil {
					deleted++
				}
			}
			_ = os.Remove(full)
			continue
		}
		if os.Remove(full) == nil {
			deleted++
		}
	}
	return deleted, nil
}

func (e LogFileEntry) matches(params LogListParams) bool {
	if params.Prefix != "" && e.Prefix != params.Prefix {
		return false
	}
	if len(params.Types) > 0 && !containsString(params.Types, e.Type) {
		return false
	}
	if !params.From.IsZero() && e.CreatedAt.Before(params.From) {
		return false
	}
	if !params.To.IsZero() && e.CreatedAt.After(params.To) {
		return false
	}
	return true
}

// parseLogFileEntry extracts the entry fields from a directory entry using
// the {timestamp}[-{source}]-{request_id}-{type}.json filename convention.
// When the request_id segment starts with "__" it is split into source and
// the actual request id.
func parseLogFileEntry(prefix string, entry os.DirEntry) (LogFileEntry, bool) {
	info, err := entry.Info()
	if err != nil {
		return LogFileEntry{}, false
	}
	timestamp, source, typ, ok := parseLogFileName(entry.Name())
	if !ok {
		return LogFileEntry{}, false
	}
	return LogFileEntry{
		ID:        entry.Name(),
		Name:      entry.Name(),
		Prefix:    prefix,
		Source:    source,
		Type:      typ,
		Size:      info.Size(),
		CreatedAt: timestamp,
	}, true
}

// parseLogFileName splits {timestamp}[-{source}]-{request_id}-{type}.json
// back into its parts. When the first segment after the timestamp starts with
// "__" it is treated as the source mark; the remainder is the request id.
func parseLogFileName(name string) (time.Time, string, string, bool) {
	if !strings.HasSuffix(name, ".json") {
		return time.Time{}, "", "", false
	}
	base := strings.TrimSuffix(name, ".json")
	lastDash := strings.LastIndex(base, "-")
	if lastDash < 0 {
		return time.Time{}, "", "", false
	}
	typ := base[lastDash+1:]
	if typ != "request" && typ != "response" && typ != "system" {
		return time.Time{}, "", "", false
	}
	head := base[:lastDash]
	tsEnd := -1
	if len(head) >= 20 && head[19] == 'Z' {
		tsEnd = 20
	} else if tIdx := strings.Index(head, "T"); tIdx >= 0 {
		if pIdx := strings.IndexByte(head[tIdx:], '+'); pIdx >= 0 {
			tsEnd = tIdx + pIdx + 6
		}
	}
	if tsEnd < 0 {
		return time.Time{}, "", "", false
	}
	tsStr := strings.ReplaceAll(head[:tsEnd], ".", ":")
	timestamp, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		return time.Time{}, "", "", false
	}
	rest := strings.TrimPrefix(head[tsEnd:], "-")
	source := ""
	if strings.HasPrefix(rest, "__") {
		if segEnd := strings.IndexByte(rest, '-'); segEnd >= 0 {
			source = rest[:segEnd]
			rest = rest[segEnd+1:]
		}
	}
	return timestamp, source, typ, true
}

// fileTimestamp renders a time as RFC3339 with colons replaced by dots so the
// resulting string is safe to use in a filename on any filesystem.
func fileTimestamp(t time.Time) string {
	return strings.ReplaceAll(t.UTC().Format(time.RFC3339), ":", ".")
}

// sanitizeFileComponent keeps only filename-safe characters so user- or
// config-controlled input (request ids, topology prefixes) cannot escape the
// log directory via path traversal.
func sanitizeFileComponent(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

// validLogFileName rejects names that could escape the log directory.
func validLogFileName(name string) bool {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") {
		return false
	}
	return true
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
