package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/publicFunction"
	"gorm.io/gorm"
)

const (
	SettingRecoveryInterval    = "automatic_disable_recovery_minutes"
	SettingRecoveryMode        = "recovery_mode"
	SettingRecoveryTimedMinute = "recovery_timed_minutes"

	recoveryModeProbe = "probe"
	recoveryModeTimed = "timed"

	// SpeedProbeMaxTokens is the max_tokens budget for recovery probes that
	// must measure generation speed. One-token probes make speed meaningless,
	// so speed-rule probes ask for a small real completion instead.
	SpeedProbeMaxTokens = 100
)

// ProbeResult is what ChannelProbe returns. Success reports whether the
// upstream responded with a valid chat completion; TTFB is the measured
// time from request start to first body byte.
type ProbeResult struct {
	Success bool
	TTFB    time.Duration
	// Speed is the measured response speed in tokens per second, computed
	// over the full probe duration (request start to completion, connect
	// included) using the usage report. 0 when unknown.
	Speed float64
	// Body carries the raw response body so recovery can re-check the
	// match patterns / keywords of the rule that caused the disable.
	Body string
	// ErrorMessage carries the upstream's real feedback when the probe
	// failed: transport error text or "HTTP <status>: <body excerpt>".
	ErrorMessage string
}

// ChannelProbe tests one (baseURL, key, model) triple by sending a minimal
// chat completion request. Production wires it to defaultChannelProbe; tests
// inject a deterministic stub.
var ChannelProbe = defaultChannelProbe

// ChannelSpeedProbe is the speed-measuring variant used for records whose
// disable rule carries a speed limit: it requests a real (small) completion
// so tokens/second is meaningful.
var ChannelSpeedProbe = func(baseURL, key, model string) ProbeResult {
	return probeChannel(baseURL, key, model, SpeedProbeMaxTokens)
}

func defaultChannelProbe(baseURL, key, model string) ProbeResult {
	return probeChannel(baseURL, key, model, 1)
}

func probeChannel(baseURL, key, model string, maxTokens int) ProbeResult {
	if baseURL == "" || key == "" || model == "" {
		return ProbeResult{}
	}

	endpoint := strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
	body := fmt.Sprintf(
		`{"model":%q,"messages":[{"role":"user","content":"hi"}],"max_tokens":%d,"stream":false}`,
		model,
		maxTokens,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		log.Printf("recovery probe: build request: %v", err)
		return ProbeResult{ErrorMessage: fmt.Sprintf("构造请求失败：%v", err)}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := DefaultClient().Do(req)
	if err != nil {
		return ProbeResult{
			TTFB:         time.Since(start),
			ErrorMessage: fmt.Sprintf("无法连接上游：%v", err),
		}
	}
	defer resp.Body.Close()

	rec := publicfunction.NewFirstByteProbeReader(resp.Body, start)
	raw, err := io.ReadAll(rec)
	ttfb := rec.FirstByteLatency()
	elapsed := time.Since(start)
	if err != nil {
		return ProbeResult{TTFB: ttfb, ErrorMessage: fmt.Sprintf("读取响应失败：%v", err)}
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if excerpt := probeErrorExcerpt(raw); excerpt != "" {
			msg += ": " + excerpt
		}
		return ProbeResult{TTFB: ttfb, Body: string(raw), ErrorMessage: msg}
	}

	var parsed struct {
		Choices []json.RawMessage `json:"choices"`
		Usage   *ProbeUsage       `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ProbeResult{TTFB: ttfb, Body: string(raw), ErrorMessage: fmt.Sprintf("响应体不是合法 JSON：%v", err)}
	}
	if len(parsed.Choices) == 0 {
		msg := "响应缺少 choices 字段"
		if excerpt := probeErrorExcerpt(raw); excerpt != "" {
			msg = msg + ": " + excerpt
		}
		return ProbeResult{TTFB: ttfb, Body: string(raw), ErrorMessage: msg}
	}
	return ProbeResult{
		Success: true,
		TTFB:    ttfb,
		Speed:   ProbeSpeed(parsed.Usage, maxTokens, elapsed),
		Body:    string(raw),
	}
}

// ProbeUsage mirrors the OpenAI usage report on probe responses.
type ProbeUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

// ProbeSpeed converts a usage report + elapsed time into tokens per second.
// The denominator spans the whole probe (connect included), matching the
// 使用记录 speed column. Falls back to the requested token count when the
// upstream omits usage.
func ProbeSpeed(usage *ProbeUsage, maxTokens int, elapsed time.Duration) float64 {
	if elapsed <= 0 {
		return 0
	}
	tokens := 0
	if usage != nil {
		tokens = usage.PromptTokens + usage.CompletionTokens
	}
	if tokens <= 0 {
		tokens = maxTokens
	}
	return float64(tokens) / elapsed.Seconds()
}

// probeErrorExcerpt 解析 OpenAI / Anthropic 风格的 {"error":{...}}，
// 失败则截断原 body。与 internal/relay/disabled_record.go 同名函数同语义。
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
	if snippet == "" {
		return ""
	}
	if len(snippet) > max {
		snippet = snippet[:max] + "…"
	}
	return snippet
}

// RecoveryOptions configures one recovery cycle. Probe runs for records
// whose rule has no speed limit; SpeedProbe (a slower, token-heavier probe)
// runs for records whose rule measures speed. RecordReplay, when set, runs
// first: every open DisabledRecord is replayed (the recorded request
// context is sent against a healthy partner) and successful rows are marked
// resolved. Harness-based recovery then handles anything still left.
type RecoveryOptions struct {
	Probe      func(baseURL, key, model string) ProbeResult
	SpeedProbe func(baseURL, key, model string) ProbeResult
	RecordReplay func() (resolved int, total int)
}

// StartRecoveryScheduler runs auto-recovery cycles in the background. The
// scheduler picks up mode, interval, TTFB threshold and timed-recovery
// duration from settings on every iteration, so changes take effect at the
// next tick. An interval of 0 in probe mode disables the scheduler (it
// still re-checks the setting hourly so a later enable is picked up
// without a process restart).
func StartRecoveryScheduler(db *gorm.DB) {
	StartRecoverySchedulerWithRecordReplay(db, nil)
}

// StartRecoverySchedulerWithRecordReplay is the same as
// StartRecoveryScheduler but also invokes recordReplay (if non-nil)
// at the start of every probe cycle so recorded disable contexts get
// replayed before the harness-based pass runs.
func StartRecoverySchedulerWithRecordReplay(db *gorm.DB, recordReplay func() (resolved, total int)) {
	go func() {
		// lastMode/nextProbeAt track the save moment: when the saved mode
		// differs from what we last saw, the next probe cycle fires
		// immediately and the next tick is scheduled interval minutes
		// from that moment.
		var (
			lastMode    string
			nextProbeAt time.Time
		)
		for {
			mode := readRecoveryMode(db)
			switch mode {
			case recoveryModeTimed:
				nextProbeAt = time.Time{}
				if minutes := readRecoveryTimedMinutes(db); minutes > 0 {
					runTimedRecovery(db, time.Duration(minutes)*time.Minute)
				}
			case recoveryModeProbe:
				interval := readRecoveryInterval(db)
				if interval <= 0 {
					lastMode = mode
					nextProbeAt = time.Time{}
					time.Sleep(time.Hour)
					continue
				}
				intervalDur := time.Duration(interval) * time.Minute
				now := time.Now()
				if mode != lastMode || nextProbeAt.IsZero() || !now.Before(nextProbeAt) {
					runProbeCycle(db, recordReplay)
					nextProbeAt = now.Add(intervalDur)
				}
			default:
				lastMode = mode
				nextProbeAt = time.Time{}
				time.Sleep(time.Hour)
				continue
			}
			lastMode = mode
			// 1-minute tick keeps mode flips + timed-mode countdowns
			// responsive; probe-mode timing is enforced by nextProbeAt.
			time.Sleep(time.Minute)
		}
	}()
}

func runProbeCycle(db *gorm.DB, recordReplay func() (resolved, total int)) {
	RunRecoveryCycle(db, RecoveryOptions{
		Probe:        ChannelProbe,
		SpeedProbe:   ChannelSpeedProbe,
		RecordReplay: recordReplay,
	})
}

func readRecoveryMode(db *gorm.DB) string {
	val, err := GetSetting(db, SettingRecoveryMode)
	if err != nil || val == "" {
		return recoveryModeProbe
	}
	if val != recoveryModeProbe && val != recoveryModeTimed {
		return recoveryModeProbe
	}
	return val
}

func readRecoveryTimedMinutes(db *gorm.DB) int {
	val, err := GetSetting(db, SettingRecoveryTimedMinute)
	if err != nil || val == "" {
		return 0
	}
	n, err := strconv.Atoi(val)
	if err != nil || n <= 0 {
		return 0
	}
	return n
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

// RecoveryRuleFor loads the failover rule recorded on a DisabledRecord.
// Returns nil when the record has no rule or the rule has since been
// deleted — callers then fall back to the connectivity-only check.
func RecoveryRuleFor(db *gorm.DB, record *model.DisabledRecord) *model.FailoverRule {
	if db == nil || record == nil || record.RuleID == "" {
		return nil
	}
	var rule model.FailoverRule
	if err := db.First(&rule, "id = ?", record.RuleID).Error; err != nil {
		return nil
	}
	return &rule
}

// SatisfiesRecoveryRule reports whether a probe result satisfies the rule
// that caused the disable: the upstream must answer (connectivity), and —
// when the rule sets limits — TTFB, speed, match patterns and keywords must
// all stay within bounds. A nil rule (no rule recorded, or rule deleted)
// degrades to the connectivity-only check.
func SatisfiesRecoveryRule(rule *model.FailoverRule, result ProbeResult) bool {
	if !result.Success {
		return false
	}
	if rule == nil {
		return true
	}
	if rule.TTFBSeconds > 0 && result.TTFB > time.Duration(rule.TTFBSeconds)*time.Second {
		return false
	}
	if rule.SpeedLimit > 0 && result.Speed < float64(rule.SpeedLimit) {
		return false
	}
	for _, pattern := range rule.MatchPatterns {
		if pattern != "" && strings.Contains(result.Body, pattern) {
			return false
		}
	}
	for _, keyword := range rule.Keywords {
		if keyword != "" && strings.Contains(result.Body, keyword) {
			return false
		}
	}
	return true
}

// RunRecoveryCycle executes one auto-recovery pass. If a RecordReplay
// callback is supplied it runs first so disabled entities that have a
// recorded request context get the most accurate test (replaying the
// same request that triggered the disable). Whatever's still disabled
// afterwards goes through the per-record probe below.
func RunRecoveryCycle(db *gorm.DB, opts RecoveryOptions) {
	if opts.RecordReplay != nil {
		opts.RecordReplay()
	}

	probe := opts.Probe
	if probe == nil {
		probe = defaultChannelProbe
	}
	speedProbe := opts.SpeedProbe
	runRecordRecovery(db, probe, speedProbe)
}

// runRecordRecovery probes every open DisabledRecord using the (baseURL,
// key, model) captured at disable time — the exact combination that
// triggered the disable, so we never cross-combine with other entries.
// Records carrying a rule snapshot are recovered only when the probe
// satisfies that rule (TTFB / speed / patterns); records whose rule is
// gone fall back to the connectivity-only check. Rows missing the captured
// combo (legacy / backfilled) fall back to the provider's first usable
// entries so they still get a chance.
func runRecordRecovery(db *gorm.DB, probe func(baseURL, key, model string) ProbeResult, speedProbe func(baseURL, key, model string) ProbeResult) {
	var records []model.DisabledRecord
	if err := db.Where("resolved_at IS NULL").Find(&records).Error; err != nil {
		log.Printf("recovery: load disabled records: %v", err)
		return
	}
	for i := range records {
		r := &records[i]
		var provider model.Provider
		baseURL, key, modelName, ok := recoveryTarget(db, r, &provider)
		if !ok {
			continue
		}
		rule := RecoveryRuleFor(db, r)
		probeFn := probe
		if rule != nil && rule.SpeedLimit > 0 && speedProbe != nil {
			probeFn = speedProbe
		}
		result := probeFn(baseURL, key, modelName)
		if !SatisfiesRecoveryRule(rule, result) {
			if result.ErrorMessage != "" {
				log.Printf("recovery: probe %s/%s failed: %s (ttfb=%v)", baseURL, key, result.ErrorMessage, result.TTFB)
			}
			continue
		}
		clearDisable(db, provider.ID, provider.Name, r.Dimension, r.Value)
		if err := db.Where("id = ?", r.ID).Delete(&model.DisabledRecord{}).Error; err != nil {
			log.Printf("recovery: drop record %s: %v", r.ID, err)
		}
	}
}

// recoveryTarget resolves the (baseURL, key, model) to probe for one
// DisabledRecord. The recorded combo wins; rows without it fall back to
// the provider's first list entries not among the disabled ones.
func recoveryTarget(db *gorm.DB, r *model.DisabledRecord, provider *model.Provider) (baseURL, key, modelName string, ok bool) {
	if err := db.First(provider, "id = ?", r.ProviderID).Error; err != nil {
		log.Printf("recovery: load provider %s: %v", r.ProviderID, err)
		return "", "", "", false
	}
	baseURLs := parseJSONStringArray(provider.BaseURLs)
	keys := parseJSONStringArray(provider.Keys)
	models := parseJSONStringArray(provider.Models)

	if r.BaseURL != "" && r.Key != "" {
		baseURL, key = r.BaseURL, r.Key
	} else {
		var disabledBaseURLs, disabledKeys []string
		if r.Dimension == model.FailoverDimensionBaseURL {
			disabledBaseURLs = append(disabledBaseURLs, r.Value)
		}
		if r.Dimension == model.FailoverDimensionKey {
			disabledKeys = append(disabledKeys, r.Value)
		}
		baseURL = firstNotIn(baseURLs, disabledBaseURLs)
		if baseURL == "" {
			baseURL = firstNotIn(baseURLs, nil)
		}
		key = firstNotIn(keys, disabledKeys)
		if key == "" {
			key = firstNotIn(keys, nil)
		}
	}
	modelName = r.Model
	if modelName == "" && len(models) > 0 {
		modelName = models[0]
	}
	if baseURL == "" || key == "" || modelName == "" {
		log.Printf("recovery: record %s missing baseURL/key/model, skipping", r.ID)
		return "", "", "", false
	}
	return baseURL, key, modelName, true
}

// runTimedRecovery is the timed-mode equivalent of RunRecoveryCycle: any
// DisabledRecord whose age exceeds duration is dropped and the matching
// AutoDisableState is cleared. No upstream probing is involved — the
// user explicitly opted into "wait N minutes and re-enable".
func runTimedRecovery(db *gorm.DB, duration time.Duration) {
	var records []model.DisabledRecord
	if err := db.Where("resolved_at IS NULL").Find(&records).Error; err != nil {
		log.Printf("timed-recovery: load records: %v", err)
		return
	}
	if len(records) == 0 {
		return
	}
	now := time.Now()
	cleared := 0
	for _, r := range records {
		if !r.DisabledAt.IsZero() && now.Sub(r.DisabledAt) < duration {
			continue
		}
		var provider model.Provider
		if err := db.First(&provider, "id = ?", r.ProviderID).Error; err != nil {
			log.Printf("timed-recovery: load provider %s: %v", r.ProviderID, err)
			continue
		}
		clearDisable(db, provider.ID, provider.Name, r.Dimension, r.Value)
		if err := db.Where("id = ?", r.ID).Delete(&model.DisabledRecord{}).Error; err != nil {
			log.Printf("timed-recovery: drop record %s: %v", r.ID, err)
			continue
		}
		cleared++
	}
	if cleared > 0 {
		log.Printf("timed-recovery: cleared %d disabled record(s) past %s", cleared, duration)
	}
}

func clearDisable(db *gorm.DB, providerID, providerName, dimension, value string) {
	result := db.Model(&model.AutoDisableState{}).
		Where("provider_id = ? AND dimension = ? AND value = ?", providerID, dimension, value).
		Update("disabled", false)
	if result.Error != nil {
		log.Printf("recovery: clear %s/%s/%s: %v", providerID, dimension, value, result.Error)
		return
	}
	// Only record a recovery event when a row was actually flipped, so a
	// no-op clear never produces a phantom "自动恢复" log entry.
	if result.RowsAffected > 0 {
		LogEvent(LogSourceChannelRecoveredAuto, providerName, ChannelEventMessage(dimension, value), "恢复方式: 自动探针")
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
