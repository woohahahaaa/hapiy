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

// SelectProvider selects a provider for the given model using round-robin with weight
func (e *Engine) SelectProvider(modelName string) (*model.Provider, error) {
	e.providersMu.RLock()
	defer e.providersMu.RUnlock()

	var candidates []*model.Provider
	for _, p := range e.providers {
		if !p.Status {
			continue
		}

		// Check if provider supports the model
		var models []map[string]interface{}
		if err := json.Unmarshal([]byte(p.Models), &models); err != nil {
			continue
		}

		for _, m := range models {
			if name, ok := m["model"].(string); ok && name == modelName {
				candidates = append(candidates, p)
				break
			}
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no provider available for model %s", modelName)
	}

	// Simple round-robin (TODO: implement weighted selection)
	return candidates[0], nil
}

// RelayRequest executes the request through the compiled pipeline
func (e *Engine) RelayRequest(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Pipeline order (fixed, not configurable):
	// 1. Concurrency control
	// 2. Request logging and rewrite
	// 3. Relay to upstream (with failover)
	// 4. Response logging and rewrite
	// 5. Heartbeat monitoring (response wrapping)
	// 6. Debug logging

	// Step 1: Concurrency control
	if plan.ConcurrencyRule != nil {
		if err := e.checkConcurrency(plan.ConcurrencyRule, req); err != nil {
			return nil, err
		}
	}

	// Step 2: Request logging and rewrite
	e.runTopologyLogOutputs(topologyStageRequestBefore, plan.LogOutputs, req, nil)
	if len(plan.RewriteRules) > 0 {
		if err := e.applyRewriteRules(plan.RewriteRules, req); err != nil {
			return nil, err
		}
	}
	e.runTopologyLogOutputs(topologyStageRequestAfter, plan.LogOutputs, req, nil)

	// Step 3: Relay to upstream (with failover)
	resp, err := e.relayWithFailover(ctx, plan, req)
	if err != nil {
		return nil, err
	}

	// Step 4: Response logging and rewrite
	e.runTopologyLogOutputs(topologyStageResponseBefore, plan.LogOutputs, req, resp)
	if len(plan.ResponseRewriteRules) > 0 {
		e.applyResponseRewriteRules(plan.ResponseRewriteRules, resp)
	}
	e.runTopologyLogOutputs(topologyStageResponseAfter, plan.LogOutputs, req, resp)

	// Step 5: Heartbeat monitoring (if streaming)
	if plan.HeartbeatRule != nil && req.Stream {
		resp = e.wrapWithHeartbeat(resp, plan.HeartbeatRule)
	}

	// Step 6: Debug logging
	if plan.DebugEnabled {
		e.logDebug(plan, req, resp)
	}

	return resp, nil
}

// RelayRequest represents an incoming request
type RelayRequest struct {
	Model       string                   `json:"model"`
	Messages    []map[string]interface{} `json:"messages,omitempty"`
	Stream      bool                     `json:"stream,omitempty"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Temperature float64                  `json:"temperature,omitempty"`
	Body        map[string]interface{}   `json:"-"` // Full request body
	Headers     map[string]string        `json:"-"`
}

// RelayResponse represents the upstream response
type RelayResponse struct {
	StatusCode int
	Headers    map[string]string
	Body       io.ReadCloser
	Usage      *UsageInfo
}

// UsageInfo tracks token usage
type UsageInfo struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// checkConcurrency implements concurrency control
func (e *Engine) checkConcurrency(rule *model.ConcurrencyRule, req *RelayRequest) error {
	// TODO: Implement actual concurrency limiting with queueing
	// For now, just a placeholder
	return nil
}

// applyRewriteRules modifies the request based on rewrite rules
func (e *Engine) applyRewriteRules(rules []*model.RewriteRule, req *RelayRequest) error {
	// TODO: Implement DSL parser and executor
	// For now, just a placeholder
	return nil
}

// applyResponseRewriteRules is a deterministic no-op until the response DSL exists.
// It deliberately does not read or replace the response body to preserve streaming.
func (e *Engine) applyResponseRewriteRules(rules []*model.ResponseRewriteRule, resp *RelayResponse) {
	_ = resp
	e.recordTopologyStage(topologyStageEvent{Stage: topologyStageResponseRewrite, ResponseRewriteRules: rules})
}

// runTopologyLogOutputs is a deterministic no-op until log output backends exist.
func (e *Engine) runTopologyLogOutputs(stage topologyStage, assignments []LogOutputAssignment, req *RelayRequest, resp *RelayResponse) {
	_ = req
	_ = resp
	if len(assignments) == 0 {
		return
	}
	e.recordTopologyStage(topologyStageEvent{Stage: stage, LogOutputs: assignments})
}

func (e *Engine) recordTopologyStage(event topologyStageEvent) {
	if e.topologyStageHook != nil {
		e.topologyStageHook(event)
	}
}

// relayWithFailover sends the request to upstream with automatic failover
func (e *Engine) relayWithFailover(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Get provider configuration
	var baseURLs []string
	if err := json.Unmarshal([]byte(plan.Provider.BaseURLs), &baseURLs); err != nil {
		return nil, err
	}
	if len(baseURLs) == 0 {
		return nil, errors.New("no base URL configured")
	}

	var keys []string
	if err := json.Unmarshal([]byte(plan.Provider.Keys), &keys); err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, errors.New("no API key configured")
	}

	// Build upstream request
	upstreamURL := baseURLs[0] // TODO: Round-robin multiple URLs
	if req.Stream {
		// Handle streaming request
		return e.relayStreaming(ctx, upstreamURL, keys[0], req)
	}

	// Handle non-streaming request
	return e.relayNonStreaming(ctx, upstreamURL, keys[0], req)
}

// relayNonStreaming handles non-streaming requests
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
		defer resp.Body.Close()
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
	}

	return &RelayResponse{
		StatusCode: resp.StatusCode,
		Headers:    flattenHeaders(resp.Header),
		Body:       resp.Body,
		Usage:      nil,
	}, nil
}

// relayStreaming handles streaming (SSE) requests
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
		defer resp.Body.Close()
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(errBody))
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

// wrapWithHeartbeat wraps the response with heartbeat injection
func (e *Engine) wrapWithHeartbeat(resp *RelayResponse, rule *model.HeartbeatRule) *RelayResponse {
	// TODO: Implement heartbeat injection for SSE streams
	return resp
}

// logDebug logs debug information
func (e *Engine) logDebug(plan *ExecutionPlan, req *RelayRequest, resp *RelayResponse) {
	// TODO: Implement debug logging
}
