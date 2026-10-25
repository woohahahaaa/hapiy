package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCreateProviderToolCreatesWithDefaults(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	out := callTool(t, session, "create_provider", map[string]any{
		"name":      "test",
		"base_urls": []string{"https://api.example.com/v1"},
		"keys":      []string{"sk-test-abcd1234"},
		"models":    []string{"m1"},
	})
	provider := out["provider"].(map[string]any)
	if provider["name"] != "test" {
		t.Fatalf("unexpected provider: %+v", provider)
	}
	if provider["status"] != true {
		t.Fatalf("new provider must be enabled by default: %+v", provider)
	}
	if provider["dedupe_v1_suffix"] != true {
		t.Fatalf("dedupe_v1_suffix must default to true: %+v", provider)
	}
	urls, _ := provider["base_urls"].([]any)
	if len(urls) != 1 || urls[0] != "https://api.example.com/v1" {
		t.Fatalf("base urls = %+v", urls)
	}
	hints, _ := provider["key_hints"].([]any)
	if len(hints) != 1 || hints[0] != "****1234" {
		t.Fatalf("key hints = %+v", hints)
	}
	models, _ := provider["models_detail"].([]any)
	if len(models) != 1 {
		t.Fatalf("models_detail = %+v", models)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-test-abcd1234") {
		t.Fatalf("create_provider leaked the upstream key: %s", raw)
	}

	var stored model.Provider
	if err := db.First(&stored, "name = ?", "test").Error; err != nil {
		t.Fatalf("provider not stored: %v", err)
	}
}

func TestCreateProviderToolRejectsDuplicateName(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "create_provider",
		Arguments: map[string]any{"name": "OpenAI"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatalf("duplicate name must fail, got %+v", result.StructuredContent)
	}
	if !strings.Contains(toolResultText(result), "已存在") {
		t.Fatalf("unexpected error: %s", toolResultText(result))
	}
}

func TestUpdateProviderToolPatchesOnlyGivenFields(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	out := callTool(t, session, "update_provider", map[string]any{
		"provider": "OpenAI",
		"weight":   7,
		"keys":     []string{"sk-new-key-0000"},
	})
	provider := out["provider"].(map[string]any)
	if provider["name"] != "OpenAI" {
		t.Fatalf("name changed unexpectedly: %+v", provider)
	}
	if provider["weight"] != float64(7) {
		t.Fatalf("weight = %v", provider["weight"])
	}
	urls, _ := provider["base_urls"].([]any)
	if len(urls) != 1 || urls[0] != "https://api.openai.com/v1" {
		t.Fatalf("untouched base urls changed: %+v", urls)
	}
	hints, _ := provider["key_hints"].([]any)
	if len(hints) != 1 || hints[0] != "****0000" {
		t.Fatalf("key hints = %+v", hints)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-new-key-0000") {
		t.Fatalf("update_provider leaked the upstream key: %s", raw)
	}

	var stored model.Provider
	if err := db.First(&stored, "id = ?", "p-openai").Error; err != nil {
		t.Fatal(err)
	}
	if stored.Weight != 7 || stored.Status != true {
		t.Fatalf("stored provider = %+v", stored)
	}
}

func TestSetProviderStatusToolIsIdempotent(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	for _, enabled := range []bool{false, false, true} {
		out := callTool(t, session, "set_provider_status", map[string]any{
			"provider": "OpenAI",
			"enabled":  enabled,
		})
		provider := out["provider"].(map[string]any)
		if provider["status"] != enabled {
			t.Fatalf("enabled=%v got status=%v", enabled, provider["status"])
		}
	}
}

func TestResetProviderDisableToolClearsStateAndRecord(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)
	if err := db.Create(&model.DisabledRecord{
		ProviderID: "p-openai",
		Dimension:  model.FailoverDimensionKey,
		Value:      "sk-secret-openai-1234",
	}).Error; err != nil {
		t.Fatal(err)
	}

	callTool(t, session, "reset_provider_disable", map[string]any{
		"provider":  "OpenAI",
		"dimension": "key",
	})

	var state model.AutoDisableState
	if err := db.First(&state, "provider_id = ? AND dimension = ?", "p-openai", model.FailoverDimensionKey).Error; err != nil {
		t.Fatal(err)
	}
	if state.Disabled {
		t.Fatal("disable state still active")
	}
	var records int64
	if err := db.Model(&model.DisabledRecord{}).Where("provider_id = ?", "p-openai").Count(&records).Error; err != nil {
		t.Fatal(err)
	}
	if records != 0 {
		t.Fatalf("pending records remain: %d", records)
	}
}

func TestDeleteProviderToolRemovesTheRow(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	out := callTool(t, session, "delete_provider", map[string]any{"provider": "Backup"})
	if out["ok"] != true {
		t.Fatalf("unexpected result: %+v", out)
	}
	var count int64
	if err := db.Model(&model.Provider{}).Where("name = ?", "Backup").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("provider still present: %d", count)
	}
}

func TestListDisabledRecordsMasksKeys(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	out := callTool(t, session, "list_disabled_records", map[string]any{})
	if total := out["total"].(float64); total != 1 {
		t.Fatalf("expected the backfilled key record, got total=%v", total)
	}
	record := out["records"].([]any)[0].(map[string]any)
	if record["provider_name"] != "OpenAI" {
		t.Fatalf("provider name missing: %+v", record)
	}
	if record["dimension"] != "key" || record["value"] != "****1234" {
		t.Fatalf("key value must be masked: %+v", record)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-secret-openai-1234") {
		t.Fatalf("list_disabled_records leaked the upstream key: %s", raw)
	}
}

func TestRestoreDisabledRecordToolClearsState(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)

	out := callTool(t, session, "list_disabled_records", map[string]any{})
	id := out["records"].([]any)[0].(map[string]any)["id"].(string)

	callTool(t, session, "restore_disabled_record", map[string]any{"id": id})

	var state model.AutoDisableState
	if err := db.First(&state, "provider_id = ? AND dimension = ?", "p-openai", model.FailoverDimensionKey).Error; err != nil {
		t.Fatal(err)
	}
	if state.Disabled {
		t.Fatal("disable state still active after restore")
	}
	var records int64
	if err := db.Model(&model.DisabledRecord{}).Count(&records).Error; err != nil {
		t.Fatal(err)
	}
	if records != 0 {
		t.Fatalf("record not removed: %d", records)
	}
}

func TestExtendDisabledRecordCountdownToolShiftsDeadline(t *testing.T) {
	db := newTestDB(t)
	session := connect(t, db)
	record := model.DisabledRecord{
		ProviderID: "p-openai",
		Dimension:  model.FailoverDimensionBaseURL,
		Value:      "https://api.openai.com/v1",
		DisabledAt: time.Now().Add(-time.Hour),
	}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}

	out := callTool(t, session, "extend_disabled_record_countdown", map[string]any{
		"id":      record.ID,
		"minutes": 90,
	})
	if out["extended"] != true {
		t.Fatalf("unexpected result: %+v", out)
	}
	var stored model.DisabledRecord
	if err := db.First(&stored, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	shift := stored.DisabledAt.Sub(record.DisabledAt)
	if shift < 89*time.Minute || shift > 91*time.Minute {
		t.Fatalf("countdown shifted by %v, want ~90m", shift)
	}
}
