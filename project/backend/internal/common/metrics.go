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

	// Active request entries keyed by requestID (string) -> *ActiveRequest.
	// Stored pointers are immutable: EndRequest replaces the pointer with a
	// copy (copy-on-write) instead of mutating the shared value.
	activeEntries sync.Map

	// retentionMinutes keeps finished request entries visible for this many
	// minutes after they end (0 = evict immediately). Configurable at runtime.
	// A float64 (not an int64) because sub-minute retentions such as 30s are
	// valid. Guarded by retentionMu; write frequency is negligible.
	retentionMinutes float64
	retentionMu      sync.Mutex

	startTime time.Time
}

type modelCounter struct {
	requests atomic.Int64
	tokens   atomic.Int64
	latency  atomic.Int64
}

// ActiveRequest describes an in-flight request for the monitoring API.
// EndTime is nil while the request is running and set when it finishes.
// Stage/ChunkCount/BytesReceived describe live progress for in-flight
// requests and are refreshed periodically by the relay handler.
type ActiveRequest struct {
	RequestID     string     `json:"request_id"`
	Model         string     `json:"model"`
	TokenName     string     `json:"token_name"`
	UserID        string     `json:"user_id"`
	Provider      string     `json:"provider"`
	ProviderID    string     `json:"provider_id"`
	Source        string     `json:"source"`
	Stream        bool       `json:"stream"`
	StartTime     time.Time  `json:"start_time"`
	ElapsedMs     int64      `json:"elapsed_ms"`
	FirstByteMs   *int64     `json:"first_byte_ms,omitempty"`
	EndTime       *time.Time `json:"end_time"`
	Outcome       string     `json:"outcome"`
	Stage         string     `json:"stage"`
	ChunkCount    int64      `json:"chunk_count"`
	BytesReceived int64      `json:"bytes_received"`
	PathNodeIds   []string   `json:"path_node_ids"`
	AffinityReuse string     `json:"affinity_reuse"`
}

var globalMetrics = NewMetrics()

func NewMetrics() *Metrics {
	m := &Metrics{startTime: time.Now()}
	m.retentionMinutes = 5
	return m
}

// SetRetentionMinutes updates how long finished requests stay visible.
// 0 evicts finished requests immediately.
func (m *Metrics) SetRetentionMinutes(minutes float64) {
	m.retentionMu.Lock()
	m.retentionMinutes = minutes
	m.retentionMu.Unlock()
}

func (m *Metrics) RetentionMinutes() float64 {
	m.retentionMu.Lock()
	defer m.retentionMu.Unlock()
	return m.retentionMinutes
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

// UpdateActiveRequestProgress refreshes the live progress fields (stage, chunk
// count, bytes received) of an in-flight request. The stored entry is replaced
// copy-on-write; no progress fields are touched when the request has finished.
func (m *Metrics) UpdateActiveRequestProgress(requestID, stage string, chunks, bytesReceived int64) {
	if requestID == "" {
		return
	}
	v, ok := m.activeEntries.Load(requestID)
	if !ok {
		return
	}
	req := *v.(*ActiveRequest)
	if req.EndTime != nil {
		return
	}
	req.Stage = stage
	req.ChunkCount = chunks
	req.BytesReceived = bytesReceived
	m.activeEntries.Store(requestID, &req)
}

// UpdateActiveRequestFirstByte records the first-byte latency (ms) for an
// in-flight request entry once the first upstream body byte is received.
// Negative values (first byte never arrived) are ignored.
func (m *Metrics) UpdateActiveRequestFirstByte(requestID string, firstByteMs int64) {
	if requestID == "" || firstByteMs < 0 {
		return
	}
	v, ok := m.activeEntries.Load(requestID)
	if !ok {
		return
	}
	req := *v.(*ActiveRequest)
	if req.EndTime != nil {
		return
	}
	ms := firstByteMs
	req.FirstByteMs = &ms
	m.activeEntries.Store(requestID, &req)
}

// EndRequest records completion of a request. The active entry (if any) is
// kept with its EndTime set so the monitoring API can show finished requests
// for the configured retention period. Outcome classifies how it ended:
// completed | upstream_error | client_disconnected | queued_rejected |
// invalid_request | failed.
func (m *Metrics) EndRequest(requestID, model string, success bool, latencyMs int64, tokens int64, outcome string) {
	m.activeRequests.Add(-1)
	m.totalLatencyMs.Add(latencyMs)
	m.totalTokens.Add(tokens)

	if requestID != "" {
		if v, ok := m.activeEntries.Load(requestID); ok {
			req := *v.(*ActiveRequest)
			now := time.Now()
			req.EndTime = &now
			req.Outcome = outcome
			m.activeEntries.Store(requestID, &req)
		}
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

// evictExpired removes finished entries whose EndTime has passed the
// configured retention window.
func (m *Metrics) evictExpired(retention time.Duration) {
	cutoff := time.Now().Add(-retention)
	var stale []string
	m.activeEntries.Range(func(k, v interface{}) bool {
		req := v.(*ActiveRequest)
		if req.EndTime != nil && req.EndTime.Before(cutoff) {
			stale = append(stale, req.RequestID)
		}
		return true
	})
	for _, id := range stale {
		m.activeEntries.Delete(id)
	}
}

// ActiveRequests returns a snapshot of all visible request entries (in-flight
// plus finished ones still within the retention window), evicting expired
// entries first. ElapsedMs is the total duration for finished requests.
func (m *Metrics) ActiveRequests() []ActiveRequest {
	m.evictExpired(time.Duration(m.RetentionMinutes()) * time.Minute)
	now := time.Now()
	out := make([]ActiveRequest, 0)
	m.activeEntries.Range(func(k, v interface{}) bool {
		req := *v.(*ActiveRequest)
		if req.EndTime != nil {
			req.ElapsedMs = req.EndTime.Sub(req.StartTime).Milliseconds()
		} else {
			req.ElapsedMs = now.Sub(req.StartTime).Milliseconds()
		}
		out = append(out, req)
		return true
	})
	return out
}

// StartEvictionLoop periodically removes expired finished entries so the map
// cannot grow unbounded while nobody is polling the monitoring API. The
// returned function stops the loop.
func (m *Metrics) StartEvictionLoop(interval time.Duration) func() {
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.evictExpired(time.Duration(m.RetentionMinutes()) * time.Minute)
			case <-stop:
				return
			}
		}
	}()
	return func() { close(stop) }
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
