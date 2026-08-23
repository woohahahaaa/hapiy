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

func TestFailoverRuleValidate_rejectsMultipleLegacyActions(t *testing.T) {
	rule := FailoverRule{Actions: []FailoverAction{
		{Dimension: FailoverDimensionBaseURL, RetryCount: 3},
		{Dimension: FailoverDimensionProvider, RetryCount: 3},
	}}
	if err := rule.Validate(); err == nil {
		t.Fatal("expected multiple-action validation failure")
	}
}

func TestFailoverRuleValidate_acceptsSingleDimension(t *testing.T) {
	rule := FailoverRule{Dimension: FailoverDimensionKey, RetryCount: 3, TTFBSeconds: 5}
	if err := rule.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestFailoverRuleValidate_rejectsInvalidDimension(t *testing.T) {
	rule := FailoverRule{Dimension: "garbage", RetryCount: 3}
	if err := rule.Validate(); err == nil {
		t.Fatal("expected invalid dimension validation failure")
	}
}

func TestFailoverRuleSingleAction_prefersNewFields(t *testing.T) {
	rule := FailoverRule{
		Dimension:   FailoverDimensionKey,
		RetryCount:  5,
		AutoDisable: true,
		Actions: []FailoverAction{
			{Dimension: FailoverDimensionBaseURL, RetryCount: 1, AutoDisable: false},
		},
	}
	dim, retry, autoDisable := rule.SingleAction()
	if dim != FailoverDimensionKey || retry != 5 || !autoDisable {
		t.Fatalf("SingleAction should prefer new fields, got dim=%q retry=%d auto=%v", dim, retry, autoDisable)
	}
}

func TestFailoverRuleSingleAction_fallsBackToLegacy(t *testing.T) {
	rule := FailoverRule{
		Actions: []FailoverAction{
			{Dimension: FailoverDimensionProvider, RetryCount: 4, AutoDisable: false},
		},
	}
	dim, retry, autoDisable := rule.SingleAction()
	if dim != FailoverDimensionProvider || retry != 4 || autoDisable {
		t.Fatalf("SingleAction should fall back to legacy, got dim=%q retry=%d auto=%v", dim, retry, autoDisable)
	}
}
