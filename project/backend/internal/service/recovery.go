package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

const (
	SettingRecoveryInterval   = "automatic_disable_recovery_minutes"
	SettingRecoveryTTFBSecond = "recovery_ttfb_seconds"
)

// ProbeResult is what ChannelProbe returns. Success reports whether the
// upstream responded with a valid chat completion; TTFB is the measured
// time from request start to first body byte.
type ProbeResult struct {
	Success bool
	TTFB    time.Duration
	// ErrorMessage carries the upstream's real feedback when the probe
	// failed: transport error text or "HTTP <status>: <body excerpt>".
	ErrorMessage string
}

// ChannelProbe tests one (baseURL, key, model) triple by sending a minimal
// chat completion request. Production wires it to defaultChannelProbe; tests
// inject a deterministic stub.
var ChannelProbe = defaultChannelProbe

func defaultChannelProbe(baseURL, key, model string) ProbeResult {
	if baseURL == "" || key == "" || model == "" {
		return ProbeResult{}
	}

	endpoint := strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
	body := fmt.Sprintf(
		`{"model":%q,"messages":[{"role":"user","content":"hi"}],"max_tokens":1,"stream":false}`,
		model,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		log.Printf("recovery probe: build request: %v", err)
		return ProbeResult{}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := DefaultClient().Do(req)
	if err != nil {
		return ProbeResult{TTFB: time.Since(start)}
	}
	defer resp.Body.Close()

	rec := &firstByteRecorder{r: resp.Body}
	raw, err := io.ReadAll(rec)
	ttfb := rec.firstByteLatency(start)
	if err != nil {
		return ProbeResult{TTFB: ttfb}
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return ProbeResult{TTFB: ttfb}
	}

	var parsed struct {
		Choices []json.RawMessage `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ProbeResult{TTFB: ttfb}
	}
	if len(parsed.Choices) == 0 {
		return ProbeResult{TTFB: ttfb}
	}
	return ProbeResult{Success: true, TTFB: ttfb}
}

// firstByteRecorder wraps an io.Reader and stamps the moment the first byte
// passes through. We use it to measure TTFB without buffering the whole body.
type firstByteRecorder struct {
	r     io.Reader
	stamp time.Time
}

func (f *firstByteRecorder) Read(p []byte) (int, error) {
	n, err := f.r.Read(p)
	if n > 0 && f.stamp.IsZero() {
		f.stamp = time.Now()
	}
	return n, err
}

func (f *firstByteRecorder) firstByteLatency(start time.Time) time.Duration {
	if f.stamp.IsZero() {
		return time.Since(start)
	}
	return f.stamp.Sub(start)
}

// RecoveryOptions configures one recovery cycle. TTFBThreshold == 0 means
// "don't check TTFB" — the upstream-success check alone is sufficient.
// RecordReplay, when set, runs first: every open DisabledRecord is
// replayed (the recorded request context is sent against a healthy
// partner) and successful rows are marked resolved. Harness-based
// recovery then handles anything still left.
type RecoveryOptions struct {
	TTFBThreshold time.Duration
	Probe         func(baseURL, key, model string) ProbeResult
	RecordReplay  func() (resolved int, total int)
}

// StartRecoveryScheduler runs auto-recovery cycles in the background. The
// cycle interval and TTFB threshold are read from settings on every
// iteration, so changes take effect at the next tick. An interval of 0
// disables the scheduler (it still re-checks the setting hourly so a later
// enable is picked up without a process restart).
func StartRecoveryScheduler(db *gorm.DB) {
	StartRecoverySchedulerWithRecordReplay(db, nil, nil)
}

// StartRecoverySchedulerWithRecordReplay is the same as
// StartRecoveryScheduler but also invokes recordReplay (if non-nil)
// at the start of every cycle so recorded disable contexts get
// replayed before the harness-based pass runs.
func StartRecoverySchedulerWithRecordReplay(db *gorm.DB, _ any, recordReplay func() (resolved, total int)) {
	go func() {
		for {
			interval := readRecoveryInterval(db)
			if interval <= 0 {
				time.Sleep(time.Hour)
				continue
			}
			opts := RecoveryOptions{
				TTFBThreshold: readRecoveryTTFB(db),
				Probe:         ChannelProbe,
				RecordReplay:  recordReplay,
			}
			RunRecoveryCycle(db, opts)
			time.Sleep(time.Duration(interval) * time.Minute)
		}
	}()
}

func readRecoveryInterval(db *gorm.DB) int {
	val, err := GetSetting(db, SettingRecoveryInterval)
	if err != nil || val == "" {
		return 0
	}
	n, err := strconv.Atoi(val)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func readRecoveryTTFB(db *gorm.DB) time.Duration {
	val, err := GetSetting(db, SettingRecoveryTTFBSecond)
	if err != nil || val == "" {
		return 0
	}
	n, err := strconv.Atoi(val)
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n) * time.Second
}

// RunRecoveryCycle executes one auto-recovery pass. If a RecordReplay
// callback is supplied it runs first so disabled entities that have a
// recorded request context get the most accurate test (replaying the
// same request that triggered the disable). Whatever's still disabled
// afterwards falls through to the harness-based pass below.
func RunRecoveryCycle(db *gorm.DB, opts RecoveryOptions) {
	if opts.RecordReplay != nil {
		opts.RecordReplay()
	}

	var states []model.ProviderDisableState
	if err := db.Where("disabled = ?", true).Find(&states).Error; err != nil {
		log.Printf("recovery: load disabled states: %v", err)
		return
	}
	if len(states) == 0 {
		return
	}

	byProvider := make(map[string][]model.ProviderDisableState)
	for _, s := range states {
		byProvider[s.ProviderID] = append(byProvider[s.ProviderID], s)
	}
	providerIDs := make([]string, 0, len(byProvider))
	for id := range byProvider {
		providerIDs = append(providerIDs, id)
	}
	sort.Strings(providerIDs)

	probe := opts.Probe
	if probe == nil {
		probe = defaultChannelProbe
	}

	for _, pid := range providerIDs {
		runProviderRecovery(db, pid, byProvider[pid], probe, opts.TTFBThreshold)
	}
}

// passProbe returns true only when the probe succeeded and the optional
// TTFB threshold is satisfied. The TTFB threshold of 0 disables the check.
func passProbe(result ProbeResult, ttfbThreshold time.Duration) bool {
	if !result.Success {
		return false
	}
	if ttfbThreshold > 0 && result.TTFB > ttfbThreshold {
		return false
	}
	return true
}

func runProviderRecovery(
	db *gorm.DB,
	providerID string,
	states []model.ProviderDisableState,
	probe func(baseURL, key, model string) ProbeResult,
	ttfbThreshold time.Duration,
) {
	var provider model.Provider
	if err := db.First(&provider, "id = ?", providerID).Error; err != nil {
		log.Printf("recovery: load provider %s: %v", providerID, err)
		return
	}
	baseURLs := parseJSONStringArray(provider.BaseURLs)
	keys := parseJSONStringArray(provider.Keys)
	models := parseJSONStringArray(provider.Models)
	if len(baseURLs) == 0 || len(keys) == 0 || len(models) == 0 {
		log.Printf("recovery: provider %s missing baseURLs/keys/models, skipping", providerID)
		return
	}
	probeModel := models[0]

	var disabledBaseURLs, disabledKeys []string
	var providerDisabled bool
	for _, s := range states {
		switch s.Dimension {
		case model.FailoverDimensionBaseURL:
			disabledBaseURLs = append(disabledBaseURLs, s.Value)
		case model.FailoverDimensionKey:
			disabledKeys = append(disabledKeys, s.Value)
		case model.FailoverDimensionProvider:
			providerDisabled = true
		}
	}

	harnessBaseURL := firstNotIn(baseURLs, disabledBaseURLs)
	harnessKey := firstNotIn(keys, disabledKeys)

	if harnessBaseURL != "" {
		for _, k := range disabledKeys {
			if passProbe(probe(harnessBaseURL, k, probeModel), ttfbThreshold) {
				clearDisable(db, provider.ID, model.FailoverDimensionKey, k)
			}
		}
	}

	if harnessKey != "" {
		for _, u := range disabledBaseURLs {
			if passProbe(probe(u, harnessKey, probeModel), ttfbThreshold) {
				clearDisable(db, provider.ID, model.FailoverDimensionBaseURL, u)
			}
		}
	}

	if providerDisabled {
		u := harnessBaseURL
		if u == "" {
			u = baseURLs[0]
		}
		k := harnessKey
		if k == "" {
			k = keys[0]
		}
		if u != "" && k != "" && passProbe(probe(u, k, probeModel), ttfbThreshold) {
			clearDisable(db, provider.ID, model.FailoverDimensionProvider, provider.ID)
		}
	}
}

func clearDisable(db *gorm.DB, providerID, dimension, value string) {
	if err := db.Model(&model.ProviderDisableState{}).
		Where("provider_id = ? AND dimension = ? AND value = ?", providerID, dimension, value).
		Update("disabled", false).Error; err != nil {
		log.Printf("recovery: clear %s/%s/%s: %v", providerID, dimension, value, err)
		return
	}
	if dimension == model.FailoverDimensionProvider {
		if err := db.Model(&model.Provider{}).
			Where("id = ?", providerID).
			Update("auto_disabled", false).Error; err != nil {
			log.Printf("recovery: clear provider.AutoDisabled %s: %v", providerID, err)
		}
	}
}

func parseJSONStringArray(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

func firstNotIn(arr []string, exclude []string) string {
	if len(arr) == 0 {
		return ""
	}
	ex := make(map[string]struct{}, len(exclude))
	for _, e := range exclude {
		ex[e] = struct{}{}
	}
	for _, a := range arr {
		if _, ok := ex[a]; !ok {
			return a
		}
	}
	return ""
}
