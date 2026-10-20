package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newTestDB builds an in-memory database with a small, representative slice of
// gateway data: one enabled provider with two models, one disabled provider,
// one auto-disabled key, one token, one usage log and the lifetime counter.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	providers := []model.Provider{
		{
			ID:              "p-openai",
			Name:            "OpenAI",
			Status:          true,
			WorkflowEnabled: true,
			Endpoints:       `["/v1/chat/completions","/v1/embeddings"]`,
			Models:          `[{"model":"gpt-4o","endpoints":["/v1/chat/completions"]},{"model":"text-embedding-3-small","endpoints":["/v1/embeddings"]}]`,
			BaseURLs:        `["https://api.openai.com/v1"]`,
			Keys:            `["sk-secret-openai-1234"]`,
			Weight:          3,
			Priority:        1,
			Group:           "primary",
		},
		{
			ID:              "p-backup",
			Name:            "Backup",
			Status:          false,
			WorkflowEnabled: true,
			Endpoints:       `["/v1/chat/completions"]`,
			Models:          `["gpt-4o"]`,
			BaseURLs:        `["https://backup.example.com/v1"]`,
			Keys:            `["sk-backup-key-9999"]`,
		},
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatal(err)
	}
	// Provider.Status carries `default:true`; GORM substitutes the default for
	// the zero value on create, so the disabled row needs an explicit update.
	if err := db.Model(&model.Provider{}).Where("id = ?", "p-backup").Update("status", false).Error; err != nil {
		t.Fatal(err)
	}
	states := []model.AutoDisableState{
		{ProviderID: "p-openai", Dimension: model.FailoverDimensionKey, Value: "sk-secret-openai-1234", Disabled: true},
	}
	if err := db.Create(&states).Error; err != nil {
		t.Fatal(err)
	}
	logs := []model.Log{
		{
			ID: "l1", RequestID: "req-1", CreatedAt: time.Now().Add(-2 * time.Minute),
			TokenName: "default", ProviderName: "OpenAI", ModelName: "gpt-4o",
			PromptTokens: 10, CompletionTokens: 5, Quota: 0.02, Currency: "USD",
			UseTime: 800, Status: "success", Source: "__opencode",
		},
		{
			ID: "l2", RequestID: "req-2", CreatedAt: time.Now().Add(-time.Minute),
			TokenName: "default", ProviderName: "OpenAI", ModelName: "gpt-4o",
			Status: "failed", ErrorMessage: "upstream 502",
		},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UsageCounter{
		ID: 1, TotalRequests: 2, SuccessCount: 1, FailedCount: 1,
		TotalTokens: 15, PromptTokens: 10, TotalCost: 0.02, TotalUseTimeMs: 800,
	}).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func connect(t *testing.T, db *gorm.DB) *mcp.ClientSession {
	t.Helper()
	srv := NewServer(db, "test")
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	if _, err := srv.Connect(context.Background(), serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0"}, nil)
	session, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callTool(t *testing.T, session *mcp.ClientSession, name string, args any) map[string]any {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}
	if result.IsError {
		t.Fatalf("tool %s returned error: %+v", name, result.Content)
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatalf("marshal %s result: %v", name, err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s result: %v (raw %s)", name, err, raw)
	}
	return out
}

func TestListToolsExposesReadOnlySurface(t *testing.T) {
	session := connect(t, newTestDB(t))
	res, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	got := make(map[string]bool, len(res.Tools))
	for _, tool := range res.Tools {
		got[tool.Name] = true
		if tool.InputSchema == nil {
			t.Errorf("tool %s has no input schema", tool.Name)
		}
	}
	for _, want := range []string{
		"list_providers", "get_provider", "list_models", "query_logs",
		"get_usage_stats", "get_topology", "list_disabled_channels", "list_agent_configs",
	} {
		if !got[want] {
			t.Errorf("missing tool %q", want)
		}
	}
	if len(got) != 8 {
		t.Errorf("expected 8 tools, got %d: %v", len(got), got)
	}
}

func TestListProvidersHidesKeys(t *testing.T) {
	session := connect(t, newTestDB(t))

	out := callTool(t, session, "list_providers", map[string]any{})
	if total := out["total"].(float64); total != 1 {
		t.Fatalf("expected only the enabled provider, got total=%v", total)
	}

	out = callTool(t, session, "list_providers", map[string]any{"include_disabled": true})
	if total := out["total"].(float64); total != 2 {
		t.Fatalf("expected both providers, got total=%v", total)
	}
	raw, _ := json.Marshal(out)
	for _, secret := range []string{"sk-secret-openai-1234", "sk-backup-key-9999"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("list_providers leaked an upstream key: %s", secret)
		}
	}

	out = callTool(t, session, "get_provider", map[string]any{"name": "OpenAI"})
	provider := out["provider"].(map[string]any)
	if provider["name"] != "OpenAI" {
		t.Fatalf("unexpected provider: %+v", provider)
	}
	hints, _ := provider["key_hints"].([]any)
	if len(hints) != 1 || hints[0] != "****1234" {
		t.Fatalf("expected masked key hint, got %v", hints)
	}
}

func TestListModelsAggregatesProviders(t *testing.T) {
	session := connect(t, newTestDB(t))

	out := callTool(t, session, "list_models", map[string]any{})
	if total := out["total"].(float64); total != 2 {
		t.Fatalf("expected 2 models, got %v", total)
	}
	models := out["models"].([]any)
	first := models[0].(map[string]any)
	if first["model"] != "gpt-4o" {
		t.Fatalf("models must be sorted, got first=%v", first["model"])
	}
	providers := first["providers"].([]any)
	if len(providers) != 1 || providers[0] != "OpenAI" {
		t.Fatalf("expected gpt-4o from OpenAI only (disabled provider excluded), got %v", providers)
	}
	endpoints := first["endpoints"].([]any)
	if len(endpoints) != 1 || endpoints[0] != "/v1/chat/completions" {
		t.Fatalf("unexpected endpoints: %v", endpoints)
	}
}

func TestQueryLogsFiltersAndPaginates(t *testing.T) {
	session := connect(t, newTestDB(t))

	out := callTool(t, session, "query_logs", map[string]any{"limit": 1})
	if total := out["total"].(float64); total != 2 {
		t.Fatalf("expected 2 rows, got %v", total)
	}
	logs := out["logs"].([]any)
	if len(logs) != 1 {
		t.Fatalf("limit not applied: %v", len(logs))
	}
	newest := logs[0].(map[string]any)
	if newest["request_id"] != "req-2" {
		t.Fatalf("expected newest row first, got %v", newest["request_id"])
	}

	out = callTool(t, session, "query_logs", map[string]any{"status": "failed"})
	if total := out["total"].(float64); total != 1 {
		t.Fatalf("status filter ignored: %v", total)
	}
	failed := out["logs"].([]any)[0].(map[string]any)
	if failed["error_message"] != "upstream 502" {
		t.Fatalf("error message missing: %+v", failed)
	}

	out = callTool(t, session, "query_logs", map[string]any{"token": "nobody"})
	if total := out["total"].(float64); total != 0 {
		t.Fatalf("token filter ignored: %v", total)
	}

	if _, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "query_logs",
		Arguments: map[string]any{"from": "not-a-time"},
	}); err != nil {
		t.Fatalf("bad time should be a tool error, not a protocol error: %v", err)
	}
}

func TestUsageStatsAndDisabledChannels(t *testing.T) {
	session := connect(t, newTestDB(t))

	out := callTool(t, session, "get_usage_stats", map[string]any{})
	if out["total_requests"].(float64) != 2 || out["windowed"].(bool) {
		t.Fatalf("unexpected cumulative stats: %+v", out)
	}

	out = callTool(t, session, "list_disabled_channels", map[string]any{})
	if total := out["total"].(float64); total != 1 {
		t.Fatalf("expected one disabled channel, got %v", total)
	}
	item := out["items"].([]any)[0].(map[string]any)
	if item["provider_name"] != "OpenAI" || item["dimension"] != "key" {
		t.Fatalf("unexpected disabled channel: %+v", item)
	}
	if item["value"] != "****1234" {
		t.Fatalf("disabled channel leaked the key: %v", item["value"])
	}
}

func TestTopologyAndAgentConfigs(t *testing.T) {
	db := newTestDB(t)
	if err := db.Create(&model.AgentConfigFile{
		RecordName: "laptop", AgentType: "opencode-v2", Mode: "local",
		TargetOS: "mac", Path: "/Users/x/.config/opencode/opencode.json",
	}).Error; err != nil {
		t.Fatal(err)
	}
	session := connect(t, db)

	topologyOut := callTool(t, session, "get_topology", map[string]any{})
	if nodes := topologyOut["nodes"].([]any); len(nodes) != 0 {
		t.Fatalf("expected empty topology, got %v", nodes)
	}

	agents := callTool(t, session, "list_agent_configs", map[string]any{})
	if total := agents["total"].(float64); total != 1 {
		t.Fatalf("expected one agent config, got %v", total)
	}
	entry := agents["configs"].([]any)[0].(map[string]any)
	if entry["agent_type"] != "opencode-v2" || entry["mode"] != "local" {
		t.Fatalf("unexpected agent config: %+v", entry)
	}
}
