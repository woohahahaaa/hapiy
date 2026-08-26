package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newRecoveryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.ProviderDisableState{}, &model.Setting{}, &model.DisabledRecord{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func mustJSONArray(t *testing.T, arr []string) string {
	t.Helper()
	raw, err := json.Marshal(arr)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(raw)
}

func makeProvider(t *testing.T, db *gorm.DB, name string, baseURLs, keys, models []string) string {
	t.Helper()
	id := "prov-" + name
	p := model.Provider{
		ID:       id,
		Name:     name,
		BaseURLs: mustJSONArray(t, baseURLs),
		Keys:     mustJSONArray(t, keys),
		Models:   mustJSONArray(t, models),
		Status:   true,
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	return id
}

func setDisabled(t *testing.T, db *gorm.DB, providerID, dimension, value string) {
	t.Helper()
	state := model.ProviderDisableState{
		ProviderID: providerID,
		Dimension:  dimension,
		Value:      value,
		Disabled:   true,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
}

func isEnabled(t *testing.T, db *gorm.DB, providerID, dimension, value string) bool {
	t.Helper()
	var s model.ProviderDisableState
	err := db.Where("provider_id = ? AND dimension = ? AND value = ?", providerID, dimension, value).First(&s).Error
	if err != nil {
		return false
	}
	return !s.Disabled
}

func upsertSetting(t *testing.T, db *gorm.DB, key, value string) {
	t.Helper()
	if err := db.Save(&model.Setting{Key: key, Value: value}).Error; err != nil {
		t.Fatalf("upsert setting %s: %v", key, err)
	}
}

func insertDisabledRecord(t *testing.T, db *gorm.DB, providerID, dimension, value string, disabledAt time.Time) string {
	t.Helper()
	row := model.DisabledRecord{
		ProviderID: providerID,
		Dimension:  dimension,
		Value:      value,
		DisabledAt: disabledAt,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("create disabled record: %v", err)
	}
	return row.ID
}

func disabledRecordExists(t *testing.T, db *gorm.DB, id string) bool {
	t.Helper()
	var row model.DisabledRecord
	if err := db.Where("id = ?", id).First(&row).Error; err != nil {
		return false
	}
	return true
}

func TestReadRecoveryMode(t *testing.T) {
	db := newRecoveryTestDB(t)
	if got := readRecoveryMode(db); got != recoveryModeProbe {
		t.Fatalf("default mode = %q, want %q", got, recoveryModeProbe)
	}
	upsertSetting(t, db, SettingRecoveryMode, recoveryModeTimed)
	if got := readRecoveryMode(db); got != recoveryModeTimed {
		t.Fatalf("timed mode = %q, want %q", got, recoveryModeTimed)
	}
	upsertSetting(t, db, SettingRecoveryMode, "garbage")
	if got := readRecoveryMode(db); got != recoveryModeProbe {
		t.Fatalf("unknown mode should fall back to probe, got %q", got)
	}
}

func TestReadRecoveryTimedMinutes(t *testing.T) {
	db := newRecoveryTestDB(t)
	if got := readRecoveryTimedMinutes(db); got != 0 {
		t.Fatalf("default = %d, want 0", got)
	}
	upsertSetting(t, db, SettingRecoveryTimedMinute, "30")
	if got := readRecoveryTimedMinutes(db); got != 30 {
		t.Fatalf("got %d, want 30", got)
	}
	upsertSetting(t, db, SettingRecoveryTimedMinute, "0")
	if got := readRecoveryTimedMinutes(db); got != 0 {
		t.Fatalf("0 should disable, got %d", got)
	}
	upsertSetting(t, db, SettingRecoveryTimedMinute, "abc")
	if got := readRecoveryTimedMinutes(db); got != 0 {
		t.Fatalf("non-numeric should disable, got %d", got)
	}
}

func TestRunTimedRecovery_clearsRecordPastDeadline(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")
	recordID := insertDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", time.Now().Add(-10*time.Minute))

	runTimedRecovery(db, 5*time.Minute)

	if disabledRecordExists(t, db, recordID) {
		t.Fatalf("record past deadline should be dropped")
	}
	if !isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("matching disable state should be cleared")
	}
}

func TestRunTimedRecovery_keepsRecordBeforeDeadline(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")
	recordID := insertDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", time.Now().Add(-1*time.Minute))

	runTimedRecovery(db, 5*time.Minute)

	if !disabledRecordExists(t, db, recordID) {
		t.Fatalf("record before deadline must be kept")
	}
	if isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("disable state must stay disabled before deadline")
	}
}

func TestPassProbe(t *testing.T) {
	cases := []struct {
		name      string
		result    ProbeResult
		threshold time.Duration
		want      bool
	}{
		{"success_no_threshold", ProbeResult{Success: true}, 0, true},
		{"success_under_threshold", ProbeResult{Success: true, TTFB: 3 * time.Second}, 5 * time.Second, true},
		{"success_over_threshold", ProbeResult{Success: true, TTFB: 7 * time.Second}, 5 * time.Second, false},
		{"fail_no_threshold", ProbeResult{Success: false}, 0, false},
		{"fail_over_threshold", ProbeResult{Success: false, TTFB: 2 * time.Second}, 5 * time.Second, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := passProbe(tc.result, tc.threshold); got != tc.want {
				t.Fatalf("passProbe(%+v, %v) = %v, want %v", tc.result, tc.threshold, got, tc.want)
			}
		})
	}
}

func TestFirstByteRecorder_stampsOnFirstByte(t *testing.T) {
	start := time.Now()
	src := strings.NewReader("hello world")
	rec := &firstByteRecorder{r: src}
	out, err := io.ReadAll(rec)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(out) != "hello world" {
		t.Fatalf("payload mismatch: %q", string(out))
	}
	if rec.firstByteLatency(start) <= 0 {
		t.Fatalf("expected positive TTFB, got %v", rec.firstByteLatency(start))
	}
}

func TestFirstByteRecorder_emptyReader(t *testing.T) {
	start := time.Now()
	rec := &firstByteRecorder{r: strings.NewReader("")}
	_, _ = io.ReadAll(rec)
	ttfb := rec.firstByteLatency(start)
	if ttfb <= 0 {
		t.Fatalf("expected fallback ttfb from time.Since(start), got %v", ttfb)
	}
}

func TestRunRecoveryCycle_clearsDisabledKeyWhenProbePasses(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1", "https://u2"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 1 * time.Second}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 0, Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("expected disabled key k2 to be cleared after probe success")
	}
}

func TestRunRecoveryCycle_keepsDisabledKeyWhenProbeFails(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult { return ProbeResult{Success: false} }
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("disabled key must stay disabled when probe fails")
	}
}

func TestRunRecoveryCycle_keepsDisabledKeyWhenTTFBExceedsThreshold(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 10 * time.Second}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 5 * time.Second, Probe: probe})

	if isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("disabled key must stay disabled when TTFB exceeds threshold")
	}
}

func TestRunRecoveryCycle_clearsDisabledKeyWhenTTFBUnderThreshold(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 2 * time.Second}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 5 * time.Second, Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("disabled key k2 should be cleared when probe succeeds under TTFB threshold")
	}
}

func TestRunRecoveryCycle_skipsKeyWhenAllBaseURLsDisabled(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionBaseURL, "https://u1")
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult { return ProbeResult{Success: true} }
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("expected k2 to remain disabled when no harness BaseURL is available")
	}
}

func TestRunRecoveryCycle_clearsDisabledBaseURL(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1", "https://u2"},
		[]string{"k1"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionBaseURL, "https://u2")

	probe := func(baseURL, key, model string) ProbeResult { return ProbeResult{Success: true} }
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionBaseURL, "https://u2") {
		t.Fatalf("expected disabled BaseURL https://u2 to be cleared")
	}
}

func TestRunRecoveryCycle_clearsProviderLevelDisable(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1"},
		[]string{"gpt-4"},
	)
	if err := db.Model(&model.Provider{}).Where("id = ?", providerID).Update("auto_disabled", true).Error; err != nil {
		t.Fatalf("set auto_disabled: %v", err)
	}
	setDisabled(t, db, providerID, model.FailoverDimensionProvider, providerID)

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 500 * time.Millisecond}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 2 * time.Second, Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionProvider, providerID) {
		t.Fatalf("expected provider-level disable to be cleared")
	}
	var p model.Provider
	if err := db.First(&p, "id = ?", providerID).Error; err != nil {
		t.Fatalf("load provider: %v", err)
	}
	if p.AutoDisabled {
		t.Fatalf("expected provider.AutoDisabled to be false after recovery")
	}
}

func TestRunRecoveryCycle_multipleProviders_processedInIDOrder(t *testing.T) {
	db := newRecoveryTestDB(t)
	pA := makeProvider(t, db, "aaa", []string{"https://u"}, []string{"k1", "k2"}, []string{"m"})
	pB := makeProvider(t, db, "bbb", []string{"https://u"}, []string{"k1", "k2"}, []string{"m"})
	setDisabled(t, db, pB, model.FailoverDimensionKey, "k2")
	setDisabled(t, db, pA, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult { return ProbeResult{Success: true} }
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if !isEnabled(t, db, pA, model.FailoverDimensionKey, "k2") {
		t.Fatalf("expected aaa/k2 to be cleared")
	}
	if !isEnabled(t, db, pB, model.FailoverDimensionKey, "k2") {
		t.Fatalf("expected bbb/k2 to be cleared")
	}
}

func TestRunRecoveryCycle_skipsProviderWithoutModels(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "empty",
		[]string{"https://u1", "https://u2"},
		[]string{"k1", "k2"},
		nil,
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	probe := func(baseURL, key, model string) ProbeResult { return ProbeResult{Success: true} }
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("expected k2 to remain disabled when provider has no models")
	}
}

func TestRunRecoveryCycle_passesFirstModelToProbe(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4o", "gpt-3.5-turbo"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionKey, "k2")

	var observedModel string
	probe := func(baseURL, key, model string) ProbeResult {
		observedModel = model
		return ProbeResult{Success: true}
	}
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if observedModel != "gpt-4o" {
		t.Fatalf("expected probe to receive first model 'gpt-4o', got %q", observedModel)
	}
}

func TestDefaultChannelProbe_success(t *testing.T) {
	var gotPath, gotAuth, gotModel string
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		var parsed struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(b, &parsed)
		gotModel = parsed.Model
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()

	res := defaultChannelProbe(server.URL, "hk-test", "gpt-4o")
	if !res.Success {
		t.Fatalf("expected Success=true, got %+v", res)
	}
	if res.TTFB <= 0 {
		t.Fatalf("expected positive TTFB, got %v", res.TTFB)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("expected /v1/chat/completions, got %q", gotPath)
	}
	if gotAuth != "Bearer hk-test" {
		t.Fatalf("expected Bearer hk-test, got %q", gotAuth)
	}
	if gotModel != "gpt-4o" {
		t.Fatalf("expected model gpt-4o, got %q", gotModel)
	}
	if !strings.Contains(gotBody, `"max_tokens":1`) || !strings.Contains(gotBody, `"stream":false`) {
		t.Fatalf("body should pin max_tokens=1 and stream=false, got %q", gotBody)
	}
}

func TestDefaultChannelProbe_4xxIsNotSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"bad key"}`))
	}))
	defer server.Close()

	res := defaultChannelProbe(server.URL, "hk-test", "gpt-4o")
	if res.Success {
		t.Fatalf("expected Success=false on 401, got %+v", res)
	}
}

func TestDefaultChannelProbe_2xxWithoutChoicesIsNotSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"error":"empty"}`))
	}))
	defer server.Close()

	res := defaultChannelProbe(server.URL, "hk-test", "gpt-4o")
	if res.Success {
		t.Fatalf("expected Success=false when choices is empty, got %+v", res)
	}
}

func TestDefaultChannelProbe_emptyArgsReturnsZero(t *testing.T) {
	if res := defaultChannelProbe("", "k", "m"); res != (ProbeResult{}) {
		t.Fatalf("expected zero result for empty baseURL, got %+v", res)
	}
	if res := defaultChannelProbe("u", "", "m"); res != (ProbeResult{}) {
		t.Fatalf("expected zero result for empty key, got %+v", res)
	}
	if res := defaultChannelProbe("u", "k", ""); res != (ProbeResult{}) {
		t.Fatalf("expected zero result for empty model, got %+v", res)
	}
}

func TestDefaultChannelProbe_connectionErrorSetsTTFB(t *testing.T) {
	// Point at an unreachable port; the call returns a network error.
	res := defaultChannelProbe("http://127.0.0.1:1", "k", "m")
	if res.Success {
		t.Fatalf("expected Success=false on connection error, got %+v", res)
	}
	if res.TTFB <= 0 {
		t.Fatalf("expected positive TTFB even on failure, got %v", res.TTFB)
	}
}

func TestReadRecoveryTTFB(t *testing.T) {
	db := newRecoveryTestDB(t)
	if got := readRecoveryTTFB(db); got != 0 {
		t.Fatalf("unset (defaults to 0) got %v, want 0", got)
	}
	upsertSetting(t, db, SettingRecoveryTTFBSecond, "0")
	if got := readRecoveryTTFB(db); got != 0 {
		t.Fatalf("explicit 0 got %v, want 0", got)
	}
	upsertSetting(t, db, SettingRecoveryTTFBSecond, "12")
	if got := readRecoveryTTFB(db); got != 12*time.Second {
		t.Fatalf("explicit 12 got %v, want 12s", got)
	}
	upsertSetting(t, db, SettingRecoveryTTFBSecond, "abc")
	if got := readRecoveryTTFB(db); got != 0 {
		t.Fatalf("garbage value got %v, want 0", got)
	}
}

func TestReadRecoveryInterval(t *testing.T) {
	db := newRecoveryTestDB(t)
	if got := readRecoveryInterval(db); got != 60 {
		t.Fatalf("unset (defaults to 60) got %d, want 60", got)
	}
	upsertSetting(t, db, SettingRecoveryInterval, "120")
	if got := readRecoveryInterval(db); got != 120 {
		t.Fatalf("explicit 120 got %d, want 120", got)
	}
	upsertSetting(t, db, SettingRecoveryInterval, "0")
	if got := readRecoveryInterval(db); got != 0 {
		t.Fatalf("explicit 0 got %d, want 0", got)
	}
}
