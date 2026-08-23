package relay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/topology"
)

// upstreamOutcome captures the failure signal from one upstream call so
// relayWithFailover can decide which failover rule (if any) applies.
type upstreamOutcome struct {
	statusCode int
	transport  bool // true: network/timeout/error; false: HTTP status
	err        error
	message    string
}

// isFailoverEligible returns true when the upstream outcome matches one
// of the plan's failover rules' conditions. The mapping is the user-
// approved contract:
//   - "timeout"   → network/transport error
//   - "error"     → any non-2xx response
//   - "rate_limit" → 429
func isFailoverEligible(outcome upstreamOutcome, rules []*model.FailoverRule) (string, bool) {
	for _, rule := range rules {
		if !ruleMatchesOutcome(rule, outcome) {
			continue
		}
		if rule.FallbackProvider == "" {
			continue
		}
		return rule.FallbackProvider, true
	}
	return "", false
}

// ruleMatchesOutcome checks a single rule's condition against the outcome.
func ruleMatchesOutcome(rule *model.FailoverRule, outcome upstreamOutcome) bool {
	if len(rule.Keywords) > 0 {
		for _, keyword := range rule.Keywords {
			if keyword != "" && strings.Contains(outcome.message, keyword) {
				return true
			}
		}
		return false
	}
	switch rule.Condition {
	case "timeout":
		return outcome.transport && outcome.err != nil
	case "rate_limit":
		return outcome.statusCode == 429
	case "error":
		return outcome.statusCode >= 400
	}
	return false
}

// classifyUpstreamError maps a raw upstream error to a transport-level
// error suitable for "timeout" / "error" / "rate_limit" matching.
func classifyUpstreamError(err error) upstreamOutcome {
	if err == nil {
		return upstreamOutcome{}
	}
	return upstreamOutcome{transport: true, err: err}
}

// resolveFallbackPlan looks up a fallback ExecutionPlan by provider name
// in the engine's live plans map. Returns nil if the named provider is
// not currently enabled (or doesn't exist). The engine retains the
// providersMu / plansMu lock here so the lookup is consistent with the
// snapshot the active request is using.
func (e *Engine) resolveFallbackPlan(name string) *ExecutionPlan {
	e.providersMu.RLock()
	defer e.providersMu.RUnlock()
	for _, plan := range e.plans {
		if plan.Provider.Name == name && !e.providerDisabled(plan.Provider) {
			return plan
		}
	}
	return nil
}

// relayWithFailover sends the request to upstream with automatic failover.
// On the first attempt, attempts the current plan. If the upstream
// outcome matches a failover rule's Condition and a fallback provider is
// resolvable, retries ONCE against the fallback's first base URL + key.
// Strict retry-once policy: no looping, no third try. If no fallback
// applies or no fallback provider is resolvable, returns the original
// error.
func (e *Engine) relayWithFailover(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	resp, err := e.performUpstreamCall(ctx, plan, req)
	if err == nil {
		return resp, nil
	}
	rule, matched := matchingFailoverRule(classifyOutcome(resp, err), plan.FailoverRules)
	if !matched {
		return resp, err
	}
	for _, action := range rule.Actions {
		if err := e.applyFailoverAction(plan, req, action); err != nil {
			return resp, err
		}
		switch action.Dimension {
		case model.FailoverDimensionBaseURL, model.FailoverDimensionKey:
			if rotated := e.rotateKeyOrBaseURL(ctx, plan, req, action.Dimension, action.RetryCount); rotated != nil {
				return rotated, nil
			}
		case model.FailoverDimensionProvider:
			fallbackPlan := e.resolveFallbackPlan(rule.FallbackProvider)
			if rule.FallbackProvider == "" {
				fallbackPlan = e.resolveTopologyFallbackPlan(req, plan)
			}
			if fallbackPlan == nil {
				continue
			}
			if resp != nil && resp.Body != nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
			return e.performUpstreamCall(ctx, fallbackPlan, req)
		}
	}
	return resp, err
}

func (e *Engine) resolveTopologyFallbackPlan(req *RelayRequest, failed *ExecutionPlan) *ExecutionPlan {
	if req.TopologyOrigin == nil || e.db == nil {
		return nil
	}
	tp, err := topology.NewStore(e.db).Load()
	if err != nil {
		return nil
	}
	refs := e.buildFlatProviderRefs()
	for _, candidate := range topology.FindProviderSlotAlternatives(tp, refs, req.Model, req.Path, req.TopologyOrigin.EntryID, req.TopologyOrigin.ProviderID) {
		if candidate.ProviderID == failed.Provider.ID {
			continue
		}
		provider, plan, err := e.buildPlanForProvider(candidate.ProviderID, candidate.Name, candidate.Chain)
		if err == nil && provider.ID != failed.Provider.ID && !e.providerDisabled(provider) && provider.Status && provider.WorkflowEnabled {
			return plan
		}
	}
	return nil
}

func matchingFailoverRule(outcome upstreamOutcome, rules []*model.FailoverRule) (*model.FailoverRule, bool) {
	for _, rule := range rules {
		if rule == nil || !ruleMatchesOutcome(rule, outcome) {
			continue
		}
		rule.Normalize()
		return rule, true
	}
	return nil, false
}

func (e *Engine) applyFailoverAction(plan *ExecutionPlan, req *RelayRequest, action model.FailoverAction) error {
	if plan.Provider == nil || e.db == nil {
		return nil
	}
	if !action.AutoDisable {
		return nil
	}
	value := ""
	switch action.Dimension {
	case model.FailoverDimensionBaseURL:
		value = pickIndex(plan.BaseURLs, req.BaseURLIndex)
	case model.FailoverDimensionKey:
		value = pickIndex(plan.Keys, req.KeyIndex)
	case model.FailoverDimensionProvider:
		value = plan.Provider.ID
	}
	if value == "" {
		return nil
	}
	state := model.ProviderDisableState{ProviderID: plan.Provider.ID, Dimension: action.Dimension, Value: value, Disabled: true}
	if err := e.db.Where(model.ProviderDisableState{ProviderID: state.ProviderID, Dimension: state.Dimension, Value: state.Value}).Assign(state).FirstOrCreate(&state).Error; err != nil {
		return err
	}
	if action.Dimension == model.FailoverDimensionProvider {
		if err := e.db.Model(&model.Provider{}).Where("id = ?", plan.Provider.ID).Update("auto_disabled", true).Error; err != nil {
			return err
		}
	}
	return nil
}

// rotateKeyOrBaseURL retries the request against another key or base URL of the
// same provider. It returns the response, or nil when nothing is left to try.
func (e *Engine) rotateKeyOrBaseURL(ctx context.Context, plan *ExecutionPlan, req *RelayRequest, dimension string, retryCount int) *RelayResponse {
	baseCount := len(plan.BaseURLs)
	keyCount := len(plan.Keys)
	if baseCount <= 0 || keyCount <= 0 || retryCount <= 0 {
		return nil
	}
	attempts := 0
	for bi := 0; bi < baseCount && attempts < retryCount; bi++ {
		for ki := 0; ki < keyCount; ki++ {
			if attempts >= retryCount {
				break
			}
			candidate := RelayRequest(*req)
			candidate.BaseURLIndex = bi
			candidate.KeyIndex = ki
			if dimension == model.FailoverDimensionBaseURL && bi == req.BaseURLIndex {
				continue
			}
			if dimension == model.FailoverDimensionKey && ki == req.KeyIndex {
				continue
			}
			if e.isDisabled(plan.Provider.ID, model.FailoverDimensionBaseURL, pickIndex(plan.BaseURLs, bi)) || e.isDisabled(plan.Provider.ID, model.FailoverDimensionKey, pickIndex(plan.Keys, ki)) {
				continue
			}
			attempts++
			resp, err := e.performUpstreamCall(ctx, plan, &candidate)
			if err == nil {
				return resp
			}
			if resp != nil && resp.Body != nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
		}
	}
	return nil
}

func (e *Engine) isDisabled(providerID, dimension, value string) bool {
	if e.db == nil || providerID == "" || value == "" {
		return false
	}
	if !e.db.Migrator().HasTable(&model.ProviderDisableState{}) {
		return false
	}
	var count int64
	if err := e.db.Model(&model.ProviderDisableState{}).Where("provider_id = ? AND dimension = ? AND value = ? AND disabled = ?", providerID, dimension, value, true).Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

// performUpstreamCall runs the request against the given plan and
// classifies the outcome (status vs transport error) for the caller.
func (e *Engine) performUpstreamCall(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	if len(plan.BaseURLs) == 0 {
		return nil, errors.New("no base URL configured")
	}
	if len(plan.Keys) == 0 {
		return nil, errors.New("no API key configured")
	}
	baseURLIndex := e.firstEnabledIndex(plan.Provider.ID, model.FailoverDimensionBaseURL, plan.BaseURLs, req.BaseURLIndex)
	if baseURLIndex < 0 {
		return nil, errors.New("no enabled base URL configured")
	}
	keyIndex := e.firstEnabledIndex(plan.Provider.ID, model.FailoverDimensionKey, plan.Keys, req.KeyIndex)
	if keyIndex < 0 {
		return nil, errors.New("no enabled API key configured")
	}
	upstreamURL := plan.BaseURLs[baseURLIndex]
	// Append the request path (e.g. "/v1/chat/completions") to the base URL.
	// When the base URL already contains a path segment (e.g. "/v1"), only
	// the suffix beyond that segment is appended so there is no duplication.
	if req.Path != "" {
		parsed, parseErr := url.Parse(upstreamURL)
		if parseErr == nil {
			suffix := strings.TrimPrefix(req.Path, parsed.Path)
			parsed = parsed.JoinPath(suffix)
			upstreamURL = parsed.String()
		}
	}
	key := plan.Keys[keyIndex]
	var resp *RelayResponse
	var err error
	if req.Stream {
		resp, err = e.relayStreaming(ctx, upstreamURL, key, req)
	} else {
		resp, err = e.relayNonStreaming(ctx, upstreamURL, key, req)
	}
	if resp == nil && err != nil {
		// Transport error before any HTTP response — synthesize a response
		// carrying just the URL so the log row records what was attempted.
		resp = &RelayResponse{UpstreamURL: upstreamURL}
	} else if resp != nil {
		resp.UpstreamURL = upstreamURL
	}
	return resp, err
}

func (e *Engine) firstEnabledIndex(providerID, dimension string, values []string, requested int) int {
	if requested >= 0 && requested < len(values) && !e.isDisabled(providerID, dimension, values[requested]) {
		return requested
	}
	for index, value := range values {
		if !e.isDisabled(providerID, dimension, value) {
			return index
		}
	}
	return -1
}

// pickIndex returns items[idx], falling back to the first when idx is invalid.
func pickIndex(items []string, idx int) string {
	if idx >= 0 && idx < len(items) {
		return items[idx]
	}
	return items[0]
}

// classifyOutcome collapses (resp, err) into a single upstreamOutcome
// suitable for failover matching. A non-nil resp with a status code
// indicates an HTTP error; a nil resp indicates a transport error.
func classifyOutcome(resp *RelayResponse, err error) upstreamOutcome {
	if resp != nil && resp.StatusCode != 0 {
		message := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if err != nil {
			message += ": " + err.Error()
		}
		return upstreamOutcome{statusCode: resp.StatusCode, err: err, message: message}
	}
	if err != nil {
		return upstreamOutcome{transport: true, err: err, message: err.Error()}
	}
	if resp == nil {
		return upstreamOutcome{transport: true, err: errors.New("nil response")}
	}
	return upstreamOutcome{statusCode: resp.StatusCode}
}

// maybeFailover returns the fallback plan when the outcome matches a
// failover rule and the named provider is currently enabled.
func (e *Engine) maybeFailover(plan *ExecutionPlan, outcome upstreamOutcome) (*ExecutionPlan, bool) {
	fallbackName, ok := isFailoverEligible(outcome, plan.FailoverRules)
	if !ok {
		return nil, false
	}
	fallback := e.resolveFallbackPlan(fallbackName)
	if fallback == nil {
		// Logically resolved the rule but the fallback provider is
		// disabled or missing — fall back to the original error.
		return nil, false
	}
	return fallback, true
}
