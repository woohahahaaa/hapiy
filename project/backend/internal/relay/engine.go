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
	"sync"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gorm.io/gorm"
)

// ExecutionPlan represents a compiled request processing pipeline
type ExecutionPlan struct {
	ID             string
	Channel        *model.Channel
	RewriteRules   []*model.RewriteRule
	HeartbeatRule  *model.HeartbeatRule
	ConcurrencyRule *model.ConcurrencyRule
	FailoverRules  []*model.FailoverRule
	DebugEnabled   bool
	DebugFields    []string
}

// Engine manages channel configurations and compiled execution plans
type Engine struct {
	db       *gorm.DB
	channels map[string]*model.Channel
	plans    map[string]*ExecutionPlan // key: channelID
	plansMu  sync.RWMutex
	channelsMu sync.RWMutex
	stopCh   chan struct{}
}

func NewEngine(db *gorm.DB) *Engine {
	return &Engine{
		db:       db,
		channels: make(map[string]*model.Channel),
		plans:    make(map[string]*ExecutionPlan),
		stopCh:   make(chan struct{}),
	}
}

// LoadChannels loads all enabled channels from database and compiles execution plans.
// It rebuilds the cache from scratch so that disabled or deleted channels are dropped
// from in-memory state without waiting for a process restart.
func (e *Engine) LoadChannels() error {
	var channels []model.Channel
	if err := e.db.Where("status = ?", true).Find(&channels).Error; err != nil {
		return err
	}

	fresh := make(map[string]*model.Channel, len(channels))
	for i := range channels {
		fresh[channels[i].ID] = &channels[i]
	}

	e.channelsMu.Lock()
	e.channels = fresh
	e.channelsMu.Unlock()

	freshPlans := make(map[string]*ExecutionPlan, len(channels))
	for i := range channels {
		ch := channels[i]
		plan := &ExecutionPlan{ID: ch.ID, Channel: &ch}
		if err := e.populatePlan(plan); err != nil {
			log.Printf("Failed to compile plan for channel %s: %v", ch.Name, err)
			continue
		}
		freshPlans[ch.ID] = plan
	}

	e.plansMu.Lock()
	e.plans = freshPlans
	e.plansMu.Unlock()

	return nil
}

// SyncLoop periodically reloads channel configuration (hot reload)
func (e *Engine) SyncLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := e.LoadChannels(); err != nil {
				log.Printf("Failed to sync channels: %v", err)
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

// GetChannel retrieves a channel by ID
func (e *Engine) GetChannel(id string) (*model.Channel, error) {
	e.channelsMu.RLock()
	defer e.channelsMu.RUnlock()
	ch, ok := e.channels[id]
	if !ok {
		return nil, errors.New("channel not found")
	}
	return ch, nil
}

// GetPlan retrieves the compiled execution plan for a channel
func (e *Engine) GetPlan(channelID string) (*ExecutionPlan, error) {
	e.plansMu.RLock()
	defer e.plansMu.RUnlock()
	plan, ok := e.plans[channelID]
	if !ok {
		return nil, errors.New("plan not found")
	}
	return plan, nil
}

// InvalidatePlan forces recompilation of a channel's execution plan
func (e *Engine) InvalidatePlan(channelID string) {
	e.plansMu.Lock()
	delete(e.plans, channelID)
	e.plansMu.Unlock()

	ch, err := e.GetChannel(channelID)
	if err != nil {
		return
	}
	e.compilePlan(ch)
}

// compilePlan builds an execution plan from channel configuration
func (e *Engine) compilePlan(ch *model.Channel) error {
	plan := &ExecutionPlan{
		ID:      ch.ID,
		Channel: ch,
	}
	if err := e.populatePlan(plan); err != nil {
		return err
	}

	e.plansMu.Lock()
	e.plans[ch.ID] = plan
	e.plansMu.Unlock()

	return nil
}

func (e *Engine) populatePlan(plan *ExecutionPlan) error {
	var rewriteRules []model.RewriteRule
	e.db.Where("status = ?", true).Find(&rewriteRules)
	plan.RewriteRules = make([]*model.RewriteRule, 0)
	for i := range rewriteRules {
		plan.RewriteRules = append(plan.RewriteRules, &rewriteRules[i])
	}

	var heartbeatRules []model.HeartbeatRule
	e.db.Where("status = ?", true).First(&heartbeatRules)
	if len(heartbeatRules) > 0 {
		plan.HeartbeatRule = &heartbeatRules[0]
	}

	var concurrencyRules []model.ConcurrencyRule
	e.db.Where("status = ?", true).First(&concurrencyRules)
	if len(concurrencyRules) > 0 {
		plan.ConcurrencyRule = &concurrencyRules[0]
	}

	var failoverRules []model.FailoverRule
	e.db.Where("status = ? AND primary_channel = ?", true, plan.Channel.Name).Find(&failoverRules)
	plan.FailoverRules = make([]*model.FailoverRule, 0)
	for i := range failoverRules {
		plan.FailoverRules = append(plan.FailoverRules, &failoverRules[i])
	}

	plan.DebugEnabled = false

	return nil
}

// SelectChannel selects a channel for the given model using round-robin with weight
func (e *Engine) SelectChannel(modelName string) (*model.Channel, error) {
	e.channelsMu.RLock()
	defer e.channelsMu.RUnlock()

	var candidates []*model.Channel
	for _, ch := range e.channels {
		if !ch.Status {
			continue
		}

		// Check if channel supports the model
		var models []map[string]interface{}
		if err := json.Unmarshal([]byte(ch.Models), &models); err != nil {
			continue
		}

		for _, m := range models {
			if name, ok := m["model"].(string); ok && name == modelName {
				candidates = append(candidates, ch)
				break
			}
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no channel available for model %s", modelName)
	}

	// Simple round-robin (TODO: implement weighted selection)
	return candidates[0], nil
}

// RelayRequest executes the request through the compiled pipeline
func (e *Engine) RelayRequest(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Pipeline order (fixed, not configurable):
	// 1. Concurrency control
	// 2. Request rewrite
	// 3. Relay to upstream (with failover)
	// 4. Heartbeat monitoring (response wrapping)
	// 5. Debug logging

	// Step 1: Concurrency control
	if plan.ConcurrencyRule != nil {
		if err := e.checkConcurrency(plan.ConcurrencyRule, req); err != nil {
			return nil, err
		}
	}

	// Step 2: Request rewrite
	if len(plan.RewriteRules) > 0 {
		if err := e.applyRewriteRules(plan.RewriteRules, req); err != nil {
			return nil, err
		}
	}

	// Step 3: Relay to upstream (with failover)
	resp, err := e.relayWithFailover(ctx, plan, req)
	if err != nil {
		return nil, err
	}

	// Step 4: Heartbeat monitoring (if streaming)
	if plan.HeartbeatRule != nil && req.Stream {
		resp = e.wrapWithHeartbeat(resp, plan.HeartbeatRule)
	}

	// Step 5: Debug logging
	if plan.DebugEnabled {
		e.logDebug(plan, req, resp)
	}

	return resp, nil
}

// RelayRequest represents an incoming request
type RelayRequest struct {
	Model       string                 `json:"model"`
	Messages    []map[string]interface{} `json:"messages,omitempty"`
	Stream      bool                   `json:"stream,omitempty"`
	MaxTokens   int                    `json:"max_tokens,omitempty"`
	Temperature float64                `json:"temperature,omitempty"`
	Body        map[string]interface{} `json:"-"` // Full request body
	Headers     map[string]string      `json:"-"`
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

// relayWithFailover sends the request to upstream with automatic failover
func (e *Engine) relayWithFailover(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	// Get channel configuration
	var baseURLs []string
	if err := json.Unmarshal([]byte(plan.Channel.BaseURLs), &baseURLs); err != nil {
		return nil, err
	}
	if len(baseURLs) == 0 {
		return nil, errors.New("no base URL configured")
	}

	var keys []string
	if err := json.Unmarshal([]byte(plan.Channel.Keys), &keys); err != nil {
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
