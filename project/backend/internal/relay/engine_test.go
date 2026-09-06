package relay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newTestEngine builds an in-memory SQLite engine that mirrors the production
// AutoMigrate shape so cache rebuilds can be exercised against real SQL.
func newTestEngine(t *testing.T) (*Engine, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.Provider{},
		&model.RewriteRule{},
		&model.ResponseRewriteRule{},
		&model.ConcurrencyWindowCounter{},
		&model.FailoverRule{},
		&model.AutoDisableState{},
		&model.Setting{},
		&model.TopologyState{},
		&model.TopologySlotAssignment{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	return NewEngine(db), db
}

func TestLoadProviders_compiles_only_enabled_assigned_rules_in_explicit_order(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rules := []model.RewriteRule{
		{ID: "rewrite-1", Name: "one", Status: true},
		{ID: "rewrite-2", Name: "two", Status: true},
		{ID: "global-unassigned", Name: "unassigned", Status: true},
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rules).Error; err != nil {
		t.Fatalf("create rules: %v", err)
	}
	assignments := []model.TopologySlotAssignment{
		{ID: "second", ProviderID: provider.ID, SlotType: "requestModify", Order: 2, Enabled: true, RuleID: stringPointer("rewrite-1"), Config: `{}`},
		{ID: "first", ProviderID: provider.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer("rewrite-2"), Config: `{}`},
		{ID: "disabled", ProviderID: provider.ID, SlotType: "requestModify", Order: 3, Enabled: false, RuleID: stringPointer("global-unassigned"), Config: `{}`},
	}
	if err := db.Create(&assignments).Error; err != nil {
		t.Fatalf("create assignments: %v", err)
	}

	// When
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	plan, err := engine.GetPlan(provider.ID)

	// Then
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.RewriteRules) != 2 || plan.RewriteRules[0].ID != "rewrite-2" || plan.RewriteRules[1].ID != "rewrite-1" {
		t.Fatalf("unexpected rewrite rules: %+v", plan.RewriteRules)
	}
}

func TestLoadProviders_leaves_optional_plan_empty_without_assignments(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	globalRule := model.RewriteRule{ID: "global", Name: "global", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&globalRule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// When
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	plan, err := engine.GetPlan(provider.ID)

	// Then
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.RewriteRules) != 0 || len(plan.ConcurrencyRules) != 0 || len(plan.FailoverRules) != 0 {
		t.Fatalf("optional plan was populated globally: %+v", plan)
	}
}

func TestRefreshPlans_preserves_working_plan_when_candidate_has_disabled_rule(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("initial load: %v", err)
	}
	disabledRule := model.RewriteRule{ID: "disabled", Name: "disabled", Status: false}
	assignment := model.TopologySlotAssignment{ID: "bad", ProviderID: provider.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer(disabledRule.ID), Config: `{}`}
	if err := db.Create(&disabledRule).Error; err != nil {
		t.Fatalf("create disabled rule: %v", err)
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}

	// When
	err := engine.RefreshPlans()

	// Then
	if err == nil {
		t.Fatal("refresh unexpectedly succeeded")
	}
	plan, getErr := engine.GetPlan(provider.ID)
	if getErr != nil || len(plan.RewriteRules) != 0 {
		t.Fatalf("working plan was removed or changed: plan=%+v err=%v", plan, getErr)
	}
}

func TestInvalidatePlan_preserves_working_plan_when_candidate_fails(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("initial load: %v", err)
	}
	disabledRule := model.RewriteRule{ID: "disabled", Name: "disabled", Status: false}
	assignment := model.TopologySlotAssignment{ID: "bad", ProviderID: provider.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer(disabledRule.ID), Config: `{}`}
	if err := db.Create(&disabledRule).Error; err != nil {
		t.Fatalf("create disabled rule: %v", err)
	}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}

	// When
	engine.InvalidatePlan(provider.ID)
	plan, err := engine.GetPlan(provider.ID)

	// Then
	if err != nil {
		t.Fatalf("working plan was removed: %v", err)
	}
	if len(plan.RewriteRules) != 0 {
		t.Fatalf("working plan changed after failed invalidation: %+v", plan.RewriteRules)
	}
}

func stringPointer(value string) *string {
	return &value
}

func TestLoadProvidersDropsDisabledProviders(t *testing.T) {
	engine, db := newTestEngine(t)

	enabled := model.Provider{
		ID:       "provider-enabled",
		Name:     "enabled",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&enabled).Error; err != nil {
		t.Fatalf("create enabled provider: %v", err)
	}

	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetProvider("provider-enabled"); err != nil {
		t.Fatalf("enabled provider should be present after first load: %v", err)
	}

	if err := db.Model(&model.Provider{}).
		Where("id = ?", "provider-enabled").
		Update("status", false).Error; err != nil {
		t.Fatalf("disable provider: %v", err)
	}

	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetProvider("provider-enabled"); err == nil {
		t.Fatalf("disabled provider must be evicted from cache after LoadProviders")
	}

	if _, err := engine.GetPlan("provider-enabled"); err == nil {
		t.Fatalf("plan for disabled provider must be evicted")
	}
}

func TestLoadProvidersDropsDeletedProviders(t *testing.T) {
	engine, db := newTestEngine(t)

	p := model.Provider{
		ID:       "provider-doomed",
		Name:     "doomed",
		BaseURLs: "[]",
		Keys:     "[]",
		Models:   "[]",
		Status:   true,
	}
	if err := db.Create(&p).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if _, err := engine.GetProvider("provider-doomed"); err != nil {
		t.Fatalf("provider should be present after first load: %v", err)
	}

	if err := db.Delete(&model.Provider{}, "id = ?", "provider-doomed").Error; err != nil {
		t.Fatalf("delete provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if _, err := engine.GetProvider("provider-doomed"); err == nil {
		t.Fatalf("deleted provider must be evicted from cache after LoadProviders")
	}
}

func TestRelayRequest_runs_selected_response_and_log_stages_in_pipeline_order(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	responseRule := model.ResponseRewriteRule{ID: "response-rule", Name: "response", Status: true}
	if err := db.Create(&responseRule).Error; err != nil {
		t.Fatalf("create response rule: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	plan := &ExecutionPlan{
		Provider:                 &model.Provider{BaseURLs: `["` + server.URL + `"]`, Keys: `["key"]`},
		BaseURLs:                 []string{server.URL},
		Keys:                     []string{"key"},
		ResponseRewriteRules:     []*model.ResponseRewriteRule{&responseRule},
		LogOutputs:               []LogOutputAssignment{{ID: "log", Order: 1, Enabled: true, Config: `{}`}},
		CompiledResponseRewrites: []CompiledRewriteChain{},
	}
	events := make([]topologyStageEvent, 0, 6)
	engine.topologyStageHook = func(event topologyStageEvent) {
		events = append(events, event)
	}

	// When
	response, err := engine.RelayRequest(context.Background(), plan, &RelayRequest{RequestID: "req-1"})

	// Then
	if err != nil {
		t.Fatalf("relay request: %v", err)
	}
	defer response.Body.Close()
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatalf("read response: %v", err)
	}
	wantStages := []topologyStage{
		topologyStageRequestBefore,
		topologyStageRequestAfter,
		topologyStageRelay,
		topologyStageResponseBefore,
		topologyStageResponseRewrite,
		topologyStageResponseAfter,
	}
	if len(events) != len(wantStages) {
		t.Fatalf("event count: want %d, got %d (%+v)", len(wantStages), len(events), events)
	}
	for index, want := range wantStages {
		if events[index].Stage != want {
			t.Fatalf("stage %d: want %q, got %q", index, want, events[index].Stage)
		}
		expectLogOutputs := index != 2 && index != 4
		if expectLogOutputs && len(events[index].LogOutputs) != 1 {
			t.Fatalf("stage %q did not receive selected log output: %+v", want, events[index].LogOutputs)
		}
		if events[index].ProviderID != plan.ID {
			t.Fatalf("stage %q missing ProviderID: %+v", want, events[index])
		}
		if events[index].RequestID != "req-1" {
			t.Fatalf("stage %q missing RequestID: %+v", want, events[index])
		}
	}
	if len(events[4].ResponseRewriteRules) != 1 || events[4].ResponseRewriteRules[0].ID != responseRule.ID {
		t.Fatalf("response rewrite stage did not receive selected rule: %+v", events[4].ResponseRewriteRules)
	}
}

func TestRelayRequest_recordsQueueWaitMs(t *testing.T) {
	// Given: a fast upstream and a plan with a concurrency rule (no queueing
	// pressure in this test, so QueueWaitMs is 0 rather than -1).
	engine, _ := newTestEngine(t)
	concurrencyRule := &ConcurrencyRule{ID: "cq-test", WindowMinutes: 5, MaxCount: 4}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	withRule := &ExecutionPlan{
		Provider:         &model.Provider{BaseURLs: `["` + server.URL + `"]`, Keys: `["key"]`},
		BaseURLs:         []string{server.URL},
		Keys:             []string{"key"},
		ConcurrencyRules: []*ConcurrencyRule{concurrencyRule},
	}
	withoutRule := &ExecutionPlan{
		Provider: &model.Provider{BaseURLs: `["` + server.URL + `"]`, Keys: `["key"]`},
		BaseURLs: []string{server.URL},
		Keys:     []string{"key"},
	}
	engine.topologyStageHook = func(topologyStageEvent) {}

	// When: run one request with the concurrency rule and one without.
	withResp, err := engine.RelayRequest(context.Background(), withRule, &RelayRequest{RequestID: "with-rule"})
	if err != nil {
		t.Fatalf("relay with rule: %v", err)
	}
	_, _ = io.ReadAll(withResp.Body)
	withResp.Body.Close()

	withoutResp, err := engine.RelayRequest(context.Background(), withoutRule, &RelayRequest{RequestID: "without-rule"})
	if err != nil {
		t.Fatalf("relay without rule: %v", err)
	}
	_, _ = io.ReadAll(withoutResp.Body)
	withoutResp.Body.Close()

	// Then: the rule-carrying request reports a real queue wait (0ms when
	// no contention), the rule-less one stays at -1 (not applicable).
	if withResp.QueueWaitMs < 0 {
		t.Fatalf("QueueWaitMs should be >= 0 with a concurrency rule, got %d", withResp.QueueWaitMs)
	}
	if withoutResp.QueueWaitMs != -1 {
		t.Fatalf("QueueWaitMs should be -1 without a concurrency rule, got %d", withoutResp.QueueWaitMs)
	}
}
