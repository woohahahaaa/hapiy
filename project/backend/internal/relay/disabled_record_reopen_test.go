package relay

import (
	"testing"
	"time"

	"github.com/hapiy/hapiy/internal/model"
)

// TestSaveDisabledRecord_reopensResolvedRow locks the re-disable path: the
// unique (provider, dimension, value) index makes FirstOrCreate reuse the old
// row, and Assign skips zero-valued fields, so an earlier resolved_at would
// otherwise survive — leaving the entity disabled but absent from the pending
// table and from the recovery scheduler.
func TestSaveDisabledRecord_reopensResolvedRow(t *testing.T) {
	engine, db := newTestEngine(t)
	if err := db.AutoMigrate(&model.DisabledRecord{}); err != nil {
		t.Fatalf("migrate disabled records: %v", err)
	}
	resolvedAt := time.Now().Add(-time.Hour)
	existing := model.DisabledRecord{
		ProviderID: "provider-a",
		Dimension:  model.FailoverDimensionProvider,
		Value:      "provider-a",
		DisabledAt: resolvedAt,
		ResolvedAt: &resolvedAt,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create resolved record: %v", err)
	}

	req := &RelayRequest{
		Model:   "gpt-image-2.6",
		Body:    map[string]interface{}{"model": "gpt-image-2.6"},
		Headers: map[string]string{"content-type": "application/json"},
	}
	engine.saveDisabledRecord("provider-a", model.FailoverDimensionProvider, "provider-a",
		"https://up.example", "sk-test", "https://up.example/v1/images/generations", req, "boom", nil)

	var got model.DisabledRecord
	if err := db.First(&got, "id = ?", existing.ID).Error; err != nil {
		t.Fatalf("reload record: %v", err)
	}
	if got.ResolvedAt != nil {
		t.Fatalf("re-disable must clear resolved_at, got %v", got.ResolvedAt)
	}
	if !got.DisabledAt.After(resolvedAt) {
		t.Fatalf("re-disable must refresh disabled_at, got %v", got.DisabledAt)
	}
	if got.Model != "gpt-image-2.6" || got.BaseURL != "https://up.example" {
		t.Fatalf("re-disable must refresh the recorded combo: %+v", got)
	}
}
