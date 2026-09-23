package relay

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/hapiy/hapiy/internal/topology"
)

// LoadProviders loads all enabled providers from database and compiles execution plans.
// It rebuilds the cache from scratch so that disabled or deleted providers are dropped
// from in-memory state without waiting for a process restart.
func (e *Engine) LoadProviders() error {
	return e.RefreshPlans()
}

// SyncLoop periodically reloads provider configuration (hot reload)
func (e *Engine) SyncLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := e.LoadProviders(); err != nil {
				log.Printf("Failed to sync providers: %v", err)
			}
		case <-e.stopCh:
			return
		}
	}
}

// Stop gracefully stops the sync loop
func (e *Engine) Stop() {
	close(e.stopCh)
}

// GetProvider retrieves a provider by ID
func (e *Engine) GetProvider(id string) (*model.Provider, error) {
	e.providersMu.RLock()
	defer e.providersMu.RUnlock()
	p, ok := e.providers[id]
	if !ok {
		return nil, errors.New("provider not found")
	}
	return p, nil
}

// GetPlan retrieves the compiled execution plan for a provider
func (e *Engine) GetPlan(providerID string) (*ExecutionPlan, error) {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()
	plan, ok := e.plans[providerID]
	if !ok {
		return nil, errors.New("plan not found")
	}
	return plan, nil
}

// OwnModel is one entry of the aggregated model list served at
// /v1/models. OwnedBy mirrors the configured provider name so OpenAI-
// compatible clients can display it directly.
type OwnModel struct {
	ID      string
	OwnedBy string
}

// OwnModels returns the deduplicated, sorted union of every model name
// declared by enabled providers in their compiled execution plans. This is
// the user-facing model surface (what the relay can actually serve) and is
// the data source for the /v1/models endpoint.
func (e *Engine) OwnModels() []OwnModel {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()
	seen := map[string]string{}
	for _, plan := range e.plans {
		if plan == nil || plan.Provider == nil || plan.Provider.Name == "" {
			continue
		}
		ownedBy := plan.Provider.Name
		for id := range plan.ModelSet {
			if id == "" {
				continue
			}
			if _, ok := seen[id]; !ok {
				seen[id] = ownedBy
			}
		}
	}
	out := make([]OwnModel, 0, len(seen))
	for id, ownedBy := range seen {
		out = append(out, OwnModel{ID: id, OwnedBy: ownedBy})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// InvalidatePlan forces recompilation of a provider's execution plan.
// The provider row is reloaded from the database first so recent edits
// take effect immediately instead of recompiling a stale snapshot.
func (e *Engine) InvalidatePlan(providerID string) {
	var p model.Provider
	if err := e.db.First(&p, "id = ?", providerID).Error; err != nil {
		return
	}
	e.providersMu.Lock()
	e.providers[providerID] = &p
	e.providersMu.Unlock()
	e.compilePlan(&p)
}

// compilePlan builds an execution plan from provider configuration
func (e *Engine) compilePlan(p *model.Provider) error {
	plan := &ExecutionPlan{
		ID:       p.ID,
		Provider: p,
	}
	if err := e.populatePlan(e.db, plan); err != nil {
		return err
	}

	e.plansMu.Lock()
	e.plans[p.ID] = plan
	e.plansMu.Unlock()

	return nil
}

// SelectProvider selects a provider for the given model (and optional
// endpoint path) using round-robin with weight. The model membership check
// uses the pre-parsed ModelSet populated during plan compilation; the path
// check uses AllowedPaths (empty set = any path). Both filters are O(1)
// per plan so the loop stays cheap even with many providers.
func (e *Engine) SelectProvider(modelName, path string) (*model.Provider, error) {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()

	var fallback *model.Provider
	for _, plan := range e.plans {
		if plan.Provider == nil {
			continue
		}
		if !plan.Provider.Status || !plan.Provider.WorkflowEnabled || e.providerDisabled(plan.Provider) {
			continue
		}
		if _, ok := plan.ModelSet[modelName]; !ok {
			continue
		}
		if len(plan.AllowedPaths) > 0 {
			if _, ok := plan.AllowedPaths[path]; !ok {
				continue
			}
			return plan.Provider, nil
		}
		if fallback == nil {
			fallback = plan.Provider
		}
	}

	if fallback == nil {
		return nil, fmt.Errorf("%w for model %s", ErrNoProvider, modelName)
	}

	// Simple round-robin (TODO: implement weighted selection)
	return fallback, nil
}

// RelayRequest represents an incoming request from the handler.
type RelayRequest struct {
	// RequestID is the per-request correlation id set by the middleware
	// (X-Request-ID). It is propagated into topologyStageEvent so the
	// future SSE stage fan-out can group events by request.
	RequestID string `json:"-"`
	// UserID and TokenID are populated by the handler so concurrency
	// rules with scope=per_user / per_token can key their waitlists.
	UserID  string `json:"-"`
	TokenID string `json:"-"`
	// TokenName is the display name of the authenticated token, populated by
	// the handler for log capture rows.
	TokenName string `json:"-"`
	// IP is the client IP, populated by the handler so engine-side log rows
	// (e.g. the disabled-attempt record) can carry it.
	IP string `json:"-"`
	// Model is the literal user-supplied model name (e.g. "gpt-4").
	Model       string                   `json:"model"`
	Messages    []map[string]interface{} `json:"messages,omitempty"`
	Stream      bool                     `json:"stream,omitempty"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Temperature float64                  `json:"temperature,omitempty"`
	Body        map[string]interface{}   `json:"-"` // Full request body
	Headers     map[string]string        `json:"-"`
	// Path is the request URL path (e.g. "/v1/chat/completions"). It is
	// appended to the provider's base URL when building the upstream URL.
	Path string `json:"-"`
	// SourceMark is the optional "__来源" segment carried by the ingress
	// proxy (X-Hapiy-Source). Empty when the request bypasses the proxy.
	SourceMark string `json:"-"`
	// KeyIndex and BaseURLIndex select which key/baseURL to use (-1 = rotate
	// from the first available).
	KeyIndex       int                     `json:"-"`
	BaseURLIndex   int                     `json:"-"`
	TopologyOrigin *topology.RequestOrigin `json:"-"`
	// EntryID is the request entry whose workflow served the request; it is
	// recorded into fallback channel history so reuse stays entry-scoped.
	EntryID string `json:"-"`
	// Progress, when non-nil, receives stage updates as the request advances
	// through the relay pipeline (queued, connecting, receiving). It lets the
	// caller surface live progress on the monitoring page without polling the
	// engine internals.
	Progress func(stage string) `json:"-"`
}

// RelayResponse represents the upstream response.
type RelayResponse struct {
	StatusCode int
	Headers    map[string]string
	Body       io.ReadCloser
	Usage      *UsageInfo
	// FirstByteAt is the moment the upstream request was issued (right before
	// Do); the handler uses it as the TTFB baseline and measures
	// time-to-first-byte as FirstByteAt -> first body byte read.
	FirstByteAt time.Time
	// Stage timings in milliseconds; -1 means the stage did not apply.
	ConnectMs         int
	FirstByteMs       int
	RequestRewriteMs  int
	ResponseRewriteMs int
	// streamRewriter, when set for a streaming response, rewrites each SSE
	// event as it flows and accumulates the rewrite time. The handler reads
	// the total via StreamRewriteTotalMs after the stream is forwarded.
	streamRewriter *streamRewriteReader
	// StreamCapture, when set for a streaming response, accumulates the raw
	// forwarded bytes as the handler reads them. The handler reads the
	// captured payload via StreamCapturedBytes after the stream completes
	// and backfills it into the log capture row.
	StreamCapture *streamCaptureReader
	// QueueWaitMs is the time spent waiting for a concurrency slot before
	// the upstream request is issued; -1 when no concurrency rule applies.
	QueueWaitMs int
	// UpstreamURL is the full URL (provider base URL + request path) that
	// was actually issued to the upstream provider; empty when the relay
	// never reached the upstream call.
	UpstreamURL string
	// ProviderKey and ProviderBaseURL name the provider channel actually
	// used for the upstream call (matching UpstreamURL); empty when the
	// relay never reached the upstream call.
	ProviderKey     string
	ProviderBaseURL string
}

// StreamRewriteTotalMs returns the cumulative streaming rewrite time, or
// -1 when the response was not stream-rewritten.
func (resp *RelayResponse) StreamRewriteTotalMs() int {
	if resp == nil || resp.streamRewriter == nil {
		return -1
	}
	return int(resp.streamRewriter.TotalRewriteMs())
}

// StreamCapturedBytes returns the raw SSE bytes forwarded downstream so the
// handler can backfill them into the log capture row. Returns nil when the
// response was not wrapped with a stream capture reader.
func (resp *RelayResponse) StreamCapturedBytes() []byte {
	if resp == nil || resp.StreamCapture == nil {
		return nil
	}
	return resp.StreamCapture.Captured()
}

// UsageInfo tracks token usage.
type UsageInfo struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	CacheWriteTokens int
	CacheReadTokens  int
}

// RelayRequest executes the request through the compiled pipeline.
// Pipeline order (fixed, not configurable):
//  1. Concurrency control
//  2. Request logging and rewrite
//  3. Relay to upstream (with failover)
//  4. Response logging and rewrite
//  5. Debug logging
func (e *Engine) RelayRequest(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Step 1: Request logging and rewrite. The rewrite runs before the
	// concurrency gate: it is cheap local work and must not consume a
	// concurrency slot (the gate exists to protect the upstream, not CPU).
	e.runTopologyLogOutputs(topologyStageRequestBefore, plan.LogOutputs, plan, req, nil)
	reqRewriteMs := -1
	if len(plan.CompiledRewrite) > 0 {
		rewriteStart := time.Now()
		if err := e.applyCompiledRewriteRules(plan, req); err != nil {
			return nil, err
		}
		reqRewriteMs = int(time.Since(rewriteStart).Milliseconds())
	}
	e.runTopologyLogOutputs(topologyStageRequestAfter, plan.LogOutputs, plan, req, nil)

	// Step 2: Concurrency control. Only the upstream request is gated; the
	// rewrite above already completed. Multiple concurrency nodes on the
	// provider's chain must ALL pass (AND); each release func must be called
	// on every exit path so we wrap the rest of the pipeline in a closure
	// that defers the releases before returning.
	queueWaitMs := -1
	var releaseConcurrency []func(time.Time)
	if len(plan.ConcurrencyRules) > 0 && req.Progress != nil {
		req.Progress("queued")
	}
	queueStart := time.Now()
	for _, rule := range plan.ConcurrencyRules {
		rel, err := e.checkConcurrency(ctx, plan, rule)
		if err != nil {
			for _, r := range releaseConcurrency {
				r(time.Now())
			}
			return nil, err
		}
		releaseConcurrency = append(releaseConcurrency, rel)
	}
	if len(plan.ConcurrencyRules) > 0 {
		queueWaitMs = int(time.Since(queueStart).Milliseconds())
	}
	finishConcurrency := func(finish time.Time) {
		for _, r := range releaseConcurrency {
			r(finish)
		}
	}
	defer func() { finishConcurrency(time.Now()) }()
	if req.Progress != nil {
		req.Progress("connecting")
	}
	e.recordTopologyStage(topologyStageEvent{
		Stage:      topologyStageRelay,
		ProviderID: plan.ID,
		RequestID:  req.RequestID,
	})
	resp, err := e.relayWithFailover(ctx, plan, req)
	if err != nil {
		// Record the failure in log capture with the upstream error detail.
		// When resp is non-nil the upstream returned an HTTP error (4xx/5xx);
		// its body was already consumed by relayNonStreaming/relayStreaming
		// so we only record the error text.
		if len(plan.LogOutputs) > 0 {
			writer := service.LogCapture()
			if writer != nil && req != nil {
				var failConnectMs *int
				var failHeaders map[string]string
				if resp != nil {
					failConnectMs = msPtr(resp.ConnectMs)
					failHeaders = resp.Headers
				}
				for _, assignment := range plan.LogOutputs {
					if !assignment.Enabled {
						continue
					}
					if !assignment.NodeEnabled {
						continue
					}
					cfg, err2 := parseLogOutputConfig(assignment.Config)
					if err2 != nil {
						continue
					}
					if autoClosed(assignment, cfg) {
						continue
					}
					// A single response_after row carries the failure. We avoid
					// the empty response_before/response_after placeholders
					// (nil resp) that would otherwise inflate the pair's
					// response count and render as blank nodes.
					data := &service.LogCaptureData{
						RequestID:    req.RequestID,
						Stage:        string(topologyStageResponseAfter),
						Type:         "response",
						ProviderID:   plan.ID,
						ProviderName: plan.Provider.Name,
						ModelName:    req.Model,
						TokenName:    req.TokenName,
						Prefix:       cfg.Prefix,
						Source:       service.ResolveSourceMark(req.SourceMark, req.Path),
						Error:        err.Error(),
						ConnectMs:    failConnectMs,
					}
					if failHeaders != nil {
						data.Response = &service.HTTPCapture{Headers: failHeaders, Body: err.Error()}
					} else {
						data.Response = &service.HTTPCapture{Body: err.Error()}
					}
					writer.WriteLog(data)
				}
			}
		}
		// Propagate resp so the caller can still read fields like
		// UpstreamURL even when the relay failed end-to-end.
		return resp, err
	}
	resp.RequestRewriteMs = reqRewriteMs
	resp.QueueWaitMs = queueWaitMs
	resp.ResponseRewriteMs = -1

	// Step 4: Response logging and rewrite. Non-streaming bodies are
	// buffered and rewritten in full. Streaming bodies are never buffered;
	// when response-rewrite rules are configured they are instead wrapped
	// in a stream rewriter that rewrites each SSE event as it flows, and
	// the stage event is still recorded.
	e.runTopologyLogOutputs(topologyStageResponseBefore, plan.LogOutputs, plan, req, resp)
	if !req.Stream && len(plan.CompiledResponseRewrites) > 0 {
		respRewriteStart := time.Now()
		if err := e.applyCompiledResponseRewriteRules(plan, resp); err != nil {
			return nil, err
		}
		resp.ResponseRewriteMs = int(time.Since(respRewriteStart).Milliseconds())
	}
	if req.Stream && resp.Body != nil && len(plan.CompiledResponseRewrites) > 0 {
		resp.streamRewriter = newStreamRewriteReader(resp.Body, plan.CompiledResponseRewrites)
		resp.Body = resp.streamRewriter
	}
	e.recordTopologyStage(topologyStageEvent{
		Stage:                topologyStageResponseRewrite,
		ProviderID:           plan.ID,
		RequestID:            req.RequestID,
		ResponseRewriteRules: plan.ResponseRewriteRules,
	})
	e.runTopologyLogOutputs(topologyStageResponseAfter, plan.LogOutputs, plan, req, resp)

	// Step 5: Wrap the final streaming body with a capture reader so the
	// handler can backfill the forwarded bytes into the log capture row
	// after the stream ends. The capture wrapper sits OUTSIDE the
	// stream-rewriter so it observes what the downstream client
	// actually receives.
	if req.Stream && resp.Body != nil && resp.StreamCapture == nil {
		buf := &bytes.Buffer{}
		capture := newStreamCaptureReader(resp.Body, buf)
		resp.StreamCapture = capture
		resp.Body = capture
	}

	// Step 6: Debug logging
	if plan.DebugEnabled {
		e.logDebug(plan, req, resp)
	}

	e.recordFallbackChannel(req, plan.Provider.ID, req.KeyIndex, req.BaseURLIndex)

	return resp, nil
}

// applyCompiledRewriteRules reads req.Body, runs the compiled rewrite
// chain, and writes the result back into req.Body. We round-trip through
// JSON because the existing req.Body is map[string]any — that's the
// contract established by handler/relay.go.
func (e *Engine) applyCompiledRewriteRules(plan *ExecutionPlan, req *RelayRequest) error {
	raw, err := json.Marshal(req.Body)
	if err != nil {
		return fmt.Errorf("marshal request body: %w", err)
	}
	updated, updatedHeaders, err := applyRewriteChains(raw, req.Headers, plan.CompiledRewrite)
	if err != nil {
		return err
	}
	req.Headers = updatedHeaders
	if !bytes.Equal(raw, updated) {
		var merged map[string]interface{}
		if err := json.Unmarshal(updated, &merged); err != nil {
			return fmt.Errorf("unmarshal rewritten request: %w", err)
		}
		req.Body = merged
	}
	return nil
}

// applyCompiledResponseRewriteRules is the non-streaming counterpart.
// Streaming bodies are deliberately NOT rewritten here; the engine
// records a stage event but does not touch the body.
func (e *Engine) applyCompiledResponseRewriteRules(plan *ExecutionPlan, resp *RelayResponse) error {
	if resp.Body == nil {
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}
	_ = resp.Body.Close()
	updated, updatedHeaders, err := applyRewriteChains(body, resp.Headers, plan.CompiledResponseRewrites)
	if err != nil {
		return err
	}
	resp.Headers = updatedHeaders
	resp.Body = io.NopCloser(bytes.NewReader(updated))
	if resp.Headers == nil {
		resp.Headers = map[string]string{}
	}
	resp.Headers["Content-Length"] = fmt.Sprintf("%d", len(updated))
	return nil
}

// runTopologyLogOutputs records the stage event for the selected log outputs
// and writes the per-stage capture row for every configured log node.
func (e *Engine) runTopologyLogOutputs(stage topologyStage, assignments []LogOutputAssignment, plan *ExecutionPlan, req *RelayRequest, resp *RelayResponse) {
	if len(assignments) == 0 {
		return
	}
	event := topologyStageEvent{Stage: stage, LogOutputs: assignments}
	if plan != nil {
		event.ProviderID = plan.ID
	}
	if req != nil {
		event.RequestID = req.RequestID
	}
	e.recordTopologyStage(event)

	writer := service.LogCapture()
	if writer == nil || plan == nil || req == nil {
		return
	}

	responseBody := captureResponseBody(resp, req.Stream)

	for _, assignment := range assignments {
		if !assignment.Enabled {
			continue
		}
		if !assignment.NodeEnabled {
			continue
		}
		cfg, err := parseLogOutputConfig(assignment.Config)
		if err != nil {
			continue
		}
		if autoClosed(assignment, cfg) {
			continue
		}
		data := &service.LogCaptureData{
			RequestID:    req.RequestID,
			Stage:        string(stage),
			Type:         logOutputStageType(stage),
			ProviderID:   plan.ID,
			ProviderName: plan.Provider.Name,
			ModelName:    req.Model,
			TokenName:    req.TokenName,
			Prefix:       cfg.Prefix,
			Source:       service.ResolveSourceMark(req.SourceMark, req.Path),
		}
		// Stage timings are always recorded (independent of the record_*
		// switches) so every captured request carries its timing breakdown.
		if resp != nil {
			data.ConnectMs = msPtr(resp.ConnectMs)
			data.RequestRewriteMs = msPtr(resp.RequestRewriteMs)
			data.ResponseRewriteMs = msPtr(resp.ResponseRewriteMs)
			data.QueueWaitMs = msPtr(resp.QueueWaitMs)
		}
		switch stage {
		case topologyStageRequestBefore:
			if cfg.RecordRequest {
				data.Request = &service.HTTPCapture{Headers: req.Headers, Body: req.Body}
			}
		case topologyStageRequestAfter:
			if cfg.RecordRequest {
				data.Request = &service.HTTPCapture{Headers: req.Headers, Body: req.Body}
			}
		case topologyStageResponseBefore:
			if cfg.RecordResponse && resp != nil {
				data.Response = &service.HTTPCapture{Headers: resp.Headers, Body: responseBody}
			}
		case topologyStageResponseAfter:
			if cfg.RecordResponse && resp != nil {
				data.Response = &service.HTTPCapture{Headers: resp.Headers, Body: responseBody}
			}
		}
		writer.WriteLog(data)
	}
}

// RecordDispatchRejection writes a log_captures row for every enabled logOutput
// node in the topology when dispatch rejects a request, so rejected requests
// stay visible in the log-capture view. No-op when no enabled logOutput node
// exists, the capture writer is uninitialised, or inputs are nil.
func (e *Engine) RecordDispatchRejection(req *RelayRequest, err error) {
	writer := service.LogCapture()
	if writer == nil || req == nil || err == nil {
		return
	}
	tp, loadErr := topology.NewStore(e.db).Load()
	if loadErr != nil || tp == nil {
		return
	}
	for _, node := range tp.Nodes {
		if node.Kind != topology.KindSlot || node.SlotType != "logOutput" || !node.Enabled {
			continue
		}
		if len(node.Entries) == 0 {
			continue
		}
		var entries []logOutputFlatEntry
		if unmarshalErr := json.Unmarshal(node.Entries, &entries); unmarshalErr != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.Enabled {
				continue
			}
			cfg, cfgErr := parseLogOutputConfig(string(entry.Config))
			if cfgErr != nil {
				continue
			}
			if autoClosed(LogOutputAssignment{}, cfg) {
				continue
			}
			data := &service.LogCaptureData{
				RequestID: req.RequestID,
				Stage:     string(topologyStageRequestBefore),
				Type:      "request",
				ModelName: req.Model,
				TokenName: req.TokenName,
				Prefix:    cfg.Prefix,
				Source:    service.ResolveSourceMark(req.SourceMark, req.Path),
				Error:     err.Error(),
			}
			if cfg.RecordRequest {
				data.Request = &service.HTTPCapture{Headers: req.Headers, Body: req.Body}
			}
			writer.WriteLog(data)
		}
	}
}

// logOutputFlatEntry mirrors the logOutput entry shape stored on a flat
// topology slot node; only the fields the rejection recorder needs are kept.
type logOutputFlatEntry struct {
	Enabled bool            `json:"enabled"`
	Config  json.RawMessage `json:"config"`
}

// captureResponseBody buffers the response body so a log stage can write it
// without consuming the stream the handler forwards downstream. Non-streaming
// bodies are buffered in full. Streaming bodies are recorded as an empty
// placeholder; the handler backfills the real bytes via
// service.LogCapture().UpdateStreamBody once the stream is fully forwarded.
// A successful non-streaming read restores resp.Body from the buffered bytes.
func captureResponseBody(resp *RelayResponse, stream bool) interface{} {
	if resp == nil || resp.Body == nil {
		return nil
	}
	if stream {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "error: " + err.Error()
	}
	_ = resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(body))
	var parsed interface{}
	if json.Unmarshal(body, &parsed) == nil {
		return parsed
	}
	return string(body)
}

// parseLogOutputConfig decodes a logOutput assignment's raw JSON with the
// documented defaults: auto_close_minutes defaults to 5.
func parseLogOutputConfig(raw string) (LogOutputNodeConfig, error) {
	cfg := LogOutputNodeConfig{Enabled: false}
	if raw == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return LogOutputNodeConfig{}, err
	}
	return cfg, nil
}

// autoClosed reports whether a log node has exceeded its auto-close window.
// The user-set DeadlineAt (absolute wall-clock cutoff) wins when present;
// otherwise we fall back to the legacy heuristic of measuring from the
// topology assignment's creation time.
func autoClosed(assignment LogOutputAssignment, cfg LogOutputNodeConfig) bool {
	if cfg.DeadlineAt > 0 {
		return time.Now().UnixMilli() >= cfg.DeadlineAt
	}
	return false
}

func logOutputStageType(stage topologyStage) string {
	switch stage {
	case topologyStageResponseBefore, topologyStageResponseAfter:
		return "response"
	default:
		return "request"
	}
}

// msPtr converts a stage timing to a pointer, mapping -1 (stage not
// applicable) to nil so the JSON row omits the field.
func msPtr(v int) *int {
	if v < 0 {
		return nil
	}
	return &v
}

func (e *Engine) recordTopologyStage(event topologyStageEvent) {
	if e.topologyStageHook != nil {
		e.topologyStageHook(event)
	}
}

// relayNonStreaming handles non-streaming requests.
func (e *Engine) relayNonStreaming(ctx context.Context, url, key string, req *RelayRequest) (*RelayResponse, error) {
	bodyBytes, err := e.marshalRequestBody(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	e.setupUpstreamHeaders(httpReq, key, req)

	connectStart := time.Now()
	resp, err := service.DefaultClient().Do(httpReq)
	connectMs := int(time.Since(connectStart).Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		// We return the response alongside the error so the failover
		// layer can read the status code. The caller MUST drain/close
		// the body when it discards the response.
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errBody = decompressBody(resp.Header, errBody)
		return &RelayResponse{
			StatusCode: resp.StatusCode,
			Headers:    flattenHeaders(resp.Header),
			Body:       resp.Body,
			ConnectMs:  connectMs,
		}, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
	}

	return &RelayResponse{
		StatusCode:  resp.StatusCode,
		Headers:     flattenHeaders(resp.Header),
		Body:        resp.Body,
		Usage:       nil,
		ConnectMs:   connectMs,
		FirstByteAt: connectStart,
	}, nil
}

// relayStreaming handles streaming (SSE) requests.
func (e *Engine) relayStreaming(ctx context.Context, url, key string, req *RelayRequest) (*RelayResponse, error) {
	bodyBytes, err := e.marshalRequestBody(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	e.setupUpstreamHeaders(httpReq, key, req)
	httpReq.Header.Set("Accept", "text/event-stream")

	connectStart := time.Now()
	resp, err := service.StreamingClient().Do(httpReq)
	connectMs := int(time.Since(connectStart).Milliseconds())
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errBody = decompressBody(resp.Header, errBody)
		return &RelayResponse{
			StatusCode: resp.StatusCode,
			Headers:    flattenHeaders(resp.Header),
			Body:       resp.Body,
			ConnectMs:  connectMs,
		}, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
	}

	return &RelayResponse{
		StatusCode:  resp.StatusCode,
		Headers:     flattenHeaders(resp.Header),
		Body:        resp.Body,
		ConnectMs:   connectMs,
		FirstByteAt: connectStart,
	}, nil
}

func (e *Engine) marshalRequestBody(req *RelayRequest) ([]byte, error) {
	if req.Body != nil {
		return json.Marshal(req.Body)
	}
	return json.Marshal(req)
}

func (e *Engine) setupUpstreamHeaders(httpReq *http.Request, key string, req *RelayRequest) {
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key)
	for k, v := range req.Headers {
		switch k {
		case "Authorization", "Content-Length", "Host", "Connection", "X-Hapiy-Source":
			continue
		case "Accept-Encoding":
			// Let Go negotiate encoding itself so it transparently
			// decompresses responses (manual br/zstd never is).
			continue
		default:
			httpReq.Header.Set(k, v)
		}
	}
}

// decompressBody transparently decompresses an upstream error body according
// to its Content-Encoding so error details stay readable. Go's stdlib only
// auto-decompresses gzip it requested itself; a forwarded Accept-Encoding of
// br/zstd leaves compressed binary bodies here.
func decompressBody(h http.Header, body []byte) []byte {
	switch strings.ToLower(strings.TrimSpace(h.Get("Content-Encoding"))) {
	case "gzip":
		r, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return body
		}
		out, err := io.ReadAll(io.LimitReader(r, 4096))
		if err != nil {
			return body
		}
		return out
	default:
		return body
	}
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, v := range h {
		if len(v) > 0 {
			out[k] = v[0]
		}
	}
	return out
}

// logDebug logs debug information.
func (e *Engine) logDebug(plan *ExecutionPlan, req *RelayRequest, resp *RelayResponse) {
	// TODO: Implement debug logging
}
