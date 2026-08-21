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
	got, err := engine.SelectProvider("supported-model", "")
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if got.ID != provider.ID {
		t.Fatalf("selected provider: want %s, got %s", provider.ID, got.ID)
	}
	if _, err := engine.SelectProvider("not-supported", ""); err == nil {
		t.Fatal("expected error for unsupported model")
	}
}

func TestSelectProvider_filtersByAllowedPath(t *testing.T) {
	engine, db := newTestEngine(t)

	// Both providers support the same model. Only p-responses declares
	// an endpoint restriction, so a /v1/chat/completions request must
	// pick p-any and a /v1/responses request must pick p-responses.
	restricted := model.Provider{
		ID:        "p-responses",
		Name:      "responses-only",
		BaseURLs:  `["https://responses.example.com"]`,
		Keys:      `["k"]`,
		Models:    `[{"model":"minimax-m3"}]`,
		Endpoints: `[{"name":"responses","pathSuffix":"/v1/responses"}]`,
		Status:    true,
	}
	unrestricted := model.Provider{
		ID:       "p-any",
		Name:     "any-endpoint",
		BaseURLs: `["https://any.example.com"]`,
		Keys:     `["k"]`,
		Models:   `[{"model":"minimax-m3"}]`,
		Status:   true,
	}
	if err := db.Create(&restricted).Error; err != nil {
		t.Fatalf("create restricted: %v", err)
	}
	if err := db.Create(&unrestricted).Error; err != nil {
		t.Fatalf("create unrestricted: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load: %v", err)
	}

	got, err := engine.SelectProvider("minimax-m3", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("select chat: %v", err)
	}
	if got.ID != unrestricted.ID {
		t.Fatalf("chat completions should pick %s, got %s", unrestricted.ID, got.ID)
	}

	got, err = engine.SelectProvider("minimax-m3", "/v1/responses")
	if err != nil {
		t.Fatalf("select responses: %v", err)
	}
	if got.ID != restricted.ID {
		t.Fatalf("responses should pick %s, got %s", restricted.ID, got.ID)
	}

	// Sanity: when every provider that matches the model disallows the
	// path, the call must return ErrNoProvider rather than silently pick a
	// mismatched upstream.
	onlyRestricted := model.Provider{
		ID:        "p-only",
		Name:      "only-responses",
		BaseURLs:  `["https://only.example.com"]`,
		Keys:      `["k"]`,
		Models:    `[{"model":"lone-model"}]`,
		Endpoints: `[{"name":"responses","pathSuffix":"/v1/responses"}]`,
		Status:    true,
	}
	if err := db.Create(&onlyRestricted).Error; err != nil {
		t.Fatalf("create only-restricted: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if _, err := engine.SelectProvider("lone-model", "/v1/chat/completions"); err == nil {
		t.Fatal("expected error when only provider disallows the path")
	}
}

func TestLoadProviders_treatsMalformedEndpointsAsUnrestricted(t *testing.T) {
	engine, db := newTestEngine(t)
	provider := model.Provider{
		ID:        "p-bad-ep",
		Name:      "bad-ep",
		BaseURLs:  `["https://a.example.com"]`,
		Keys:      `["k"]`,
		Models:    `[{"model":"m1"}]`,
		Endpoints: `not json`,
		Status:    true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load: %v", err)
	}
	got, err := engine.SelectProvider("m1", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("malformed endpoints must not block selection: %v", err)
	}
	if got.ID != provider.ID {
		t.Fatalf("selected: want %s, got %s", provider.ID, got.ID)
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
