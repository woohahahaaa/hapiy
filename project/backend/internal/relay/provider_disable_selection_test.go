package relay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hapiy/hapiy/internal/affinity"
	"github.com/hapiy/hapiy/internal/model"
)

func TestSelectProvider_skipsPersistedProviderDisable(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "disabled", Name: "disabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "enabled", Name: "enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{ProviderID: "disabled", Dimension: model.FailoverDimensionProvider, Value: "disabled", Disabled: true}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// When
	provider, err := engine.SelectProvider("m1", "")

	// Then
	if err != nil {
		t.Fatalf("select provider: %v", err)
	}
	if provider.ID != "enabled" {
		t.Fatalf("provider: want enabled, got %q", provider.ID)
	}
}

func TestDispatch_flatTopologySkipsPersistedProviderDisable(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	if err := db.AutoMigrate(&model.AutoDisableState{}); err != nil {
		t.Fatalf("migrate disable state: %v", err)
	}
	providers := []model.Provider{
		{ID: "disabled", Name: "disabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "enabled", Name: "enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	state := model.AutoDisableState{ProviderID: "disabled", Dimension: model.FailoverDimensionProvider, Value: "disabled", Disabled: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"slot","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"disabled-node","kind":"provider","provider_id":"disabled","enabled":true},
		{"id":"enabled-node","kind":"provider","provider_id":"enabled","enabled":true}
	],"wires":[{"source":"entry","target":"slot"},{"source":"slot","target":"disabled-node"}]}`)

	// When
	result, err := engine.Dispatch("m1", "/v1/chat/completions", nil)

	// Then
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if result.Provider.ID != "enabled" {
		t.Fatalf("dispatch selected %q, want enabled provider", result.Provider.ID)
	}
}

func TestDispatch_affinityFallsBackWhenRecalledProviderIsAutoDisabled(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "disabled", Name: "disabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "enabled", Name: "enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{ProviderID: "disabled", Dimension: model.FailoverDimensionProvider, Value: "disabled", Disabled: true}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, SessionIDFields: []string{"X-User"}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	engine.Affinity().Record("by-user", "alice", "m1", affinity.Triple{ProviderName: "disabled", KeyIndex: -1, BaseURLIndex: -1}, 60)
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// When
	result, err := engine.Dispatch("m1", "", &affinity.Request{Model: "m1", Headers: map[string]string{"X-User": "alice"}})

	// Then
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if result.Provider.ID != "enabled" {
		t.Fatalf("expected affinity-fallback to land on enabled, got %q", result.Provider.ID)
	}
}

func TestSelectProvider_skipsProviderWhoseAllKeysAutoDisabled(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "deadkeys", Name: "deadkeys", BaseURLs: `["https://d.example.com"]`, Keys: `["k1","k2"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "alive", Name: "alive", BaseURLs: `["https://a.example.com"]`, Keys: `["k3"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	for _, key := range []string{"k1", "k2"} {
		if err := db.Create(&model.AutoDisableState{ProviderID: "deadkeys", Dimension: model.FailoverDimensionKey, Value: key, Disabled: true}).Error; err != nil {
			t.Fatalf("create disable state for %s: %v", key, err)
		}
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// When
	provider, err := engine.SelectProvider("m1", "")

	// Then
	if err != nil {
		t.Fatalf("select provider: %v", err)
	}
	if provider.ID != "alive" {
		t.Fatalf("provider: want alive, got %q", provider.ID)
	}
}

func TestSelectProvider_skipsProviderWhoseAllBaseURLsAutoDisabled(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "deadurl", Name: "deadurl", BaseURLs: `["https://d.example.com"]`, Keys: `["k1"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "alive", Name: "alive", BaseURLs: `["https://a.example.com"]`, Keys: `["k3"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{ProviderID: "deadurl", Dimension: model.FailoverDimensionBaseURL, Value: "https://d.example.com", Disabled: true}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// When
	provider, err := engine.SelectProvider("m1", "")

	// Then
	if err != nil {
		t.Fatalf("select provider: %v", err)
	}
	if provider.ID != "alive" {
		t.Fatalf("provider: want alive, got %q", provider.ID)
	}
}

func TestSelectProvider_keepsProviderWhenOnlySomeKeysAutoDisabled(t *testing.T) {
	// Given: one of the provider's two keys is disabled, the other is not —
	// the provider must stay eligible.
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "half", Name: "half", BaseURLs: `["https://h.example.com"]`, Keys: `["k1","k2"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{ProviderID: "half", Dimension: model.FailoverDimensionKey, Value: "k1", Disabled: true}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// When
	got, err := engine.SelectProvider("m1", "")

	// Then
	if err != nil {
		t.Fatalf("select provider: %v", err)
	}
	if got.ID != "half" {
		t.Fatalf("provider: want half, got %q", got.ID)
	}
}

func TestDispatch_flatTopologySkipsProviderWhoseAllKeysDisabled(t *testing.T) {
	// Given: the provider slot wires a single provider whose every key is
	// auto-disabled — dispatch must treat it as unavailable (no provider)
	// instead of routing into a guaranteed "no enabled API key" failure.
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "deadkeys", Name: "deadkeys", BaseURLs: `["https://d.example.com"]`, Keys: `["k1","k2"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	for _, key := range []string{"k1", "k2"} {
		if err := db.Create(&model.AutoDisableState{ProviderID: "deadkeys", Dimension: model.FailoverDimensionKey, Value: key, Disabled: true}).Error; err != nil {
			t.Fatalf("create disable state for %s: %v", key, err)
		}
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"slot","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"prov","kind":"provider","provider_id":"deadkeys","enabled":true}
	],"wires":[{"source":"entry","target":"slot"},{"source":"slot","target":"prov"}]}`)

	// When
	_, err := engine.Dispatch("m1", "/v1/chat/completions", nil)

	// Then
	if err == nil {
		t.Fatal("expected dispatch to find no provider when every key is auto-disabled")
	}
}

func TestDispatch_affinityFallsBackWhenRecalledProviderHasAllKeysDisabled(t *testing.T) {
	// Given: the affinity cache recalls a provider whose whole key pool got
	// auto-disabled — the hint must not be honored and selection must fall
	// back to an eligible provider.
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "deadkeys", Name: "deadkeys", BaseURLs: `["https://d.example.com"]`, Keys: `["k1"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "alive", Name: "alive", BaseURLs: `["https://a.example.com"]`, Keys: `["k3"]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{ProviderID: "deadkeys", Dimension: model.FailoverDimensionKey, Value: "k1", Disabled: true}).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, SessionIDFields: []string{"X-User"}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	engine.Affinity().Record("by-user", "alice", "m1", affinity.Triple{ProviderName: "deadkeys", KeyIndex: 0, BaseURLIndex: 0}, 60)
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"slot","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"dead-node","kind":"provider","provider_id":"deadkeys","enabled":true},
		{"id":"alive-node","kind":"provider","provider_id":"alive","enabled":true}
	],"wires":[{"source":"entry","target":"slot"},{"source":"slot","target":"dead-node"}]}`)

	// When
	result, err := engine.Dispatch("m1", "/v1/chat/completions", &affinity.Request{Model: "m1", Headers: map[string]string{"X-User": "alice"}})

	// Then
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if result.Provider.ID != "alive" {
		t.Fatalf("expected affinity-fallback to land on alive, got %q", result.Provider.ID)
	}
}

func TestRelayWithFailover_skipsPersistedProviderDisabledFallback(t *testing.T) {
	primaryHits := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		primaryHits++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	eng := NewEngine(nil)
	primaryPlan := &ExecutionPlan{
		ID:       "primary",
		Provider: &model.Provider{ID: "primary", Name: "primary"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
		FailoverRules: []*model.FailoverRule{
			{Condition: "error", Dimension: model.FailoverDimensionProvider, FallbackProvider: "fallback"},
		},
	}
	fallbackPlan := &ExecutionPlan{
		ID:       "fallback",
		Provider: &model.Provider{ID: "fallback", Name: "fallback"},
		BaseURLs: []string{primary.URL},
		Keys:     []string{"k"},
	}
	eng.plansMu.Lock()
	eng.plans["primary"] = primaryPlan
	eng.plans["fallback"] = fallbackPlan
	eng.plansMu.Unlock()
	eng.providersMu.Lock()
	eng.providers["primary"] = primaryPlan.Provider
	eng.providers["fallback"] = fallbackPlan.Provider
	eng.providersMu.Unlock()

	_, err := eng.relayWithFailover(context.Background(), primaryPlan, &RelayRequest{})
	if err == nil {
		t.Fatal("expected error after exhausted primary+fallback")
	}
	if primaryHits != 2 {
		t.Fatalf("expected exactly 2 hits (primary + 1 retry), got %d", primaryHits)
	}
}
