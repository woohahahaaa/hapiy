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
	"github.com/hapiy/hapiy/internal/publicFunction"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newRecoveryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Provider{}, &model.AutoDisableState{}, &model.Setting{}, &model.DisabledRecord{}); err != nil {
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
	state := model.AutoDisableState{
		ProviderID: providerID,
		Dimension:  dimension,
		Value:      value,
		Disabled:   true,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
}

// setDisabledRecord 同时落 AutoDisableState 和带原始 (baseURL, key,
// model) 的 DisabledRecord，模拟真实禁用路径（failover 会一起写）。
func setDisabledRecord(t *testing.T, db *gorm.DB, providerID, dimension, value, baseURL, key, modelName string) {
	t.Helper()
	setDisabled(t, db, providerID, dimension, value)
	row := model.DisabledRecord{
		ProviderID: providerID,
		Dimension:  dimension,
		Value:      value,
		BaseURL:    baseURL,
		Key:        key,
		Model:      modelName,
		DisabledAt: time.Now(),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("create disabled record: %v", err)
	}
}

func isEnabled(t *testing.T, db *gorm.DB, providerID, dimension, value string) bool {
	t.Helper()
	var s model.AutoDisableState
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

func TestFirstByteProbeReader_stampsOnFirstByte(t *testing.T) {
	start := time.Now()
	rec := publicfunction.NewFirstByteProbeReader(io.NopCloser(strings.NewReader("hello world")), start)
	out, err := io.ReadAll(rec)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(out) != "hello world" {
		t.Fatalf("payload mismatch: %q", string(out))
	}
	if rec.FirstByteLatency() <= 0 {
		t.Fatalf("expected positive TTFB, got %v", rec.FirstByteLatency())
	}
	if !rec.FirstByteSeen() {
		t.Fatalf("expected FirstByteSeen=true after reading")
	}
}

func TestFirstByteProbeReader_emptyReader(t *testing.T) {
	start := time.Now()
	rec := publicfunction.NewFirstByteProbeReader(io.NopCloser(strings.NewReader("")), start)
	_, _ = io.ReadAll(rec)
	ttfb := rec.FirstByteLatency()
	if ttfb <= 0 {
		t.Fatalf("expected fallback ttfb from time.Since(start), got %v", ttfb)
	}
	if rec.FirstByteSeen() {
		t.Fatalf("empty reader must not report first byte seen")
	}
}

func TestFirstByteProbeReader_waitFirstByte_withinTimeout(t *testing.T) {
	start := time.Now()
	rec := publicfunction.NewFirstByteProbeReader(io.NopCloser(strings.NewReader("x")), start)
	if !rec.WaitFirstByte(time.Second) {
		t.Fatal("expected first byte within 1s")
	}
	if !rec.FirstByteSeen() {
		t.Fatal("expected first byte seen after WaitFirstByte")
	}
	// 字节不能丢：WaitFirstByte 观察过的内容后续 Read 还要能拿到。
	buf := make([]byte, 1)
	if _, err := io.ReadFull(rec, buf); err != nil || string(buf) != "x" {
		t.Fatalf("expected buffered first byte 'x', got %q err=%v", buf, err)
	}
}

func TestFirstByteProbeReader_waitFirstByte_timeout(t *testing.T) {
	start := time.Now()
	// 永不发送数据的 reader：WaitFirstByte 应超时返回 false。
	blocking := &blockingReadCloser{done: make(chan struct{})}
	rec := publicfunction.NewFirstByteProbeReader(blocking, start)
	if rec.WaitFirstByte(200 * time.Millisecond) {
		t.Fatal("expected timeout (no data available)")
	}
	if rec.FirstByteSeen() {
		t.Fatal("no byte should be seen on timeout")
	}
	blocking.Close()
}

// blockingReadCloser 是一个除 Close 外永远不返回的 reader，用于模拟上游
// 挂死（不发数据也不断连）的场景。
type blockingReadCloser struct {
	done chan struct{}
}

func (b *blockingReadCloser) Read(p []byte) (int, error) {
	<-b.done
	return 0, io.EOF
}

func (b *blockingReadCloser) Close() error {
	close(b.done)
	return nil
}

func TestRunRecoveryCycle_clearsDisabledKeyWhenProbePasses(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1", "https://u2"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u2", "k2", "gpt-4")

	var gotKey string
	probe := func(baseURL, key, model string) ProbeResult {
		gotKey = key
		return ProbeResult{Success: true, TTFB: 1 * time.Second}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 0, Probe: probe})
	if gotKey != "k2" {
		t.Fatalf("probe should hit the recorded key k2, got %q", gotKey)
	}

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "")

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "gpt-4")

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "gpt-4")

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 2 * time.Second}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 5 * time.Second, Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("disabled key k2 should be cleared when probe succeeds under TTFB threshold")
	}
}

func TestRunRecoveryCycle_probesRecordedComboEvenWhenBaseURLDisabled(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1"},
		[]string{"k1", "k2"},
		[]string{"gpt-4"},
	)
	setDisabled(t, db, providerID, model.FailoverDimensionBaseURL, "https://u1")
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "gpt-4")

	var gotBaseURL, gotKey string
	probe := func(baseURL, key, model string) ProbeResult {
		gotBaseURL, gotKey = baseURL, key
		return ProbeResult{Success: true}
	}
	RunRecoveryCycle(db, RecoveryOptions{Probe: probe})

	if gotBaseURL != "https://u1" || gotKey != "k2" {
		t.Fatalf("expected probe to use recorded combo u1/k2, got %s/%s", gotBaseURL, gotKey)
	}
	if !isEnabled(t, db, providerID, model.FailoverDimensionKey, "k2") {
		t.Fatalf("k2 should be cleared: its recorded baseURL is used even though it is disabled")
	}
}

func TestRunRecoveryCycle_clearsDisabledBaseURL(t *testing.T) {
	db := newRecoveryTestDB(t)
	providerID := makeProvider(t, db, "openai",
		[]string{"https://u1", "https://u2"},
		[]string{"k1"},
		[]string{"gpt-4"},
	)
	setDisabledRecord(t, db, providerID, model.FailoverDimensionBaseURL, "https://u2", "https://u2", "k1", "gpt-4")

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionProvider, providerID, "https://u1", "k1", "gpt-4")

	probe := func(baseURL, key, model string) ProbeResult {
		return ProbeResult{Success: true, TTFB: 500 * time.Millisecond}
	}
	RunRecoveryCycle(db, RecoveryOptions{TTFBThreshold: 2 * time.Second, Probe: probe})

	if !isEnabled(t, db, providerID, model.FailoverDimensionProvider, providerID) {
		t.Fatalf("expected provider-level disable to be cleared")
	}
}

func TestRunRecoveryCycle_multipleProviders_processedInIDOrder(t *testing.T) {
	db := newRecoveryTestDB(t)
	pA := makeProvider(t, db, "aaa", []string{"https://u"}, []string{"k1", "k2"}, []string{"m"})
	pB := makeProvider(t, db, "bbb", []string{"https://u"}, []string{"k1", "k2"}, []string{"m"})
	setDisabledRecord(t, db, pB, model.FailoverDimensionKey, "k2", "https://u", "k2", "m")
	setDisabledRecord(t, db, pA, model.FailoverDimensionKey, "k2", "https://u", "k2", "m")

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "")

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
	setDisabledRecord(t, db, providerID, model.FailoverDimensionKey, "k2", "https://u1", "k2", "")

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
