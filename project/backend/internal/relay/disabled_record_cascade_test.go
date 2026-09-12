package relay

import (
	"testing"

	"github.com/hapiy/hapiy/internal/model"
)

// TestResolveCascade_keepsSiblingKeyRecords verifies that recovering ONE
// disabled key only clears that key's own disable state and record —
// sibling keys of the same provider (e.g. still quota-exhausted ones)
// must stay disabled with their pending records intact.
func TestResolveCascade_keepsSiblingKeyRecords(t *testing.T) {
	engine, db := newTestEngine(t)
	if err := db.AutoMigrate(&model.DisabledRecord{}); err != nil {
		t.Fatalf("migrate disabled records: %v", err)
	}
	provider := model.Provider{ID: "provider-a", Name: "A", BaseURLs: "[]", Keys: "[]", Models: "[]", Status: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	rec := &model.DisabledRecord{
		ID:         "rec-recovered",
		ProviderID: provider.ID,
		Dimension:  model.FailoverDimensionKey,
		Value:      "sk-recovered",
		BaseURL:    "https://up.example",
	}
	recOK := &model.DisabledRecord{
		ID:         "rec-sibling",
		ProviderID: provider.ID,
		Dimension:  model.FailoverDimensionKey,
		Value:      "sk-sibling",
		BaseURL:    "https://up.example",
	}
	recShared := &model.DisabledRecord{
		ID:         "rec-shared-url",
		ProviderID: "provider-b",
		Dimension:  model.FailoverDimensionKey,
		Value:      "sk-other",
		BaseURL:    "https://up.example",
	}
	for _, r := range []*model.DisabledRecord{rec, recOK, recShared} {
		if err := db.Create(r).Error; err != nil {
			t.Fatalf("create record: %v", err)
		}
	}
	states := []model.AutoDisableState{
		{ProviderID: provider.ID, Dimension: model.FailoverDimensionKey, Value: "sk-recovered", Disabled: true},
		{ProviderID: provider.ID, Dimension: model.FailoverDimensionKey, Value: "sk-sibling", Disabled: true},
		{ProviderID: provider.ID, Dimension: model.FailoverDimensionBaseURL, Value: "https://up.example", Disabled: true},
		{ProviderID: "provider-b", Dimension: model.FailoverDimensionProvider, Value: "provider-b", Disabled: true},
	}
	for _, s := range states {
		if err := db.Create(&s).Error; err != nil {
			t.Fatalf("create state: %v", err)
		}
	}

	engine.resolveCascade(&provider, rec)

	// The recovered key is gone; the other provider's KEY record sharing
	// the proven baseURL survives — its own key was never tested.
	var count int64
	db.Model(&model.DisabledRecord{}).Where("id = ?", rec.ID).Count(&count)
	if count != 0 {
		t.Fatalf("recovered record must be dropped")
	}
	db.Model(&model.DisabledRecord{}).Where("id = ?", "rec-sibling").Count(&count)
	if count != 1 {
		t.Fatalf("sibling key record must survive the cascade")
	}
	db.Model(&model.DisabledRecord{}).Where("id = ?", "rec-shared-url").Count(&count)
	if count != 1 {
		t.Fatalf("other provider's key record must survive the cascade")
	}

	// Disable states: only the recovered key + the proven baseURL clear.
	var sibling model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ? AND value = ?", provider.ID, model.FailoverDimensionKey, "sk-sibling").First(&sibling).Error; err != nil {
		t.Fatalf("load sibling state: %v", err)
	}
	if !sibling.Disabled {
		t.Fatalf("sibling key disable must stay disabled")
	}
	var shared model.AutoDisableState
	if err := db.Where("dimension = ? AND value = ?", model.FailoverDimensionBaseURL, "https://up.example").First(&shared).Error; err != nil {
		t.Fatalf("load shared baseURL state: %v", err)
	}
	if shared.Disabled {
		t.Fatalf("shared baseURL disable must be cleared by a successful replay")
	}
	var recovered model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ? AND value = ?", provider.ID, model.FailoverDimensionKey, "sk-recovered").First(&recovered).Error; err != nil {
		t.Fatalf("load recovered state: %v", err)
	}
	if recovered.Disabled {
		t.Fatalf("recovered key disable must be cleared")
	}
	var otherProvider model.AutoDisableState
	if err := db.Where("provider_id = ? AND dimension = ?", "provider-b", model.FailoverDimensionProvider).First(&otherProvider).Error; err != nil {
		t.Fatalf("load other provider state: %v", err)
	}
	// Untouched means still disabled — a successful replay of provider-a's
	// key proves nothing about provider-b.
	if !otherProvider.Disabled {
		t.Fatalf("other provider's disable must not be touched")
	}
}
