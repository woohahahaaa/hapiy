package common

import (
	"sync"
	"sync/atomic"
	"time"
)

// Metrics provides lock-free performance metrics collection.
// Reference: New API pkg/perf_metrics - sync.Map + atomic hot path, zero locks.
type Metrics struct {
	requestsTotal   atomic.Int64
	requestsSuccess atomic.Int64
	requestsFailed  atomic.Int64
	activeRequests  atomic.Int64
	queuedRequests  atomic.Int64
	totalLatencyMs  atomic.Int64
	totalTokens     atomic.Int64

	// Per-model counters via sync.Map (no lock on hot path)
	modelCounters sync.Map // map[string]*modelCounter

	// Active request entries keyed by requestID (string) -> *ActiveRequest
	activeEntries sync.Map

	startTime time.Time
}

type modelCounter struct {
	requests atomic.Int64
	tokens   atomic.Int64
	latency  atomic.Int64
}

// ActiveRequest describes an in-flight request for the monitoring API.
type ActiveRequest struct {
	RequestID  string    `json:"request_id"`
	Model      string    `json:"model"`
	TokenName  string    `json:"token_name"`
	UserID     string    `json:"user_id"`
	Stream     bool      `json:"stream"`
	StartTime  time.Time `json:"start_time"`
	ElapsedMs  int64     `json:"elapsed_ms"`
}

var globalMetrics = NewMetrics()

func NewMetrics() *Metrics {
	return &Metrics{startTime: time.Now()}
}

func Global() *Metrics {
	return globalMetrics
}

// BeginRequest marks the start of a request. Returns nothing; call EndRequest when done.
func (m *Metrics) BeginRequest() {
	m.requestsTotal.Add(1)
	m.activeRequests.Add(1)
}

// TrackActiveRequest records an in-flight request entry keyed by its requestID.
// Call EndRequest (with the same requestID) to remove it when the request finishes.
func (m *Metrics) TrackActiveRequest(req ActiveRequest) {
	m.activeEntries.Store(req.RequestID, &req)
}

// EndRequest records completion of a request and removes its active entry (if any).
func (m *Metrics) EndRequest(requestID, model string, success bool, latencyMs int64, tokens int64) {
	m.activeRequests.Add(-1)
	m.totalLatencyMs.Add(latencyMs)
	m.totalTokens.Add(tokens)

	if requestID != "" {
		m.activeEntries.Delete(requestID)
	}

	if success {
		m.requestsSuccess.Add(1)
	} else {
		m.requestsFailed.Add(1)
	}

	if model != "" {
		v, _ := m.modelCounters.LoadOrStore(model, &modelCounter{})
		mc := v.(*modelCounter)
		mc.requests.Add(1)
		mc.tokens.Add(tokens)
		mc.latency.Add(latencyMs)
	}
}

// ActiveRequests returns a snapshot of all currently in-flight requests,
// each annotated with elapsed_ms computed from its StartTime.
func (m *Metrics) ActiveRequests() []ActiveRequest {
	now := time.Now()
	out := make([]ActiveRequest, 0)
	m.activeEntries.Range(func(k, v interface{}) bool {
		req := v.(*ActiveRequest)
		req.ElapsedMs = now.Sub(req.StartTime).Milliseconds()
		out = append(out, *req)
		return true
	})
	return out
}

// IncQueued / DecQueued track queued requests for concurrency control.
func (m *Metrics) IncQueued() { m.queuedRequests.Add(1) }
func (m *Metrics) DecQueued() { m.queuedRequests.Add(-1) }

// Snapshot returns current metric values.
type Snapshot struct {
	UptimeSeconds   int64            `json:"uptime_seconds"`
	RequestsTotal   int64            `json:"requests_total"`
	RequestsSuccess int64            `json:"requests_success"`
	RequestsFailed  int64            `json:"requests_failed"`
	ActiveRequests  int64            `json:"active_requests"`
	QueuedRequests  int64            `json:"queued_requests"`
	AvgLatencyMs    int64            `json:"avg_latency_ms"`
	TotalTokens     int64            `json:"total_tokens"`
	Models          map[string]int64 `json:"models"`
}

func (m *Metrics) Snapshot() Snapshot {
	total := m.requestsTotal.Load()
	var avg int64
	if total > 0 {
		avg = m.totalLatencyMs.Load() / total
	}

	models := make(map[string]int64)
	m.modelCounters.Range(func(k, v interface{}) bool {
		models[k.(string)] = v.(*modelCounter).requests.Load()
		return true
	})

	return Snapshot{
		UptimeSeconds:   int64(time.Since(m.startTime).Seconds()),
		RequestsTotal:   total,
		RequestsSuccess: m.requestsSuccess.Load(),
		RequestsFailed:  m.requestsFailed.Load(),
		ActiveRequests:  m.activeRequests.Load(),
		QueuedRequests:  m.queuedRequests.Load(),
		AvgLatencyMs:    avg,
		TotalTokens:     m.totalTokens.Load(),
		Models:          models,
	}
}
