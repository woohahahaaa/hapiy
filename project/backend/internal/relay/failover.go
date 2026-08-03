package relay

import (
	"context"
	"errors"
	"io"

	"github.com/hapiy/hapiy/internal/model"
)

// upstreamOutcome captures the failure signal from one upstream call so
// relayWithFailover can decide which failover rule (if any) applies.
type upstreamOutcome struct {
	statusCode int
	transport  bool // true: network/timeout/error; false: HTTP status
	err        error
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
		if plan.Provider.Name == name {
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
	fallbackPlan, fallback := e.maybeFailover(plan, classifyOutcome(resp, err))
	if !fallback {
		return resp, err
	}
	if resp != nil && resp.Body != nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	if plan.Provider != nil && plan.Provider.ID != "" && e.db != nil {
		e.db.Model(&model.Provider{}).Where("id = ?", plan.Provider.ID).
			Update("auto_disabled", true)
	}
	return e.performUpstreamCall(ctx, fallbackPlan, req)
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
	upstreamURL := plan.BaseURLs[0]
	key := plan.Keys[0]
	if req.Stream {
		return e.relayStreaming(ctx, upstreamURL, key, req)
	}
	return e.relayNonStreaming(ctx, upstreamURL, key, req)
}

// classifyOutcome collapses (resp, err) into a single upstreamOutcome
// suitable for failover matching. A non-nil resp with a status code
// indicates an HTTP error; a nil resp indicates a transport error.
func classifyOutcome(resp *RelayResponse, err error) upstreamOutcome {
	if resp != nil && resp.StatusCode != 0 {
		return upstreamOutcome{statusCode: resp.StatusCode, err: err}
	}
	if err != nil {
		return upstreamOutcome{transport: true, err: err}
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
