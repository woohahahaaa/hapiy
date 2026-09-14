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
	"unicode/utf8"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
)

const (
	// compactStringMaxLen caps a single string field in the request body
	// before we collapse it to "...". Above this length the user's
	// content is unlikely to affect upstream behavior but it bloats
	// the replay payload.
	compactStringMaxLen = 30
)

// compactBody returns a JSON string with the same shape as the original
// body but with long strings replaced by "..." and arrays truncated to
// their first element. The structure (field paths and types) is preserved
// so a replay upstream gets a schema-valid body — these probes only test
// connectivity, not the payload content.
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
		// Short strings may still be semantically meaningful (e.g. model
		// name, "stream"); keep them. Long strings (user content) don't
		// matter for a connectivity probe and just bloat the payload.
		if len(val) > compactStringMaxLen {
			return "..."
		}
		return val
	case []interface{}:
		// Arrays carry typed items (messages / tools are arrays of
		// objects). Never append a placeholder element — a string "..."
		// inside a typed array makes the replayed body invalid and
		// upstreams reject it with "Input should be a valid dictionary
		// or object". Keep only the first element.
		if len(val) == 0 {
			return val
		}
		return []interface{}{compactValue(val[0])}
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
func (e *Engine) saveDisabledRecord(providerID, dimension, value, baseURL, key string, req *RelayRequest, errMsg string) {
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
		BaseURL:        baseURL,
		Key:            key,
		Model:          req.Model,
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
		// Cut on a rune boundary — slicing bytes mid-rune stores
		// invalid UTF-8 that renders as garbage in the dashboard.
		runes := []rune(msg)
		if len(runes) > max {
			runes = runes[:max]
		}
		return string(runes)
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
	// 优先用禁用瞬间记录的原始 (baseURL, key) —— 不交叉、不换通道；
	// 旧数据没存的才回落 pickReplayChannel。
	baseURL, key, ok := "", "", false
	if record.BaseURL != "" && record.Key != "" {
		baseURL, key, ok = record.BaseURL, record.Key, true
	} else {
		baseURL, key, ok = e.pickReplayChannel(plan)
	}
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
	e.resolveCascade(provider, record)
	return true
}

// sanitizeReplayBody turns a stored DisabledRecord request body into a
// schema-valid, non-streaming probe payload. Stored rows may come from
// older builds whose compaction appended a bare "..." string to truncated
// arrays (strict upstreams reject the replay with 422 "Input should be a
// valid dictionary or object"), and they usually carry stream=true with
// stream_options — the probe needs a JSON response, so streaming is forced
// off (stream_options is only legal when stream=true).
func sanitizeReplayBody(raw []byte) []byte {
	var body map[string]interface{}
	if json.Unmarshal(raw, &body) != nil {
		return nil
	}
	body["stream"] = false
	delete(body, "stream_options")
	compacted := compactBody(body)
	if compacted == "" {
		return nil
	}
	return []byte(compacted)
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
	// Stored bodies are sanitized (re-compacted, stream forced off) before
	// replay — see sanitizeReplayBody. The self-built payload is only a
	// fallback for rows without a usable body.
	if record != nil && record.RequestBody != "" {
		if sanitized := sanitizeReplayBody([]byte(record.RequestBody)); sanitized != nil {
			raw = sanitized
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
				if lower == "host" || lower == "content-length" || lower == "authorization" || lower == "content-type" || lower == "accept-encoding" {
					// accept-encoding must not be replayed: with an explicit
					// header Go won't transparently decompress, and the probe
					// would grade a gzip body as a JSON failure.
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
// The result uses newlines to separate fields so the dashboard can render
// multi-line error details.
func probeErrorExcerpt(body []byte) string {
	const max = 300
	var parsed struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		var parts []string
		if parsed.Error.Code != "" {
			parts = append(parts, "Code: "+parsed.Error.Code)
		}
		if parsed.Error.Type != "" {
			parts = append(parts, "Type: "+parsed.Error.Type)
		}
		msg := strings.TrimSpace(parsed.Error.Message)
		if msg != "" {
			parts = append(parts, "Message: "+msg)
		}
		if len(parts) > 0 {
			result := strings.Join(parts, "\n")
			if len(result) > max {
				result = result[:max] + "…"
			}
			return result
		}
	}
	snippet := strings.TrimSpace(string(body))
	if snippet == "" || !utf8.Valid(body) {
		// Empty or not valid text (e.g. a gzip response body we didn't
		// replay as decompressable) — don't store binary garbage.
		return ""
	}
	if len(snippet) > max {
		runes := []rune(snippet)
		if len(runes) > max {
			snippet = string(runes[:max]) + "…"
		}
	}
	return snippet
}

// resolveCascade clears disable state for the entity a successful replay
// actually proved healthy: the record's own (dimension, value) state, the
// provider-level disable, and any base_url-dimension disable on the same
// baseURL (other providers reusing the endpoint). Sibling keys/baseURLs of
// this provider are NOT touched — one key answering does not prove its
// siblings are healthy (e.g. they may be genuinely out of quota), so their
// pending DisabledRecord rows stay in the table and keep being replayed.
func (e *Engine) resolveCascade(provider *model.Provider, record *model.DisabledRecord) {
	if e.db == nil || provider == nil || record == nil {
		return
	}
	// Clear this record's own disable state.
	if record.Dimension != "" && record.Value != "" {
		if err := e.db.Model(&model.AutoDisableState{}).
			Where("provider_id = ? AND dimension = ? AND value = ?", provider.ID, record.Dimension, record.Value).
			Update("disabled", false).Error; err != nil {
			log.Printf("relay: cascade clear recorded entity: %v", err)
		}
	}
	// A successful replay through the provider proves the provider itself
	// is reachable: clear provider-dimension disables.
	if err := e.db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ?", provider.ID, model.FailoverDimensionProvider).
		Update("disabled", false).Error; err != nil {
		log.Printf("relay: cascade clear provider disable: %v", err)
	}
	// Clear base_url-dimension disables on OTHER providers that reuse the
	// same baseURL value (the endpoint itself is healthy).
	baseURL := record.BaseURL
	if baseURL != "" {
		if err := e.db.Model(&model.AutoDisableState{}).
			Where("dimension = ? AND value = ?", model.FailoverDimensionBaseURL, baseURL).
			Update("disabled", false).Error; err != nil {
			log.Printf("relay: cascade clear shared baseURL: %v", err)
		}
	}
	// Drop open records for the recovered entity and for the proven base
	// URL so the scheduler never replays them again — but leave sibling
	// keys alone.
	if err := e.db.Where("resolved_at IS NULL AND provider_id = ? AND dimension = ? AND value = ?",
		provider.ID, record.Dimension, record.Value).
		Delete(&model.DisabledRecord{}).Error; err != nil {
		log.Printf("relay: cascade drop records: %v", err)
	}
	if baseURL != "" {
		if err := e.db.Where("resolved_at IS NULL AND dimension = ? AND value = ?",
			model.FailoverDimensionBaseURL, baseURL).
			Delete(&model.DisabledRecord{}).Error; err != nil {
			log.Printf("relay: cascade drop baseURL records: %v", err)
		}
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
