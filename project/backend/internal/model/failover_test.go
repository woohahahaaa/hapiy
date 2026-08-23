package model

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFailoverRuleNormalize_setsCompatibilityDefaults_whenLegacyFieldsAbsent(t *testing.T) {
	// Given
	rule := FailoverRule{FallbackProvider: "backup"}

	// When
	rule.Normalize()

	// Then
	if len(rule.Actions) != 3 || rule.Actions[0].Dimension != FailoverDimensionBaseURL || rule.Actions[1].Dimension != FailoverDimensionKey || rule.Actions[2].Dimension != FailoverDimensionProvider {
		t.Fatalf("unexpected action sequence: %#v", rule.Actions)
	}
	for _, action := range rule.Actions {
		if action.RetryCount != 3 || !action.AutomaticPolling || !action.AutoDisable {
			t.Fatalf("unexpected default action: %#v", action)
		}
	}
}

func TestFailoverRuleActions_roundTripPreservesClientOrderAndPerRowSettings(t *testing.T) {
	// Given
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&FailoverRule{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	rule := FailoverRule{Name: "ordered", Actions: []FailoverAction{
		{Dimension: FailoverDimensionProvider, RetryCount: 1, AutomaticPolling: false, AutoDisable: false},
		{Dimension: FailoverDimensionKey, RetryCount: 2, AutomaticPolling: true, AutoDisable: false},
		{Dimension: FailoverDimensionBaseURL, RetryCount: 4, AutomaticPolling: false, AutoDisable: true},
	}}

	// When
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	var reloaded FailoverRule
	if err := db.First(&reloaded, "id = ?", rule.ID).Error; err != nil {
		t.Fatalf("reload rule: %v", err)
	}

	// Then
	if reloaded.Actions[0].Dimension != FailoverDimensionProvider || reloaded.Actions[1].RetryCount != 2 || !reloaded.Actions[2].AutoDisable {
		t.Fatalf("actions did not round-trip: %#v", reloaded.Actions)
	}
}

func TestFailoverRuleValidateActions_rejectsDuplicateDimension(t *testing.T) {
	// Given
	rule := FailoverRule{Actions: []FailoverAction{
		{Dimension: FailoverDimensionBaseURL, RetryCount: 3},
		{Dimension: FailoverDimensionBaseURL, RetryCount: 3},
		{Dimension: FailoverDimensionProvider, RetryCount: 3},
	}}

	// When
	err := rule.ValidateActions()

	// Then
	if err == nil {
		t.Fatal("expected duplicate dimension validation failure")
	}
}
