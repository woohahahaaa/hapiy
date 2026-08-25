package service

import (
	"bytes"
	"encoding/json"
	"io"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// LogWriter batches log writes to reduce database pressure.
// Reference: New API model/utils.go - accumulate in memory map, merge to DB every 5s.
type LogWriter struct {
	db       *gorm.DB
	mu       sync.Mutex
	pending  []*model.Log
	ticker   *time.Ticker
	stopCh   chan struct{}
	doneCh   chan struct{}
	flushSec int
}

var globalLogWriter *LogWriter
var logWriterOnce sync.Once

// InitLogWriter initializes the global batched log writer.
func InitLogWriter(db *gorm.DB) {
	logWriterOnce.Do(func() {
		globalLogWriter = &LogWriter{
			db:       db,
			pending:  make([]*model.Log, 0, 128),
			ticker:   time.NewTicker(5 * time.Second),
			stopCh:   make(chan struct{}),
			doneCh:   make(chan struct{}),
			flushSec: 5,
		}
		go globalLogWriter.loop()
	})
}

// Logs returns the global log writer. Must call InitLogWriter first.
func Logs() *LogWriter {
	return globalLogWriter
}

// Write queues a log entry for batched insertion. Non-blocking on hot path.
func (w *LogWriter) Write(entry *model.Log) {
	w.mu.Lock()
	w.pending = append(w.pending, entry)
	shouldFlush := len(w.pending) >= 500
	w.mu.Unlock()

	if shouldFlush {
		go w.Flush()
	}
}

func (w *LogWriter) loop() {
	defer close(w.doneCh)
	for {
		select {
		case <-w.ticker.C:
			w.Flush()
		case <-w.stopCh:
			w.Flush()
			return
		}
	}
}

// Flush writes all pending logs to the database in one batch.
func (w *LogWriter) Flush() {
	w.mu.Lock()
	if len(w.pending) == 0 {
		w.mu.Unlock()
		return
	}
	batch := w.pending
	w.pending = make([]*model.Log, 0, 128)
	w.mu.Unlock()

	// Batch insert; GORM creates a multi-row INSERT
	if err := w.db.CreateInBatches(batch, 100).Error; err != nil {
		// On failure, log to stdout as fallback; do not re-queue to avoid infinite growth
		println("logwriter: batch insert failed:", err.Error())
	}
}

// Stop flushes remaining logs and stops the background loop.
func (w *LogWriter) Stop() {
	close(w.stopCh)
	<-w.doneCh
}

// LogRelayFailureInput is the argument bag for LogRelayFailure. Every
// caller — the relay handler, the token-auth middleware — passes the
// fields it can produce and leaves the rest zero-valued.
type LogRelayFailureInput struct {
	UserID       string
	TokenName    string
	ProviderName string
	ModelName    string
	RequestID    string
	IP           string
	UseTimeMs    int
	Error        error
}

// LogRelayFailure queues a single "failed" log row for batched insertion.
// No-op when the log writer is not yet initialised or Error is nil —
// callers can fire it unconditionally without guarding for boot order.
// Used by both the relay handler and the token-auth middleware so every
// rejected request shows up in the logs table.
func LogRelayFailure(in LogRelayFailureInput) {
	if globalLogWriter == nil || in.Error == nil {
		return
	}
	globalLogWriter.Write(&model.Log{
		UserID:       in.UserID,
		TokenName:    in.TokenName,
		ProviderName: in.ProviderName,
		ModelName:    in.ModelName,
		Status:       "failed",
		IP:           in.IP,
		RequestID:    in.RequestID,
		ErrorMessage: in.Error.Error(),
		UseTime:      in.UseTimeMs,
	})
}

// Channel/management event sources written into the usage-logs table by
// the "使用记录" feature. Source carries the Chinese event type label.
const (
	LogSourceChannelDisabled        = "自动禁用"
	LogSourceChannelRecoveredAuto   = "自动恢复"
	LogSourceChannelRecoveredManual = "手动恢复"
	LogSourceSystemAdmin            = "系统管理"
)

// DimensionLabel maps a failover dimension key to its display label.
// Unknown dimensions are returned verbatim.
func DimensionLabel(dimension string) string {
	switch dimension {
	case "provider":
		return "供应商"
	case "base_url":
		return "BaseURL"
	case "key":
		return "Key"
	}
	return dimension
}

// ChannelEventMessage builds the event description for a channel
// disable/recover event. The provider dimension (or an empty value) is
// described by the label alone; otherwise the value is appended, e.g.
// "Key：sk-xxx".
func ChannelEventMessage(dimension, value string) string {
	label := DimensionLabel(dimension)
	if dimension == "provider" || value == "" {
		return label
	}
	return label + "：" + value
}

// LogEvent queues a channel/management event row for batched insertion.
// No-op when the log writer is not yet initialised, so callers can fire
// it unconditionally without guarding for boot order.
func LogEvent(source, providerName, message string) {
	if globalLogWriter == nil {
		return
	}
	globalLogWriter.Write(&model.Log{
		Source:       source,
		ProviderName: providerName,
		ErrorMessage: message,
		Status:       "",
	})
}

// ExtractModelFromRequestBody reads c.Request.Body to extract the JSON
// "model" field, then replaces the body with a fresh reader so the
// downstream handler can re-read the same bytes. Returns "" on any
// error (no body, read failure, malformed JSON, missing model field) —
// logging the failed request must never block the rejection path.
func ExtractModelFromRequestBody(c *gin.Context) string {
	if c == nil || c.Request == nil || c.Request.Body == nil {
		return ""
	}
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return ""
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
	var probe struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(bodyBytes, &probe); err != nil {
		return ""
	}
	return probe.Model
}
