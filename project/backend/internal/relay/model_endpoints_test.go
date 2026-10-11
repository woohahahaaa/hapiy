package relay

import (
	"errors"
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

// twoLaneProviders builds the scenario from the model-endpoint design: the
// same model name is served by two providers, one declaring only the chat
// completions protocol and one only the responses protocol.
func twoLaneProviders() (chatOnly, responsesOnly model.Provider) {
	chatOnly = model.Provider{
		ID: "p-chat", Name: "chat-only",
		BaseURLs: `["https://chat.example.com"]`, Keys: `["k"]`,
		Models:          `[{"model":"deepseek-v4","endpoints":["/v1/chat/completions"],"rate":"1"}]`,
		Status:          true,
		WorkflowEnabled: true,
	}
	responsesOnly = model.Provider{
		ID: "p-responses", Name: "responses-only",
		BaseURLs: `["https://responses.example.com"]`, Keys: `["k"]`,
		Models:          `[{"model":"deepseek-v4","endpoints":["/v1/responses"],"rate":"1"}]`,
		Status:          true,
		WorkflowEnabled: true,
	}
	return chatOnly, responsesOnly
}

func TestSelectProvider_routesByModelEndpoints(t *testing.T) {
	engine, db := newTestEngine(t)
	chatOnly, responsesOnly := twoLaneProviders()
	if err := db.Create(&chatOnly).Error; err != nil {
		t.Fatalf("create chat provider: %v", err)
	}
	if err := db.Create(&responsesOnly).Error; err != nil {
		t.Fatalf("create responses provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	got, err := engine.SelectProvider("deepseek-v4", "/v1/responses")
	if err != nil {
		t.Fatalf("select responses: %v", err)
	}
	if got.ID != responsesOnly.ID {
		t.Fatalf("responses request must pick %s, got %s", responsesOnly.ID, got.ID)
	}

	got, err = engine.SelectProvider("deepseek-v4", "/v1/chat/completions")
	if err != nil {
		t.Fatalf("select chat: %v", err)
	}
	if got.ID != chatOnly.ID {
		t.Fatalf("chat request must pick %s, got %s", chatOnly.ID, got.ID)
	}
}

func TestSelectProvider_modelEndpointsOverrideProviderWhitelist(t *testing.T) {
	engine, db := newTestEngine(t)
	// The provider-level whitelist still says chat-only, but the model
	// explicitly declares responses: the model-level list wins.
	provider := model.Provider{
		ID: "p", Name: "p",
		BaseURLs: `["https://a.example.com"]`, Keys: `["k"]`,
		Models:    `[{"model":"m1","endpoints":["/v1/responses"],"rate":"1"}]`,
		Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`,
		Status:    true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	if _, err := engine.SelectProvider("m1", "/v1/responses"); err != nil {
		t.Fatalf("model-level endpoint must win over the provider whitelist: %v", err)
	}
	if _, err := engine.SelectProvider("m1", "/v1/chat/completions"); err == nil {
		t.Fatal("path outside the model-level list must not be served")
	}
}

func TestSelectProvider_legacyModelFallsBackToProviderWhitelist(t *testing.T) {
	engine, db := newTestEngine(t)
	// Legacy row: the model carries no endpoints, so the provider-level
	// whitelist keeps applying exactly as before the per-model change.
	provider := model.Provider{
		ID: "p-legacy", Name: "legacy",
		BaseURLs: `["https://a.example.com"]`, Keys: `["k"]`,
		Models:    `[{"model":"m1"}]`,
		Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`,
		Status:    true,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	if _, err := engine.SelectProvider("m1", "/v1/chat/completions"); err != nil {
		t.Fatalf("legacy provider whitelist must still apply: %v", err)
	}
	if _, err := engine.SelectProvider("m1", "/v1/responses"); err == nil {
		t.Fatal("legacy provider whitelist must still reject other paths")
	}
}

func TestDispatch_topologyRoutesByModelEndpoints(t *testing.T) {
	engine, db := newTestEngine(t)
	chatOnly, responsesOnly := twoLaneProviders()
	if err := db.Create(&chatOnly).Error; err != nil {
		t.Fatalf("create chat provider: %v", err)
	}
	if err := db.Create(&responsesOnly).Error; err != nil {
		t.Fatalf("create responses provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}
	seedFlatTopology(t, db, `{"nodes":[
		{"id":"entry","kind":"requestEntry","enabled":true,"weight":1},
		{"id":"slot","kind":"slot","slot_type":"provider","enabled":true},
		{"id":"chat-node","kind":"provider","provider_id":"p-chat","enabled":true},
		{"id":"responses-node","kind":"provider","provider_id":"p-responses","enabled":true}
	],"wires":[
		{"source":"entry","target":"slot"},
		{"source":"slot","target":"chat-node"}
	]}`)

	result, err := engine.Dispatch("deepseek-v4", "/v1/responses", nil)
	if err != nil {
		t.Fatalf("dispatch responses: %v", err)
	}
	if result.Provider.ID != responsesOnly.ID {
		t.Fatalf("topology walk must skip the chat-only provider for /v1/responses, got %s", result.Provider.ID)
	}

	result, err = engine.Dispatch("deepseek-v4", "/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("dispatch chat: %v", err)
	}
	if result.Provider.ID != chatOnly.ID {
		t.Fatalf("topology walk must pick the chat-only provider for /v1/chat/completions, got %s", result.Provider.ID)
	}
}

func TestNoProviderError_classifiesPathUnsupported(t *testing.T) {
	engine, db := newTestEngine(t)
	chatOnly, _ := twoLaneProviders()
	if err := db.Create(&chatOnly).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	_, err := engine.Dispatch("deepseek-v4", "/v1/responses", nil)
	var noProvider *NoProviderError
	if !errors.As(err, &noProvider) {
		t.Fatalf("want *NoProviderError, got %v", err)
	}
	if noProvider.Reason != NoProviderReasonPathUnsupported {
		t.Fatalf("reason: want %s, got %s", NoProviderReasonPathUnsupported, noProvider.Reason)
	}
	if len(noProvider.AllowedPaths) != 1 || noProvider.AllowedPaths[0] != "/v1/chat/completions" {
		t.Fatalf("declared endpoints: %+v", noProvider.AllowedPaths)
	}
	if !errors.Is(err, ErrNoProvider) {
		t.Fatal("classified error must still match the ErrNoProvider sentinel")
	}
}

func TestNoProviderError_reportsAutoDisabledProvider(t *testing.T) {
	engine, db := newTestEngine(t)
	chatOnly, responsesOnly := twoLaneProviders()
	if err := db.Create(&chatOnly).Error; err != nil {
		t.Fatalf("create chat provider: %v", err)
	}
	if err := db.Create(&responsesOnly).Error; err != nil {
		t.Fatalf("create responses provider: %v", err)
	}
	if err := db.Create(&model.AutoDisableState{
		ProviderID: responsesOnly.ID, Dimension: model.FailoverDimensionProvider,
		Value: responsesOnly.ID, Disabled: true,
	}).Error; err != nil {
		t.Fatalf("disable provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	// /v1/responses is declared by the responses provider only — and that
	// provider is auto-disabled right now, so the error must name it.
	_, err := engine.Dispatch("deepseek-v4", "/v1/responses", nil)
	var noProvider *NoProviderError
	if !errors.As(err, &noProvider) {
		t.Fatalf("want *NoProviderError, got %v", err)
	}
	if noProvider.Reason != NoProviderReasonProviderDisabled {
		t.Fatalf("reason: want %s, got %s", NoProviderReasonProviderDisabled, noProvider.Reason)
	}
	if len(noProvider.DisabledProviders) != 1 || noProvider.DisabledProviders[0] != responsesOnly.Name {
		t.Fatalf("disabled providers: %+v", noProvider.DisabledProviders)
	}
	// The chat-only provider is enabled but does not support the path; the
	// chat path itself must keep working.
	if _, err := engine.Dispatch("deepseek-v4", "/v1/chat/completions", nil); err != nil {
		t.Fatalf("chat path should still dispatch to the enabled provider: %v", err)
	}
}

func TestNoProviderError_classifiesModelUnknown(t *testing.T) {
	engine, db := newTestEngine(t)
	chatOnly, _ := twoLaneProviders()
	if err := db.Create(&chatOnly).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	if err := engine.LoadProviders(); err != nil {
		t.Fatalf("load providers: %v", err)
	}

	_, err := engine.Dispatch("not-a-model", "/v1/chat/completions", nil)
	var noProvider *NoProviderError
	if !errors.As(err, &noProvider) {
		t.Fatalf("want *NoProviderError, got %v", err)
	}
	if noProvider.Reason != NoProviderReasonModelUnknown {
		t.Fatalf("reason: want %s, got %s", NoProviderReasonModelUnknown, noProvider.Reason)
	}
}

func TestPathsForModel_prefersModelEndpointsAndFallsBack(t *testing.T) {
	provider := &model.Provider{
		Models:    `[{"model":"m1","endpoints":["/v1/responses"]},{"model":"m2"}]`,
		Endpoints: `[{"pathSuffix":"/v1/chat/completions"}]`,
	}
	if got := PathsForModel(provider, "m1"); len(got) != 1 || got[0] != "/v1/responses" {
		t.Fatalf("m1 endpoints: %+v", got)
	}
	if got := PathsForModel(provider, "m2"); len(got) != 1 || got[0] != "/v1/chat/completions" {
		t.Fatalf("m2 should fall back to provider endpoints: %+v", got)
	}
	unrestricted := &model.Provider{Models: `[{"model":"m1"}]`}
	if got := PathsForModel(unrestricted, "m1"); got != nil {
		t.Fatalf("unrestricted provider must return nil, got %+v", got)
	}
}
