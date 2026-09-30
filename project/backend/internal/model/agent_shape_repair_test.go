package model

import (
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestRepairLostShapeFieldsBackfillsV2VariantShape is the regression guard for
// the OpenCode V2 breakage: an editor save used to drop the native-V2
// `variant_shape:"array"` from a customized rule, so the managed sync wrote
// the legacy object-map variants ({level:{options:{...}}}) under the native
// `providers` key. OpenCode V2 validates native providers strictly and skips
// the whole provider as malformed, leaving no usable model. The startup repair
// must backfill the shape for V2 rules without touching the V1 object shape.
func TestRepairLostShapeFieldsBackfillsV2VariantShape(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := AutoMigrate(db); err != nil {
		t.Fatal(err)
	}

	// opencode-v2 row: reasoning_effort lost variant_shape, models_container
	// came back empty — exactly what the old rule editor produced.
	v2 := AgentTypeRule{Name: "opencode-v2", Customized: true}
	if err := v2.SetJsonPaths(AgentJsonPaths{Provider: "providers", Model: "providers.{provider_id}.models"}); err != nil {
		t.Fatal(err)
	}
	if err := v2.SetModelInfoFields(AgentModelInfoFieldPaths{
		MaxContext:      ModelInfoPath("limit.context"),
		MaxOutputToken:  ModelInfoPath("limit.output"),
		InputTypes:      ModelInfoPath("capabilities.input"),
		ReasoningEffort: AgentModelInfoFieldSpec{Path: "variants", Op: "variants", Values: []string{"low", "high", "max"}},
	}); err != nil {
		t.Fatal(err)
	}

	// opencode-v1 row: its object shape is correct and must not become array.
	v1 := AgentTypeRule{Name: "opencode-v1", Customized: true}
	if err := v1.SetJsonPaths(AgentJsonPaths{Provider: "provider", Model: "provider.{provider_id}.models", ModelsContainer: "object"}); err != nil {
		t.Fatal(err)
	}
	if err := v1.SetModelInfoFields(AgentModelInfoFieldPaths{
		ReasoningEffort: AgentModelInfoFieldSpec{Path: "variants", Op: "variants", Values: []string{"low", "high"}},
	}); err != nil {
		t.Fatal(err)
	}

	if err := db.Create(&v2).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&v1).Error; err != nil {
		t.Fatal(err)
	}

	if err := EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}

	var afterV2 AgentTypeRule
	if err := db.Where("name = ?", "opencode-v2").First(&afterV2).Error; err != nil {
		t.Fatal(err)
	}
	mif, err := afterV2.GetModelInfoFields()
	if err != nil {
		t.Fatal(err)
	}
	if mif.ReasoningEffort.VariantShape != "array" {
		t.Fatalf("opencode-v2 variant_shape = %q, want array", mif.ReasoningEffort.VariantShape)
	}
	jp, err := afterV2.GetJsonPaths()
	if err != nil {
		t.Fatal(err)
	}
	if jp.ModelsContainer != "object" {
		t.Fatalf("opencode-v2 models_container = %q, want object", jp.ModelsContainer)
	}
	// The written value must be the native array form with an id per entry.
	got, ok := mif.ReasoningEffort.Shape([]any{"low", "high", "not-a-level"})
	if !ok {
		t.Fatal("variants shape must be written")
	}
	raw, _ := json.Marshal(got)
	want := `[{"id":"low","settings":{"reasoningEffort":"low"}},{"id":"high","settings":{"reasoningEffort":"high"}}]`
	if string(raw) != want {
		t.Fatalf("variants shape = %s, want %s", raw, want)
	}

	var afterV1 AgentTypeRule
	if err := db.Where("name = ?", "opencode-v1").First(&afterV1).Error; err != nil {
		t.Fatal(err)
	}
	v1mif, err := afterV1.GetModelInfoFields()
	if err != nil {
		t.Fatal(err)
	}
	if v1mif.ReasoningEffort.VariantShape != "" {
		t.Fatalf("opencode-v1 variant_shape must stay legacy object, got %q", v1mif.ReasoningEffort.VariantShape)
	}
}

// TestRepairLostShapeFieldsKeepsUserEdits makes sure the repair only fills a
// shape the template declares when the stored spec still points at that exact
// field; a user's own path/op is never rewritten.
func TestRepairLostShapeFieldsKeepsUserEdits(t *testing.T) {
	tmpl, ok := LoadAgentTemplate("opencode-v2")
	if !ok {
		t.Fatal("opencode-v2 template not found")
	}
	rule := AgentTypeRule{Name: "opencode-v2", Customized: true}
	if err := rule.SetJsonPaths(AgentJsonPaths{Provider: "providers", Model: "providers.{provider_id}.models", ModelsContainer: "object"}); err != nil {
		t.Fatal(err)
	}
	if err := rule.SetModelInfoFields(AgentModelInfoFieldPaths{
		// Same field name, but the user retargeted it to another path.
		ReasoningEffort: AgentModelInfoFieldSpec{Path: "my.custom.effort", Op: "variants", Values: []string{"high"}},
	}); err != nil {
		t.Fatal(err)
	}
	if repairLostShapeFields(&rule, tmpl) {
		t.Fatal("a retargeted spec must not be repaired")
	}
	mif, _ := rule.GetModelInfoFields()
	if mif.ReasoningEffort.VariantShape != "" {
		t.Fatalf("user spec must stay untouched, got %q", mif.ReasoningEffort.VariantShape)
	}
}
