package service

import (
	"sync"
	"time"

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
