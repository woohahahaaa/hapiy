package relay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

func TestLoadProviders_preparsesBaseURLsKeysAndModels(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:       "p-pre",
		Name:     "pre",
		BaseURLs: `["https://a.example.com","https://b.example.com"]`,
		Keys:     `["k1","k2"]`,
		Models:   `[{"model":"m1"},{"model":"m2"}]`,
		Status:   true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load: %v", err)
	}
	plan, err := engine.GetPlan(provider.ID)
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if len(plan.BaseURLs) != 2 || plan.BaseURLs[0] != "https://a.example.com" {
		t.Fatalf("BaseURLs not pre-parsed: %+v", plan.BaseURLs)
	}
	if len(plan.Keys) != 2 || plan.Keys[1] != "k2" {
		t.Fatalf("Keys not pre-parsed: %+v", plan.Keys)
	}
	if _, ok := plan.ModelSet["m1"]; !ok {
		t.Fatalf("ModelSet missing m1: %+v", plan.ModelSet)
	}
	if _, ok := plan.ModelSet["m2"]; !ok {
		t.Fatalf("ModelSet missing m2: %+v", plan.ModelSet)
	}
	if _, ok := plan.ModelSet["m3"]; ok {
		t.Fatalf("ModelSet should not contain m3")
	}
}

func TestLoadProviders_rejectsMalformedBaseURLsJSON(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:       "p-bad",
		Name:     "bad",
		BaseURLs: `not json`,
		Keys:     `[]`,
		Models:   `[]`,
		Status:   true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	err := engine.LoadProviders()
	if err == nil {
		t.Fatal("expected error from malformed base_urls JSON")
	}
	if !strings.Contains(err.Error(), "invalid JSON in base_urls") {
		t.Fatalf("expected error to mention base_urls, got %v", err)
	}
}

func TestLoadProviders_rejectsMalformedKeysJSON(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:       "p-bad",
		Name:     "bad",
		BaseURLs: `[]`,
		Keys:     `not json`,
		Models:   `[]`,
		Status:   true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	err := engine.LoadProviders()
	if err == nil {
		t.Fatal("expected error from malformed keys JSON")
	}
	if !strings.Contains(err.Error(), "invalid JSON in keys") {
		t.Fatalf("expected error to mention keys, got %v", err)
	}
}

func TestSelectProvider_usesPreParsedModelSet(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:       "p1",
		Name:     "p1",
		BaseURLs: `["https://a.example.com"]`,
		Keys:     `["k"]`,
		Models:   `[{"model":"supported-model"}]`,
		Status:   true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load: %v", err)
	}
	got, err := engine.SelectProvider("supported-model")
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if got.ID != provider.ID {
		t.Fatalf("selected provider: want %s, got %s", provider.ID, got.ID)
	}
	if _, err := engine.SelectProvider("not-supported"); err == nil {
		t.Fatal("expected error for unsupported model")
	}
}

func TestRelayRequest_propagatesProviderIDAndRequestIDToEvents(t *testing.T) {
	engine, db := newTestEngine(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	provider := model.Provider{ID: "p", Name: "p", BaseURLs: `["` + server.URL + `"]`, Keys: `["k"]`, Models: `[]`, Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load: %v", err)
	}
	plan, err := engine.GetPlan(provider.ID)
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	var events []topologyStageEvent
	engine.topologyStageHook = func(e topologyStageEvent) {
		events = append(events, e)
	}
	resp, err := engine.RelayRequest(context.Background(), plan, &RelayRequest{RequestID: "req-xyz"})
	if err != nil {
		t.Fatalf("relay: %v", err)
	}
	defer resp.Body.Close()
	if len(events) == 0 {
		t.Fatal("no stage events captured")
	}
	for idx, e := range events {
		if e.ProviderID != plan.ID {
			t.Fatalf("event %d: ProviderID missing (want %s, got %q)", idx, plan.ID, e.ProviderID)
		}
		if e.RequestID != "req-xyz" {
			t.Fatalf("event %d: RequestID missing (want req-xyz, got %q)", idx, e.RequestID)
		}
	}
}

func TestRewriteRule_compilationFailsPlanBuild(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{ID: "p", Name: "p", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	rule := model.RewriteRule{ID: "r", Name: "r", Script: `[{"mode":"unknown"}]`, Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	assignment := model.TopologySlotAssignment{ID: "a", ProviderID: provider.ID, SlotType: "requestModify", Order: 1, Enabled: true, RuleID: stringPointer("r"), Config: "{}"}
	if err := db.Create(&assignment).Error; err != nil {
		t.Fatalf("create assignment: %v", err)
	}
	err := engine.LoadProviders()
	if err == nil {
		t.Fatal("expected plan build to fail with bad rewrite script")
	}
	if !strings.Contains(err.Error(), "compile rewrite rule r") {
		t.Fatalf("expected error to name the rule, got %v", err)
	}
}
