package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
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

// InvalidatePlan forces recompilation of a provider's execution plan
func (e *Engine) InvalidatePlan(providerID string) {
	p, err := e.GetProvider(providerID)
	if err != nil {
		return
	}
	e.compilePlan(p)
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

// SelectProvider selects a provider for the given model using round-robin
// with weight. The model membership check uses the pre-parsed ModelSet
// populated during plan compilation — no per-request JSON unmarshalling.
func (e *Engine) SelectProvider(modelName string) (*model.Provider, error) {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()

	var candidates []*model.Provider
	for _, plan := range e.plans {
		if plan.Provider == nil {
			continue
		}
		if !plan.Provider.Status || !plan.Provider.WorkflowEnabled {
			continue
		}
		if _, ok := plan.ModelSet[modelName]; ok {
			candidates = append(candidates, plan.Provider)
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no provider available for model %s", modelName)
	}

	// Simple round-robin (TODO: implement weighted selection)
	return candidates[0], nil
}

// RelayRequest represents an incoming request from the handler.
type RelayRequest struct {
	// RequestID is the per-request correlation id set by the middleware
	// (X-Request-ID). It is propagated into topologyStageEvent so the
	// future SSE stage fan-out can group events by request.
	RequestID string `json:"-"`
	// UserID and TokenID are populated by the handler so concurrency
	// rules with scope=per_user / per_token can key their waitlists.
	UserID string `json:"-"`
	TokenID string `json:"-"`
	// Model is the literal user-supplied model name (e.g. "gpt-4").
	Model       string                   `json:"model"`
	Messages    []map[string]interface{} `json:"messages,omitempty"`
	Stream      bool                     `json:"stream,omitempty"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Temperature float64                  `json:"temperature,omitempty"`
	Body        map[string]interface{}   `json:"-"` // Full request body
	Headers     map[string]string        `json:"-"`
}

// RelayResponse represents the upstream response.
type RelayResponse struct {
	StatusCode int
	Headers    map[string]string
	Body       io.ReadCloser
	Usage      *UsageInfo
}

// UsageInfo tracks token usage.
type UsageInfo struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// RelayRequest executes the request through the compiled pipeline.
// Pipeline order (fixed, not configurable):
//  1. Concurrency control
//  2. Request logging and rewrite
//  3. Relay to upstream (with failover)
//  4. Response logging and rewrite
//  5. Heartbeat monitoring (response wrapping)
//  6. Debug logging
func (e *Engine) RelayRequest(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Step 1: Concurrency control. The release func MUST be called on
	// every exit path so we wrap the rest of the pipeline in a closure
	// that defers release before returning.
	var releaseConcurrency func()
	if plan.ConcurrencyRule != nil {
		rel, err := e.checkConcurrency(ctx, plan.ConcurrencyRule, req)
		if err != nil {
			return nil, err
		}
		releaseConcurrency = rel
	}
	if releaseConcurrency != nil {
		defer releaseConcurrency()
	}

	// Step 2: Request logging and rewrite
	e.runTopologyLogOutputs(topologyStageRequestBefore, plan.LogOutputs, plan, req, nil)
	if len(plan.CompiledRewrite) > 0 {
		if err := e.applyCompiledRewriteRules(plan, req); err != nil {
			return nil, err
		}
	}
	e.runTopologyLogOutputs(topologyStageRequestAfter, plan.LogOutputs, plan, req, nil)

	// Step 3: Relay to upstream (with failover). The "relay" stage fires
	// here so a future UI can light up the provider node as the request
	// hits the network.
	e.recordTopologyStage(topologyStageEvent{
		Stage:      topologyStageRelay,
		ProviderID: plan.ID,
		RequestID:  req.RequestID,
	})
	resp, err := e.relayWithFailover(ctx, plan, req)
	if err != nil {
		return nil, err
	}

	// Step 4: Response logging and rewrite. Per the deliberate design
	// decision, streaming bodies are never buffered for response rewrite:
	// the stage event is recorded but the body is forwarded as-is.
	e.runTopologyLogOutputs(topologyStageResponseBefore, plan.LogOutputs, plan, req, resp)
	if !req.Stream && len(plan.CompiledResponseRewrites) > 0 {
		if err := e.applyCompiledResponseRewriteRules(plan, resp); err != nil {
			return nil, err
		}
	}
	e.recordTopologyStage(topologyStageEvent{
		Stage:                topologyStageResponseRewrite,
		ProviderID:           plan.ID,
		RequestID:            req.RequestID,
		ResponseRewriteRules: plan.ResponseRewriteRules,
	})
	e.runTopologyLogOutputs(topologyStageResponseAfter, plan.LogOutputs, plan, req, resp)

	// Step 5: Heartbeat monitoring (if streaming). Always returns resp
	// (possibly with a wrapped body); on failure to wrap we keep the
	// original body so the stream is never corrupted.
	if plan.HeartbeatRule != nil && req.Stream {
		resp = e.wrapWithHeartbeat(resp, plan.HeartbeatRule, req)
	}

	// Step 6: Debug logging
	if plan.DebugEnabled {
		e.logDebug(plan, req, resp)
	}

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

// runTopologyLogOutputs is a deterministic no-op until log output
// backends exist. It records a stage event so consumers can see which
// log outputs were selected for each stage.
func (e *Engine) runTopologyLogOutputs(stage topologyStage, assignments []LogOutputAssignment, plan *ExecutionPlan, req *RelayRequest, resp *RelayResponse) {
	_ = resp
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

	resp, err := service.DefaultClient().Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		// We return the response alongside the error so the failover
		// layer can read the status code. The caller MUST drain/close
		// the body when it discards the response.
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &RelayResponse{
			StatusCode: resp.StatusCode,
			Headers:    flattenHeaders(resp.Header),
			Body:       resp.Body,
		}, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
	}

	return &RelayResponse{
		StatusCode: resp.StatusCode,
		Headers:    flattenHeaders(resp.Header),
		Body:       resp.Body,
		Usage:      nil,
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

	resp, err := service.StreamingClient().Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("upstream request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &RelayResponse{
			StatusCode: resp.StatusCode,
			Headers:    flattenHeaders(resp.Header),
			Body:       resp.Body,
		}, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
	}

	return &RelayResponse{
		StatusCode: resp.StatusCode,
		Headers:    flattenHeaders(resp.Header),
		Body:       resp.Body,
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
		case "Authorization", "Content-Length", "Host", "Connection":
			continue
		default:
			httpReq.Header.Set(k, v)
		}
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
