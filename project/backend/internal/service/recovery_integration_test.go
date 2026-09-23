// 验证自动恢复「上游恢复」模式是否真的生效：
// 真实起一个 mock 上游（httptest），把 Provider 的 baseURL 指向它，
// 用真实的 defaultChannelProbe 跑 RunRecoveryCycle，观察禁用状态
// 是否被解除、TTFB 多大、有没有命中阈值。
//
// 报告里每条用例会 t.Logf 自己的：上游响应 / 探测耗时 / 探测结果 /
// 是否解除禁用 / 是否满足阈值。运行：go test -v ./internal/service/...

package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 工具：建立内存 DB + 一个 Provider（baseURL/keys/models 数组按需填充）。
func newIntegrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Provider{},
		&model.AutoDisableState{},
		&model.Setting{},
		&model.DisabledRecord{},
		&model.FailoverRule{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return db
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func makeProviderForProbe(t *testing.T, db *gorm.DB, baseURLs, keys, models []string) string {
	t.Helper()
	id := fmt.Sprintf("prov-%d", time.Now().UnixNano())
	p := model.Provider{
		ID:       id,
		Name:     id,
		BaseURLs: mustJSON(t, baseURLs),
		Keys:     mustJSON(t, keys),
		Models:   mustJSON(t, models),
		Status:   true,
	}
	if err := db.Save(&p).Error; err != nil {
		t.Fatalf("save provider: %v", err)
	}
	return id
}

func setKeyDisabled(t *testing.T, db *gorm.DB, providerID, key string) {
	t.Helper()
	if err := db.Save(&model.AutoDisableState{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionKey,
		Value:      key,
		Disabled:   true,
	}).Error; err != nil {
		t.Fatalf("save disable state: %v", err)
	}
}

func setBaseURLDisabled(t *testing.T, db *gorm.DB, providerID, baseURL string) {
	t.Helper()
	if err := db.Save(&model.AutoDisableState{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionBaseURL,
		Value:      baseURL,
		Disabled:   true,
	}).Error; err != nil {
		t.Fatalf("save disable state: %v", err)
	}
}

func isKeyDisabled(t *testing.T, db *gorm.DB, providerID, key string) bool {
	t.Helper()
	var s model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ? AND value = ?",
		providerID, model.FailoverDimensionKey, key).First(&s).Error; err != nil {
		return false
	}
	return s.Disabled
}

func isBaseURLDisabled(t *testing.T, db *gorm.DB, providerID, baseURL string) bool {
	t.Helper()
	var s model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ? AND value = ?",
		providerID, model.FailoverDimensionBaseURL, baseURL).First(&s).Error; err != nil {
		return false
	}
	return s.Disabled
}

func upsertIntegrationSetting(t *testing.T, db *gorm.DB, key, value string) {
	t.Helper()
	if err := db.Save(&model.Setting{Key: key, Value: value}).Error; err != nil {
		t.Fatalf("upsert setting: %v", err)
	}
}

// 报告单条用例的探测结果（探测耗时、是否成功、是否满足阈值、最终禁用状态）。
func reportProbeResult(
	t *testing.T,
	scenario string,
	probe ProbeResult,
	ttfbThreshold time.Duration,
	beforeDisabled bool,
	afterDisabled bool,
	expectCleared bool,
) {
	ttfbStr := "<nil>"
	if probe.TTFB > 0 {
		ttfbStr = probe.TTFB.String()
	}
	thresholdStr := "（不检查）"
	satisfied := "—"
	if ttfbThreshold > 0 {
		thresholdStr = ttfbThreshold.String()
		if probe.TTFB > 0 {
			if probe.TTFB <= ttfbThreshold {
				satisfied = "满足"
			} else {
				satisfied = "不满足"
			}
		} else if !probe.Success {
			satisfied = "— (探测失败)"
		}
	}
	before := "禁用"
	if !beforeDisabled {
		before = "未禁用"
	}
	after := "禁用"
	if !afterDisabled {
		after = "解除"
	}
	clearedAsExpected := afterDisabled != expectCleared
	t.Logf("【%s】", scenario)
	t.Logf("  上游响应: success=%v  error=%q  ttfb=%s  阈值=%s  -> %s",
		probe.Success, probe.ErrorMessage, ttfbStr, thresholdStr, satisfied)
	t.Logf("  禁用状态: 探测前=%s 探测后=%s  期望解除=%v  实际=%v",
		before, after, expectCleared, clearedAsExpected)
}

// 一个上游返回「带可控 TTFB 延迟」的固定响应。
func upstreamHandler(ttfb time.Duration, status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ttfb > 0 {
			// 等到首字节才返回；先用 select+time 给真实延时。
			time.Sleep(ttfb)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

// 拉起 mock 上游 + 一个 provider + 把第二个 key 标记为禁用，跑一次恢复周期。
// recoveryRule 挂在 DisabledRecord 上（模拟 failover 禁用时的规则快照）。
// 返回「探测结果、探测前是否禁用、探测后是否禁用」。
func runProbeScenario(
	t *testing.T,
	scenario string,
	upstream *httptest.Server,
	recoveryRule *model.FailoverRule,
) (probe ProbeResult, beforeDisabled, afterDisabled bool, skipped bool) {
	db := newIntegrationDB(t)
	providerID := makeProviderForProbe(t, db,
		[]string{upstream.URL},
		[]string{"k-healthy", "k-broken"},
		[]string{"gpt-4o"},
	)
	setKeyDisabled(t, db, providerID, "k-broken")
	// 模拟真实禁用路径：failover 会同时写 DisabledRecord（带原始组合）。
	record := model.DisabledRecord{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionKey,
		Value:      "k-broken",
		BaseURL:    upstream.URL,
		Key:        "k-broken",
		Model:      "gpt-4o",
		DisabledAt: time.Now(),
	}
	if recoveryRule != nil {
		if err := db.Create(recoveryRule).Error; err != nil {
			t.Fatalf("create failover rule: %v", err)
		}
		record.RuleID = recoveryRule.ID
		record.RuleName = recoveryRule.Name
	}
	if err := db.Save(&record).Error; err != nil {
		t.Fatalf("save disabled record: %v", err)
	}

	beforeDisabled = isKeyDisabled(t, db, providerID, "k-broken")

	// 用真实的 defaultChannelProbe（不注入 stub），这样跑通就证明 scheduler 默认配置没问题。
	// 通过 RunRecoveryCycle 的 RecoveryOptions.Probe 注入；这里直接传入 ChannelProbe（== defaultChannelProbe）。
	opts := RecoveryOptions{
		Probe: ChannelProbe,
	}
	// 拿一次探测结果单独打印，再让 RunRecoveryCycle 走自己的循环逻辑。
	singleProbe := ChannelProbe(upstream.URL, "k-healthy", "gpt-4o")
	probe = singleProbe

	RunRecoveryCycle(db, opts)

	afterDisabled = isKeyDisabled(t, db, providerID, "k-broken")
	reportProbeResult(t, scenario, probe, ruleTTFBLimit(recoveryRule), beforeDisabled, afterDisabled, !beforeDisabled)
	return probe, beforeDisabled, afterDisabled, false
}

// ruleTTFBLimit converts a rule's TTFB seconds into a Duration for reporting.
func ruleTTFBLimit(rule *model.FailoverRule) time.Duration {
	if rule == nil || rule.TTFBSeconds <= 0 {
		return 0
	}
	return time.Duration(rule.TTFBSeconds) * time.Second
}

// ── 用例 ───────────────────────────────────────────────────────────────

// 场景 1：上游连通、200 OK、TTFB 极小（默认不检查阈值）
func TestRecoveryFlow_UpstreamOK_NoThreshold(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()
	probe, _, after, _ := runProbeScenario(t, "上游连通 200 OK，无规则", server, nil)
	if !probe.Success {
		t.Fatalf("probe expected success, got %+v", probe)
	}
	if after {
		t.Fatalf("禁用应被解除，但仍然禁用")
	}
	if calls == 0 {
		t.Fatalf("上游未被调用，probe 路径异常")
	}
}

// 场景 2：上游返回 401 unauthorized —— 探测失败，禁用保持
func TestRecoveryFlow_Upstream401_KeepsDisabled(t *testing.T) {
	server := httptest.NewServer(upstreamHandler(0, http.StatusUnauthorized, `{"error":"bad key"}`))
	defer server.Close()
	probe, beforeDisabled, after, _ := runProbeScenario(t, "上游 401 unauthorized", server, nil)
	if probe.Success {
		t.Fatalf("probe expected failure on 401, got %+v", probe)
	}
	if !after {
		t.Fatalf("禁用应保持，但被解除了")
	}
	if !beforeDisabled {
		t.Fatalf("前置状态错误：探测前就不该是禁用")
	}
}

// 场景 3：上游返回 500 server error —— 探测失败，禁用保持
func TestRecoveryFlow_Upstream500_KeepsDisabled(t *testing.T) {
	server := httptest.NewServer(upstreamHandler(0, http.StatusInternalServerError, `{"error":"oops"}`))
	defer server.Close()
	probe, _, after, _ := runProbeScenario(t, "上游 500 server error", server, nil)
	if probe.Success {
		t.Fatalf("probe expected failure on 500, got %+v", probe)
	}
	if !after {
		t.Fatalf("禁用应保持")
	}
}

// 场景 4：上游返回 200 但无 choices —— 探测失败，禁用保持
func TestRecoveryFlow_Upstream200EmptyChoices_KeepsDisabled(t *testing.T) {
	server := httptest.NewServer(upstreamHandler(0, http.StatusOK, `{"id":"x"}`))
	defer server.Close()
	probe, _, after, _ := runProbeScenario(t, "上游 200 OK 但无 choices", server, nil)
	if probe.Success {
		t.Fatalf("probe expected failure when no choices, got %+v", probe)
	}
	if !after {
		t.Fatalf("禁用应保持")
	}
}

// 场景 5：上游响应慢、TTFB 在阈值内 —— 应解除禁用
func TestRecoveryFlow_SlowUpstream_WithinThreshold(t *testing.T) {
	server := httptest.NewServer(upstreamHandler(1500*time.Millisecond, http.StatusOK,
		`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	defer server.Close()
	probe, _, after, _ := runProbeScenario(t, "上游慢 1.5s，规则 TTFB 3s", server, &model.FailoverRule{Name: "ttfb-ok", Dimension: model.FailoverDimensionKey, Status: true, TTFBSeconds: 3})
	if !probe.Success {
		t.Fatalf("probe expected success, got %+v", probe)
	}
	if after {
		t.Fatalf("禁用应被解除（TTFB 在阈值内）")
	}
}

// 场景 6：上游响应慢、TTFB 超出阈值 —— 探测失败（passProbe 不通过），禁用保持
func TestRecoveryFlow_SlowUpstream_ExceedsThreshold(t *testing.T) {
	server := httptest.NewServer(upstreamHandler(2500*time.Millisecond, http.StatusOK,
		`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	defer server.Close()
	probe, _, after, _ := runProbeScenario(t, "上游慢 2.5s，规则 TTFB 1s", server, &model.FailoverRule{Name: "ttfb-slow", Dimension: model.FailoverDimensionKey, Status: true, TTFBSeconds: 1})
	if !probe.Success {
		t.Fatalf("上游 200 应 success=true，但 passProbe 应该因为 TTFB 不通过而拒绝")
	}
	if !after {
		t.Fatalf("禁用应保持（TTFB 超出阈值）")
	}
}

// 用一个已关闭的 server 的 URL，发请求会立刻得到 connection refused。
func TestRecoveryFlow_UpstreamUnreachable(t *testing.T) {
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closed.Close()
	probe, _, after, _ := runProbeScenario(t, "上游不可达（连接拒绝）", closed, nil)
	if probe.Success {
		t.Fatalf("连接被拒绝的探测不该 success")
	}
	if probe.ErrorMessage == "" {
		t.Logf("警告：连接失败时没有错误消息，TTFB=%v", probe.TTFB)
	}
	if !after {
		t.Fatalf("禁用应保持")
	}
}

// 场景 8：baseURL 被禁用 —— 仍然能通过其它 key 探测到（harness）
func TestRecoveryFlow_BaseURLDisabled_RecoversViaHealthyKey(t *testing.T) {
	var called int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()
	db := newIntegrationDB(t)
	providerID := makeProviderForProbe(t, db,
		[]string{server.URL, server.URL + "-backup"},
		[]string{"k-healthy", "k-broken"},
		[]string{"gpt-4o"},
	)
	setBaseURLDisabled(t, db, providerID, server.URL)
	if err := db.Save(&model.DisabledRecord{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionBaseURL,
		Value:      server.URL,
		BaseURL:    server.URL,
		Key:        "k-healthy",
		Model:      "gpt-4o",
		DisabledAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("save disabled record: %v", err)
	}

	before := isBaseURLDisabled(t, db, providerID, server.URL)
	RunRecoveryCycle(db, RecoveryOptions{Probe: ChannelProbe})
	after := isBaseURLDisabled(t, db, providerID, server.URL)

	t.Logf("【baseURL 禁用，通过健康 key 探测】")
	t.Logf("  上游被调用次数: %d", called)
	t.Logf("  禁用状态: 探测前=%v 探测后=%v", before, after)

	if !before {
		t.Fatalf("前置错误：baseURL 探测前就该是禁用")
	}
	if after {
		t.Fatalf("baseURL 禁用应被解除")
	}
}

// 场景 9：provider 级禁用 —— 应当被解除
func TestRecoveryFlow_ProviderLevelDisabled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer server.Close()
	db := newIntegrationDB(t)
	providerID := makeProviderForProbe(t, db,
		[]string{server.URL},
		[]string{"k-healthy"},
		[]string{"gpt-4o"},
	)
	if err := db.Save(&model.AutoDisableState{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionProvider,
		Value:      providerID,
		Disabled:   true,
	}).Error; err != nil {
		t.Fatalf("set provider disable: %v", err)
	}
	if err := db.Save(&model.DisabledRecord{
		ProviderID: providerID,
		Dimension:  model.FailoverDimensionProvider,
		Value:      providerID,
		BaseURL:    server.URL,
		Key:        "k-healthy",
		Model:      "gpt-4o",
		DisabledAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("save disabled record: %v", err)
	}

	RunRecoveryCycle(db, RecoveryOptions{Probe: ChannelProbe})

	var s model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ?", providerID,
		model.FailoverDimensionProvider).First(&s).Error; err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Logf("【provider 级禁用】")
	t.Logf("  AutoDisableState.disabled: %v", s.Disabled)
	if s.Disabled {
		t.Fatalf("provider 级禁用应被解除")
	}
}