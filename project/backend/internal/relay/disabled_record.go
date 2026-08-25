package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
)

const (
	// compactStringMaxLen caps a single string field in the request body
	// before we collapse it to "你好". Above this length the user's
	// content is unlikely to affect upstream behavior but it bloats
	// the replay payload.
	compactStringMaxLen = 30
	// compactArrayMaxLen caps array elements we copy through.
	compactArrayMaxLen = 3
)

// compactBody returns a JSON string with the same shape as the original
// body but with long strings replaced by "你好" and oversized arrays
// truncated. The structure is preserved so a replay upstream gets the
// same field paths and types it would have gotten originally.
func compactBody(body map[string]interface{}) string {
	if len(body) == 0 {
		return ""
	}
	compacted := compactValue(body)
	raw, err := json.Marshal(compacted)
	if err != nil {
		return ""
	}
	return string(raw)
}

func compactValue(v interface{}) interface{} {
	switch val := v.(type) {
	case string:
		if len(val) > compactStringMaxLen {
			return "你好"
		}
		return val
	case []interface{}:
		if len(val) > compactArrayMaxLen {
			truncated := make([]interface{}, 0, compactArrayMaxLen+1)
			for i := 0; i < compactArrayMaxLen; i++ {
				truncated = append(truncated, compactValue(val[i]))
			}
			truncated = append(truncated, "...")
			return truncated
		}
		out := make([]interface{}, len(val))
		for i, item := range val {
			out[i] = compactValue(item)
		}
		return out
	case map[string]interface{}:
		out := make(map[string]interface{}, len(val))
		for k, item := range val {
			out[k] = compactValue(item)
		}
		return out
	default:
		return v
	}
}

// saveDisabledRecord persists (or refreshes) a DisabledRecord row for the
// entity that just got auto-disabled. The unique index on
// (provider_id, dimension, value) ensures we never create duplicates —
// a second disable of the same entity overwrites the previous row's
// request snapshot and resets retry counters.
func (e *Engine) saveDisabledRecord(providerID, dimension, value string, req *RelayRequest, errMsg string) {
	if e.db == nil || req == nil {
		return
	}
	headersJSON, err := json.Marshal(req.Headers)
	if err != nil {
		log.Printf("relay: marshal disabled-record headers: %v", err)
		return
	}
	bodyJSON := compactBody(req.Body)
	// Apply the configured recovery rewrite to the recorded body BEFORE
	// compaction, so the stored payload already reflects the user's
	// field delete/replace rules (smaller rows; the replay then uses the
	// stored body as-is).
	if h := e.recoveryHandler(); h != nil {
		if raw, err := json.Marshal(req.Body); err == nil {
			if rewritten, ok := applyRecoveryHandler(raw, h); ok {
				var next map[string]interface{}
				if json.Unmarshal(rewritten, &next) == nil {
					bodyJSON = compactBody(next)
				}
			}
		}
	}

	now := time.Now()
	row := model.DisabledRecord{
		ProviderID:     providerID,
		Dimension:      dimension,
		Value:          value,
		RequestHeaders: string(headersJSON),
		RequestBody:    bodyJSON,
		ErrorMessage:   errMsg,
		DisabledAt:     now,
		RetryCount:     0,
		// A re-disable must reopen the row: FirstOrCreate reuses any
		// existing (provider, dimension, value) row, and a stale
		// resolved_at would silently hide it from the pending table.
		ResolvedAt: nil,
	}
	if dbErr := e.db.Where(
		model.DisabledRecord{ProviderID: providerID, Dimension: dimension, Value: value},
	).Assign(row).FirstOrCreate(&row).Error; dbErr != nil {
		log.Printf("relay: save disabled record: %v", dbErr)
	}
}

// recordErrorMessage shortens the upstream error for storage. We keep

// recordErrorMessage shortens the upstream error for storage. We keep
// just the status code and a short excerpt so the row stays compact.
func recordErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	const max = 200
	if len(msg) > max {
		return msg[:max]
	}
	return msg
}

// pickReplayChannel selects a (baseURL, key) pair to replay against,
// preferring non-disabled entries from the provider's plan.
func (e *Engine) pickReplayChannel(plan *ExecutionPlan) (string, string, bool) {
	if plan == nil {
		return "", "", false
	}
	baseURL := e.firstEnabledIndex(plan.Provider.ID, model.FailoverDimensionBaseURL, plan.BaseURLs, 0)
	if baseURL < 0 || baseURL >= len(plan.BaseURLs) {
		return "", "", false
	}
	key := e.firstEnabledIndex(plan.Provider.ID, model.FailoverDimensionKey, plan.Keys, 0)
	if key < 0 || key >= len(plan.Keys) {
		return "", "", false
	}
	return plan.BaseURLs[baseURL], plan.Keys[key], true
}

// ReplayDisabledRecord rebuilds a request from a DisabledRecord and
// sends it against a healthy (baseURL, key) on the same provider.
// Returns true when the upstream responded with a usable 2xx; the
// cascade then clears the provider/baseURL disable state on the
// same record's provider. Records that lost their request body (e.g.
// backfilled rows) honor the configured cooldown: they are skipped
// until TimeoutHours have elapsed since the disable.
func (e *Engine) ReplayDisabledRecord(record *model.DisabledRecord) bool {
	if e.db == nil || record == nil {
		return false
	}
	// Body-less records only replay after the cooldown has elapsed.
	if record.RequestBody == "" && record.RequestHeaders == "" {
		if h := e.recoveryHandler(); h != nil && h.TimeoutHours > 0 {
			if record.DisabledAt.IsZero() || time.Since(record.DisabledAt) < time.Duration(h.TimeoutHours)*time.Hour {
				return false
			}
		}
	}
	provider, err := e.GetProvider(record.ProviderID)
	if err != nil || provider == nil {
		return false
	}
	plan, err := e.GetPlan(provider.ID)
	if err != nil || plan == nil {
		return false
	}
	baseURL, key, ok := e.pickReplayChannel(plan)
	if !ok {
		return false
	}
	modelName := ""
	if record.RequestBody != "" {
		var body map[string]interface{}
		if json.Unmarshal([]byte(record.RequestBody), &body) == nil {
			if m, ok := body["model"].(string); ok {
				modelName = m
			}
		}
	}
	if modelName == "" {
		if len(plan.Keys) == 0 {
			return false
		}
	}
	probe := e.replayProbe(baseURL, key, modelName, record)
	now := time.Now()
	updates := map[string]interface{}{
		"last_retry_at": &now,
		"retry_count":   record.RetryCount + 1,
	}
	if !probe.Success && probe.ErrorMessage != "" {
		// Persist the upstream's real feedback so the dashboard can show
		// what the upstream actually said on the latest attempt.
		updates["error_message"] = recordErrorMessage(errors.New(probe.ErrorMessage))
	}
	if updateErr := e.db.Model(&model.DisabledRecord{}).
		Where("id = ?", record.ID).
		Updates(updates).Error; updateErr != nil {
		log.Printf("relay: update disabled-record retry: %v", updateErr)
	}
	if !probe.Success {
		return false
	}
	// Recovery succeeded: drop the row entirely instead of marking it
	// resolved, so the table only ever holds pending records. A stale
	// resolved_at would otherwise hide a later re-disable of the same
	// entity (saveDisabledRecord reuses the row via FirstOrCreate).
	if resolveErr := e.db.Where("id = ?", record.ID).Delete(&model.DisabledRecord{}).Error; resolveErr != nil {
		log.Printf("relay: drop resolved disabled-record: %v", resolveErr)
	}
	e.resolveCascade(provider, baseURL)
	return true
}

// replayProbe sends the recorded request (compact body + headers) to
// (baseURL, key) with a fresh chat completions call and reports whether
// the upstream returned 2xx with a usable body. When a recovery request
// handler is configured, the recorded body is rewritten first (long user
// payloads become a short token); otherwise a minimal self-built payload
// is used.
func (e *Engine) replayProbe(baseURL, key, modelName string, record *model.DisabledRecord) service.ProbeResult {
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
	if modelName == "" {
		modelName = "test"
	}
	payload := map[string]interface{}{
		"model":      modelName,
		"messages":   []map[string]interface{}{{"role": "user", "content": "你好"}},
		"max_tokens": 1,
		"stream":     false,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return service.ProbeResult{}
	}
	// The recorded body is stored post-rewrite + post-compaction, so replay
	// it as-is when it parses; the self-built payload is only a fallback.
	if record != nil && record.RequestBody != "" {
		if json.Valid([]byte(record.RequestBody)) {
			raw = []byte(record.RequestBody)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return service.ProbeResult{}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	if record != nil && record.RequestHeaders != "" {
		var recorded map[string]string
		if json.Unmarshal([]byte(record.RequestHeaders), &recorded) == nil {
			for k, v := range recorded {
				lower := strings.ToLower(k)
				if lower == "host" || lower == "content-length" || lower == "authorization" || lower == "content-type" {
					continue
				}
				req.Header.Set(k, v)
			}
		}
	}
	start := time.Now()
	resp, err := service.DefaultClient().Do(req)
	if err != nil {
		return service.ProbeResult{TTFB: time.Since(start), ErrorMessage: err.Error()}
	}
	defer resp.Body.Close()
	rec := &ttfbRecorder{r: resp.Body, start: start}
	body, _ := io.ReadAll(rec)
	ttfb := rec.ttfb()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the upstream's real error payload (e.g. OpenAI's
		// {"error":{"message":...}}) so the dashboard shows what the
		// upstream actually said instead of a generic message.
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if excerpt := probeErrorExcerpt(body); excerpt != "" {
			msg += ": " + excerpt
		}
		return service.ProbeResult{TTFB: ttfb, ErrorMessage: msg}
	}
	var parsed struct {
		Choices []json.RawMessage `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		msg := probeErrorExcerpt(body)
		if msg == "" {
			msg = "上游响应体不是合法 JSON"
		}
		return service.ProbeResult{TTFB: ttfb, ErrorMessage: msg}
	}
	if len(parsed.Choices) == 0 {
		msg := probeErrorExcerpt(body)
		if msg == "" {
			msg = "上游响应缺少 choices 字段"
		}
		return service.ProbeResult{TTFB: ttfb, ErrorMessage: msg}
	}
	return service.ProbeResult{Success: true, TTFB: ttfb}
}

// ttfbRecorder stamps the moment the first byte arrives so the caller
// can measure time-to-first-byte without buffering the whole body.
type ttfbRecorder struct {
	r     io.Reader
	start time.Time
	stamp time.Time
}

func (f *ttfbRecorder) Read(p []byte) (int, error) {
	n, err := f.r.Read(p)
	if n > 0 && f.stamp.IsZero() {
		f.stamp = time.Now()
	}
	return n, err
}

func (f *ttfbRecorder) ttfb() time.Duration {
	if f.stamp.IsZero() {
		return time.Since(f.start)
	}
	return f.stamp.Sub(f.start)
}

// probeErrorExcerpt extracts a short human-readable error from an upstream
// error body. It prefers OpenAI-style {"error":{"message":"..."}} and
// Anthropic-style {"error":{"message":"..."}}; falls back to a raw snippet.
func probeErrorExcerpt(body []byte) string {
	const max = 300
	var parsed struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		msg := strings.TrimSpace(parsed.Error.Message)
		if parsed.Error.Type != "" {
			msg = parsed.Error.Type + ": " + msg
		}
		if msg != "" {
			if len(msg) > max {
				msg = msg[:max] + "…"
			}
			return msg
		}
	}
	snippet := strings.TrimSpace(string(body))
	if snippet == "" {
		return ""
	}
	if len(snippet) > max {
		snippet = snippet[:max] + "…"
	}
	return snippet
}

// resolveCascade clears disable states for the provider that just proved
// healthy: every dimension of that provider (provider/base_url/key), the
// provider's auto_disabled flag, and any base_url-dimension disable that
// shares the same baseURL value (other providers reusing the endpoint).
// Open DisabledRecord rows matching the provider or the baseURL are
// dropped so no redundant replay probes run for them.
func (e *Engine) resolveCascade(provider *model.Provider, baseURL string) {
	if e.db == nil || provider == nil {
		return
	}
	// Clear every disable dimension of this provider.
	if err := e.db.Model(&model.ProviderDisableState{}).
		Where("provider_id = ?", provider.ID).
		Update("disabled", false).Error; err != nil {
		log.Printf("relay: cascade clear provider disables: %v", err)
	}
	// Clear base_url-dimension disables on OTHER providers that reuse the
	// same baseURL value (the endpoint itself is healthy).
	if baseURL != "" {
		if err := e.db.Model(&model.ProviderDisableState{}).
			Where("dimension = ? AND value = ?", model.FailoverDimensionBaseURL, baseURL).
			Update("disabled", false).Error; err != nil {
			log.Printf("relay: cascade clear shared baseURL: %v", err)
		}
	}
	if err := e.db.Model(&model.Provider{}).
		Where("id = ?", provider.ID).
		Update("auto_disabled", false).Error; err != nil {
		log.Printf("relay: cascade clear provider.AutoDisabled: %v", err)
	}
	// Drop open records for this provider or for the recovered baseURL so
	// the scheduler never replays them again.
	query := e.db.Where("resolved_at IS NULL")
	query = query.Where("provider_id = ? OR (dimension = ? AND value = ?)",
		provider.ID, model.FailoverDimensionBaseURL, baseURL)
	if err := query.Delete(&model.DisabledRecord{}).Error; err != nil {
		log.Printf("relay: cascade drop records: %v", err)
	}
}

// loadOpenDisabledRecords returns every still-disabled record that the
// recovery scheduler should try to replay. Resolved rows are filtered
// out so they don't pollute the table.
func (e *Engine) loadOpenDisabledRecords() ([]model.DisabledRecord, error) {
	if e.db == nil {
		return nil, errors.New("no database")
	}
	var rows []model.DisabledRecord
	err := e.db.Where("resolved_at IS NULL").Order("disabled_at asc").Find(&rows).Error
	return rows, err
}

// loadDisabledRecordsForProvider returns the records tied to one provider
// — used by the manual replay endpoint.
func (e *Engine) loadDisabledRecordsForProvider(providerID string) ([]model.DisabledRecord, error) {
	var rows []model.DisabledRecord
	err := e.db.Where("provider_id = ?", providerID).Order("disabled_at desc").Find(&rows).Error
	return rows, err
}
