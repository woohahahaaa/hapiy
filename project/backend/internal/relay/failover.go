package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/publicFunction"
	"github.com/hapiy/hapiy/internal/service"
	"github.com/hapiy/hapiy/internal/topology"
	"gorm.io/gorm"
)

// upstreamOutcome captures the failure signal from one upstream call so
// relayWithFailover can decide which failover rule (if any) applies.
type upstreamOutcome struct {
	statusCode int
	transport  bool // true: network/timeout/error; false: HTTP status
	err        error
	message    string
	// ttfbExceeded 标记「请求本身成功，但响应头到达耗时超过了规则配置的
	// ttfb_seconds」。它作为规则内 OR 条件：命中即触发，不影响其他条件。
	ttfbExceeded bool
	ttfbMs       int
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
	// TTFB 是独立 OR 条件：只要规则配了 ttfb_seconds 且本次响应头超时，
	// 无论关键词/condition 是否命中都算匹配。
	if rule.TTFBSeconds > 0 && outcome.ttfbExceeded {
		return true
	}
	if len(rule.MatchPatterns) > 0 {
		for _, pattern := range rule.MatchPatterns {
			if pattern != "" && strings.Contains(outcome.message, pattern) {
				return true
			}
		}
		return false
	}
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
// outcome matches a failover rule, the rule's single action decides
// which dimension to rotate on and whether to auto-disable the
// originating entity. Each rule fires exactly one rotation.
//
// Auto-disable is gated by a consecutive-hit counter: the matched
// (provider, dimension, value) only gets disabled once it has been
// matched DisableThreshold times within DisableWindowMinutes (or on
// the very first match when the threshold is the legacy default of 1).
// A successful follow-up request on the same entity resets the count.
func (e *Engine) relayWithFailover(ctx context.Context, plan *ExecutionPlan, req *RelayRequest) (*RelayResponse, error) {
	resp, err := e.performUpstreamCall(ctx, plan, req)
	ttfbMs := 0
	if err == nil {
		// 请求本身成功了，但「首字节」超过某条规则的 ttfb_seconds 才到 →
		// 把它当成一次可转移的「慢响应」失败，进入 failover 判定。
		// 与自动恢复探针共用同一套首字节测量（publicfunction 包）。
		ttfbMs = e.ttfbForSlowUpstream(plan, resp)
		if ttfbMs == 0 {
			return resp, nil
		}
		err = fmt.Errorf("upstream first byte timeout after %dms", ttfbMs)
	}
	outcome := classifyOutcome(resp, err)
	if ttfbMs > 0 {
		outcome.ttfbExceeded = true
		outcome.ttfbMs = ttfbMs
		outcome.transport = true
		outcome.message = fmt.Sprintf("upstream first byte timeout after %dms", ttfbMs)
	}
	rule, matched := matchingFailoverRule(outcome, plan.FailoverRules)
	if !matched {
		return resp, err
	}
	dimension, autoDisable := rule.SingleAction()
	if dimension == "" {
		return resp, err
	}
	value := failoverActionValue(plan, req, dimension)
	hitReached := false
	if autoDisable && value != "" {
		_, hitReached = e.recordFailoverHit(plan.Provider.ID, dimension, value, rule)
	}
	disableApplied := false
	if hitReached {
		if applyErr := e.applyFailoverAction(plan, req, dimension, rule, outcome); applyErr != nil {
			log.Printf("relay: applyFailoverAction %s/%s: %v", plan.Provider.ID, dimension, applyErr)
		} else {
			disableApplied = true
			e.clearFailoverHit(plan.Provider.ID, dimension, value)
		}
	}
	switch dimension {
	case model.FailoverDimensionBaseURL, model.FailoverDimensionKey:
		if rotated, _ := e.rotateKeyOrBaseURL(ctx, plan, req, dimension, &disableApplied); rotated != nil {
			if disableApplied {
				e.recordDisabledAttempt(req, plan, err)
			}
			return rotated, nil
		}
	case model.FailoverDimensionProvider:
		fallbackPlan := e.resolveFallbackPlan(rule.FallbackProvider)
		if rule.FallbackProvider == "" {
			fallbackPlan = e.resolveTopologyFallbackPlan(req, plan)
		}
		if fallbackPlan != nil {
			if resp != nil && resp.Body != nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
			fbResp, fbErr := e.performUpstreamCall(ctx, fallbackPlan, req)
			if disableApplied {
				e.recordDisabledAttempt(req, plan, err)
			}
			if fbErr == nil {
				e.clearFailoverHit(plan.Provider.ID, dimension, value)
			}
			return fbResp, fbErr
		}
	}
	return resp, err
}

// RecordResponseSpeedOutcome feeds post-response speed violations into the
// failover hit counters. A slow response that already finished cannot be
// re-routed for this request, but the auto-disable machinery still protects
// future requests: every enabled rule with a speed limit counts one hit
// when the response speed (tokens/s over the full request, connect
// included) falls below the limit.
func (e *Engine) RecordResponseSpeedOutcome(plan *ExecutionPlan, req *RelayRequest, elapsedMs, totalTokens int) {
	if e == nil || e.db == nil || plan == nil || req == nil || elapsedMs <= 0 || totalTokens <= 0 {
		return
	}
	speed := float64(totalTokens) * 1000 / float64(elapsedMs)
	for _, rule := range plan.FailoverRules {
		if rule == nil || !rule.Status || rule.SpeedLimit <= 0 || speed >= float64(rule.SpeedLimit) {
			continue
		}
		dimension, autoDisable := rule.SingleAction()
		if dimension == "" {
			continue
		}
		value := failoverActionValue(plan, req, dimension)
		if value == "" {
			continue
		}
		hitReached := false
		if autoDisable {
			_, hitReached = e.recordFailoverHit(plan.Provider.ID, dimension, value, rule)
		}
		if hitReached {
			outcome := upstreamOutcome{
				message: fmt.Sprintf("响应速度 %.1f token/s 低于规则限制 %d token/s", speed, rule.SpeedLimit),
			}
			if err := e.applyFailoverAction(plan, req, dimension, rule, outcome); err != nil {
				log.Printf("relay: applyFailoverAction(speed) %s/%s: %v", plan.Provider.ID, dimension, err)
			}
		}
	}
}

// failoverActionValue mirrors the value lookup in applyFailoverAction
// so the hit counter tracks exactly the entity that would be disabled.
func failoverActionValue(plan *ExecutionPlan, req *RelayRequest, dimension string) string {
	if plan == nil || req == nil {
		return ""
	}
	switch dimension {
	case model.FailoverDimensionBaseURL:
		return pickIndex(plan.BaseURLs, req.BaseURLIndex)
	case model.FailoverDimensionKey:
		return pickIndex(plan.Keys, req.KeyIndex)
	case model.FailoverDimensionProvider:
		return plan.Provider.ID
	}
	return ""
}

// ttfbForSlowUpstream measures time-to-first-byte from the moment the
// upstream request was issued (resp.FirstByteAt), i.e. connection +
// response headers + first body byte — the same 口径 as the UI's 首字
// column and the recovery probe. Returns the latency in milliseconds when
// it exceeded a rule limit; 0 when the first byte arrived in time or no
// rule has a TTFB limit. The probe reader replaces resp.Body so the
// buffered first byte is still delivered to the consumer (handler
// forwarding / failover drain).
func (e *Engine) ttfbForSlowUpstream(plan *ExecutionPlan, resp *RelayResponse) int {
	if plan == nil || resp == nil || resp.Body == nil {
		return 0
	}
	limitSeconds := 0
	for _, rule := range plan.FailoverRules {
		if rule != nil && rule.Status && rule.TTFBSeconds > 0 {
			if limitSeconds == 0 || rule.TTFBSeconds < limitSeconds {
				limitSeconds = rule.TTFBSeconds
			}
		}
	}
	if limitSeconds == 0 {
		return 0
	}
	start := resp.FirstByteAt
	if start.IsZero() {
		start = time.Now()
	}
	limit := time.Duration(limitSeconds) * time.Second
	// 上游调用已结束（响应头已到）；如果从发请求算起已经超时，不用再等 body。
	if elapsed := time.Since(start); elapsed >= limit {
		return int(elapsed.Milliseconds())
	}
	probe := publicfunction.NewFirstByteProbeReader(resp.Body, start)
	resp.Body = probe
	if probe.WaitFirstByte(limit - time.Since(start)) {
		return 0
	}
	return int(time.Since(start).Milliseconds())
}

// recordFailoverHit increments the consecutive-match counter for
// (providerID, dimension, value) and reports whether DisableThreshold
// has been reached inside DisableWindowMinutes. A first hit seeds the
// counter; subsequent hits inside the window increment, and a hit
// outside the window resets the counter to 1.
func (e *Engine) recordFailoverHit(providerID, dimension, value string, rule *model.FailoverRule) (int, bool) {
	if e.db == nil || providerID == "" || dimension == "" || value == "" || rule == nil || !rule.AutoDisable {
		return 0, false
	}
	threshold := rule.DisableThreshold
	if threshold <= 0 {
		threshold = 1
	}
	window := rule.DisableWindowMinutes
	if window < 0 {
		window = 0
	}
	now := time.Now()

	var counter model.FailoverHitCounter
	err := e.db.Where("provider_id = ? AND dimension = ? AND value = ?", providerID, dimension, value).First(&counter).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		counter = model.FailoverHitCounter{
			ProviderID: providerID, Dimension: dimension, Value: value,
			HitCount: 1, FirstHitAt: now, LastHitAt: now,
		}
		if createErr := e.db.Create(&counter).Error; createErr != nil {
			log.Printf("relay: create failover hit counter: %v", createErr)
			return 0, false
		}
		return 1, threshold <= 1
	}
	if err != nil {
		log.Printf("relay: load failover hit counter: %v", err)
		return 0, false
	}

	withinWindow := window == 0 || counter.FirstHitAt.IsZero() || now.Sub(counter.FirstHitAt) <= time.Duration(window)*time.Minute
	if withinWindow {
		counter.HitCount++
	} else {
		counter.HitCount = 1
		counter.FirstHitAt = now
	}
	counter.LastHitAt = now
	if saveErr := e.db.Save(&counter).Error; saveErr != nil {
		log.Printf("relay: save failover hit counter: %v", saveErr)
		return 0, false
	}
	return counter.HitCount, counter.HitCount >= threshold
}

// clearFailoverHit removes the counter so the next failure restarts at 1.
func (e *Engine) clearFailoverHit(providerID, dimension, value string) {
	if e.db == nil || providerID == "" || dimension == "" || value == "" {
		return
	}
	if err := e.db.Where("provider_id = ? AND dimension = ? AND value = ?", providerID, dimension, value).
		Delete(&model.FailoverHitCounter{}).Error; err != nil {
		log.Printf("relay: clear failover hit counter: %v", err)
	}
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
	var bodyBytes []byte
	if req.Body != nil {
		if b, err := json.Marshal(req.Body); err == nil {
			bodyBytes = b
		}
	}
	eval := switchEvalFor(req.Headers, bodyBytes)
	for _, candidate := range topology.FindProviderSlotAlternatives(tp, refs, req.Model, req.Path, req.TopologyOrigin.EntryID, req.TopologyOrigin.ProviderID, eval) {
		if candidate.ProviderID == failed.Provider.ID {
			continue
		}
		provider, plan, err := e.buildPlanForProvider(candidate.ProviderID, candidate.Name, candidate.Chain, candidate.SlotNodeIDs)
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

func (e *Engine) applyFailoverAction(plan *ExecutionPlan, req *RelayRequest, dimension string, rule *model.FailoverRule, outcome upstreamOutcome) error {
	if plan.Provider == nil || e.db == nil {
		return nil
	}
	value := ""
	switch dimension {
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
	state := model.AutoDisableState{ProviderID: plan.Provider.ID, Dimension: dimension, Value: value, Disabled: true}
	if err := e.db.Where(model.AutoDisableState{ProviderID: state.ProviderID, Dimension: state.Dimension, Value: state.Value}).Assign(state).FirstOrCreate(&state).Error; err != nil {
		return err
	}
	// 记录当时实际用过的 (baseURL, key)，恢复探针用它，不做 harness 交叉。
	usedBaseURL := pickIndex(plan.BaseURLs, req.BaseURLIndex)
	usedKey := pickIndex(plan.Keys, req.KeyIndex)
	e.saveDisabledRecord(plan.Provider.ID, dimension, value, usedBaseURL, usedKey, req, "", rule)
	service.LogEvent(service.LogSourceChannelDisabled, plan.Provider.Name, service.ChannelEventMessage(dimension, value), failoverEventDetail(rule, dimension, outcome))
	return nil
}

func failoverEventDetail(rule *model.FailoverRule, dimension string, outcome upstreamOutcome) string {
	if rule == nil {
		return ""
	}
	lines := []string{"规则: " + rule.Name}
	dimLabel := service.DimensionLabel(dimension)
	if dimLabel != "" {
		lines = append(lines, "禁用维度: "+dimLabel)
	}
	var cond string
	switch {
	case rule.TTFBSeconds > 0 && outcome.ttfbExceeded:
		if outcome.ttfbMs > 0 {
			cond = fmt.Sprintf("首字速度不满足（实测 %dms，阈值 %ds）", outcome.ttfbMs, rule.TTFBSeconds)
		} else {
			cond = fmt.Sprintf("首字速度不满足（阈值 %ds）", rule.TTFBSeconds)
		}
	case len(rule.MatchPatterns) > 0:
		for _, p := range rule.MatchPatterns {
			if p != "" && strings.Contains(outcome.message, p) {
				cond = "命中响应字段: " + p
				break
			}
		}
	case len(rule.Keywords) > 0:
		for _, k := range rule.Keywords {
			if k != "" && strings.Contains(outcome.message, k) {
				cond = "命中关键词: " + k
				break
			}
		}
	default:
		switch rule.Condition {
		case "timeout":
			if outcome.transport {
				cond = "传输层超时"
			}
		case "rate_limit":
			cond = "状态码 429（限流）"
		case "error":
			cond = fmt.Sprintf("HTTP 错误（实际 %d）", outcome.statusCode)
		}
	}
	if cond != "" {
		lines = append(lines, "触发条件: "+cond)
	}
	return strings.Join(lines, "\n")
}

// recordDisabledAttempt queues a "failed" usage-log row for the upstream
// attempt whose failure triggered an auto-disable. Without it a request
// that recovers via key/BaseURL rotation or a fallback provider only
// produces the final success row, and the upstream error behind the
// disable event is lost from the 使用记录. The handler still writes the
// final row (success, or the fallback's failure); this row carries the
// original error. Callers must skip it when the original error is the
// final error the handler logs (the relayWithFailover tail return).
func (e *Engine) recordDisabledAttempt(req *RelayRequest, plan *ExecutionPlan, failErr error) {
	service.LogRelayFailure(service.LogRelayFailureInput{
		UserID:       req.UserID,
		TokenName:    req.TokenName,
		ProviderName: plan.Provider.Name,
		ModelName:    req.Model,
		RequestID:    req.RequestID,
		IP:           req.IP,
		Error:        failErr,
	})
}

// rotateKeyOrBaseURL retries the request against every other key or
// base URL of the same provider. It returns the first successful
// response, or nil when nothing is left to try.
func (e *Engine) rotateKeyOrBaseURL(ctx context.Context, plan *ExecutionPlan, req *RelayRequest, dimension string, disabledThisRequest *bool) (*RelayResponse, bool) {
	baseCount := len(plan.BaseURLs)
	keyCount := len(plan.Keys)
	if baseCount <= 0 || keyCount <= 0 {
		return nil, false
	}
	for bi := 0; bi < baseCount; bi++ {
		for ki := 0; ki < keyCount; ki++ {
			if dimension == model.FailoverDimensionBaseURL && bi == req.BaseURLIndex {
				continue
			}
			if dimension == model.FailoverDimensionKey && ki == req.KeyIndex {
				continue
			}
			if e.isDisabled(plan.Provider.ID, model.FailoverDimensionBaseURL, pickIndex(plan.BaseURLs, bi)) || e.isDisabled(plan.Provider.ID, model.FailoverDimensionKey, pickIndex(plan.Keys, ki)) {
				continue
			}
			candidate := RelayRequest(*req)
			candidate.BaseURLIndex = bi
			candidate.KeyIndex = ki
			resp, err := e.performUpstreamCall(ctx, plan, &candidate)
			if err == nil {
				return resp, false
			}
			outcome := classifyOutcome(resp, err)
			if disabledThisRequest == nil || !*disabledThisRequest {
				if rule, matched := matchingFailoverRule(outcome, plan.FailoverRules); matched {
					rotatedDimension, autoDisable := rule.SingleAction()
					if autoDisable && rotatedDimension == dimension {
						value := failoverActionValue(plan, &candidate, dimension)
						if _, reached := e.recordFailoverHit(plan.Provider.ID, dimension, value, rule); reached && (disabledThisRequest == nil || !*disabledThisRequest) {
							if applyErr := e.applyFailoverAction(plan, &candidate, dimension, rule, outcome); applyErr != nil {
								log.Printf("relay: applyFailoverAction rotated %s/%s: %v", plan.Provider.ID, dimension, applyErr)
							} else {
								e.clearFailoverHit(plan.Provider.ID, dimension, value)
								if disabledThisRequest != nil {
									*disabledThisRequest = true
								}
							}
						}
					}
				}
			}
			if resp != nil && resp.Body != nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
		}
	}
	return nil, false
}

func (e *Engine) isDisabled(providerID, dimension, value string) bool {
	if e.db == nil || providerID == "" || value == "" {
		return false
	}
	var count int64
	if err := e.db.Model(&model.AutoDisableState{}).Where("provider_id = ? AND dimension = ? AND value = ? AND disabled = ?", providerID, dimension, value, true).Count(&count).Error; err != nil {
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
	// Write back the resolved indices so the caller (recordFallbackChannel)
	// records the channel that was actually used instead of the -1 "rotate"
	// placeholder carried by normal weighted selection.
	req.BaseURLIndex = baseURLIndex
	req.KeyIndex = keyIndex
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
