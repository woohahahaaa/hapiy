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
	if err := db.Create(&model.ProviderDisableState{ProviderID: "disabled", Dimension: model.FailoverDimensionProvider, Value: "disabled", Disabled: true}).Error; err != nil {
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
	if err := db.AutoMigrate(&model.ProviderDisableState{}); err != nil {
		t.Fatalf("migrate disable state: %v", err)
	}
	providers := []model.Provider{
		{ID: "disabled", Name: "disabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
		{ID: "enabled", Name: "enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	state := model.ProviderDisableState{ProviderID: "disabled", Dimension: model.FailoverDimensionProvider, Value: "disabled", Disabled: true}
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
	],"wires":[{"source":"entry","target":"slot"},{"source":"slot","target":"disabled-node"},{"source":"slot","target":"enabled-node"}]}`)

	// When
	result, err := engine.Dispatch("m1", "/v1/chat/completions", nil)

	// Then
	if err == nil {
		t.Fatalf("dispatch selected disabled provider: %+v", result)
	}
}

func TestDispatch_affinityFallsBackWhenRecalledProviderIsLegacyAutoDisabled(t *testing.T) {
	// Given
	engine, db := newTestEngine(t)
	providers := []model.Provider{
		{ID: "disabled", Name: "disabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true, AutoDisabled: true},
		{ID: "enabled", Name: "enabled", BaseURLs: `[]`, Keys: `[]`, Models: `[{"model":"m1"}]`, Status: true, WorkflowEnabled: true},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}
	if err := affinity.NewStore(db).Save(&affinity.AffinitySetting{Rules: []affinity.Rule{{Name: "by-user", Enabled: true, KeySources: []affinity.KeySource{{Type: affinity.SourceRequestHeader, Key: "X-User"}}}}}); err != nil {
		t.Fatalf("save affinity rules: %v", err)
	}
	engine.ReloadAffinity()
	engine.Affinity().Record("by-user", false, "m1", "alice", affinity.Triple{ProviderName: "disabled", KeyIndex: -1, BaseURLIndex: -1}, 60)
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
		t.Fatalf("provider: want enabled, got %q", result.Provider.ID)
	}
}

func TestRelayWithFailover_skipsPersistedProviderDisabledFallback(t *testing.T) {
	// Given
	db := newRelayTestDB(t, &model.Provider{}, &model.ProviderDisableState{})
	if err := db.Create(&model.Provider{ID: "primary", Name: "primary"}).Error; err != nil {
		t.Fatalf("create primary provider: %v", err)
	}
	if err := db.Create(&model.Provider{ID: "fallback", Name: "fallback"}).Error; err != nil {
		t.Fatalf("create fallback provider: %v", err)
	}
	state := model.ProviderDisableState{ProviderID: "fallback", Dimension: model.FailoverDimensionProvider, Value: "fallback", Disabled: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatalf("create disable state: %v", err)
	}
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()
	fallbackHits := 0
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackHits++
		w.WriteHeader(http.StatusOK)
	}))
	defer fallback.Close()
	engine := NewEngine(db)
	primaryPlan := &ExecutionPlan{Provider: &model.Provider{ID: "primary", Name: "primary"}, BaseURLs: []string{primary.URL}, Keys: []string{"key"}, FailoverRules: []*model.FailoverRule{{Condition: "error", FallbackProvider: "fallback", Actions: []model.FailoverAction{{Dimension: model.FailoverDimensionProvider}}}}}
	fallbackPlan := &ExecutionPlan{Provider: &model.Provider{ID: "fallback", Name: "fallback"}, BaseURLs: []string{fallback.URL}, Keys: []string{"key"}}
	engine.plans["primary"] = primaryPlan
	engine.plans["fallback"] = fallbackPlan

	// When
	_, err := engine.relayWithFailover(context.Background(), primaryPlan, &RelayRequest{})

	// Then
	if err == nil {
		t.Fatal("expected original primary error when fallback is disabled")
	}
	if fallbackHits != 0 {
		t.Fatalf("fallback hits: want 0, got %d", fallbackHits)
	}
}
