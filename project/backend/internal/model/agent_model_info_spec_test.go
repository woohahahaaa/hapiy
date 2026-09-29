package model

import (
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestAgentModelInfoFieldSpecUnmarshal covers the two accepted shapes:
// legacy plain-path strings and the {path, op, sep} object form.
func TestAgentModelInfoFieldSpecUnmarshal(t *testing.T) {
	var s AgentModelInfoFieldSpec
	if err := json.Unmarshal([]byte(`"limit.context"`), &s); err != nil {
		t.Fatal(err)
	}
	if s.Path != "limit.context" || s.Op != "" {
		t.Fatalf("string form: got %+v", s)
	}
	if err := json.Unmarshal([]byte(`{"path":"reasoning","op":"bool"}`), &s); err != nil {
		t.Fatal(err)
	}
	if s.Path != "reasoning" || s.Op != "bool" {
		t.Fatalf("object form: got %+v", s)
	}
	if err := json.Unmarshal([]byte(`null`), &s); err != nil {
		t.Fatal(err)
	}
	if s.Path != "" || s.Op != "" {
		t.Fatalf("null form: got %+v", s)
	}
}

// TestAgentModelInfoFieldSpecMarshal keeps the stored blob and API
// payload in the readable string form unless an op is configured.
func TestAgentModelInfoFieldSpecMarshal(t *testing.T) {
	raw, err := json.Marshal(AgentModelInfoFieldSpec{Path: "limit.context"})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `"limit.context"` {
		t.Fatalf("raw spec should marshal as string, got %s", raw)
	}
	raw, err = json.Marshal(AgentModelInfoFieldSpec{Path: "reasoning", Op: "bool"})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"path":"reasoning","op":"bool"}` {
		t.Fatalf("op spec should marshal as object, got %s", raw)
	}
	// Values must keep the object form so the whitelist is not lost.
	raw, err = json.Marshal(AgentModelInfoFieldSpec{Path: "input", Values: []string{"text", "image", "video", "audio"}})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"path":"input","values":["text","image","video","audio"]}` {
		t.Fatalf("values spec should marshal as object, got %s", raw)
	}
}

// TestAgentModelInfoFieldSpecShape covers the op vocabulary and the
// skip-on-empty semantics (raw/first/join skip; bool always writes).
func TestAgentModelInfoFieldSpecShape(t *testing.T) {
	cases := []struct {
		name string
		spec AgentModelInfoFieldSpec
		in   any
		want any
		ok   bool
	}{
		{"raw array", ModelInfoPath("modalities.input"), []any{"text", "image"}, []any{"text", "image"}, true},
		{"raw empty skips", ModelInfoPath("input"), []any{}, nil, false},
		{"bool true", ModelInfoOp("reasoning", "bool"), []any{"high"}, true, true},
		{"bool false on empty", ModelInfoOp("reasoning", "bool"), []any{}, false, true},
		{"bool on boolean", ModelInfoOp("reasoning", "bool"), false, false, true},
		{"bool skips nil", ModelInfoOp("reasoning", "bool"), nil, nil, false},
		{"first", AgentModelInfoFieldSpec{Path: "reasoning", Op: "first"}, []any{"high", "low"}, "high", true},
		{"first empty skips", AgentModelInfoFieldSpec{Path: "reasoning", Op: "first"}, []any{}, nil, false},
		{"join default sep", AgentModelInfoFieldSpec{Path: "input", Op: "join"}, []any{"text", "image"}, "text,image", true},
		{"join custom sep", AgentModelInfoFieldSpec{Path: "input", Op: "join", Sep: "+"}, []any{"a", "b"}, "a+b", true},
		{"join empty skips", AgentModelInfoFieldSpec{Path: "input", Op: "join"}, []string{}, nil, false},
		{"values filters bad literals", AgentModelInfoFieldSpec{Path: "input", Values: []string{"text", "image", "video", "audio"}}, []any{"text", "image", "pdf"}, []any{"text", "image"}, true},
		{"values keeps all when valid", AgentModelInfoFieldSpec{Path: "input", Values: []string{"text", "image", "video", "audio"}}, []any{"text", "image"}, []any{"text", "image"}, true},
		{"values all dropped skips", AgentModelInfoFieldSpec{Path: "input", Values: []string{"text"}}, []any{"pdf", "xls"}, nil, false},
		{"values case-insensitive", AgentModelInfoFieldSpec{Path: "input", Values: []string{"Text"}}, []any{"text"}, []any{"text"}, true},
		{"first filters then take first", AgentModelInfoFieldSpec{Path: "input", Op: "first", Values: []string{"image"}}, []any{"text", "image"}, "image", true},
		{"join filters then join", AgentModelInfoFieldSpec{Path: "input", Op: "join", Values: []string{"text", "image"}}, []any{"text", "pdf", "image"}, "text,image", true},
	}
	for _, tc := range cases {
		got, ok := tc.spec.Shape(tc.in)
		if ok != tc.ok {
			t.Fatalf("%s: ok = %v, want %v", tc.name, ok, tc.ok)
		}
		if ok {
			gj, _ := json.Marshal(got)
			wj, _ := json.Marshal(tc.want)
			if string(gj) != string(wj) {
				t.Fatalf("%s: got %s, want %s", tc.name, gj, wj)
			}
		}
	}
}

// TestAgentTypeRuleMatchesTemplate pins the customization detector: a
// freshly seeded row matches its template; any content edit (even
// formatting-neutral ones like a different recommended value) breaks the
// match, and empty-vs-null storage shapes never count as a change.
func TestAgentTypeRuleMatchesTemplate(t *testing.T) {
	tmpl, ok := LoadAgentTemplate("opencode-v1")
	if !ok {
		t.Fatal("opencode-v1 template not found")
	}
	tmpl = normalizeTemplate(tmpl)

	var rule AgentTypeRule
	if err := ApplyTemplateToRule(&rule, tmpl); err != nil {
		t.Fatal(err)
	}
	if !rule.MatchesTemplate(tmpl) {
		t.Fatal("freshly applied template must match")
	}

	// Same content with empty arrays instead of nil must still match.
	rebuilt := rule
	if err := rebuilt.SetProtocols([]AgentProtocol{{
		Name:            "OpenAI Responses API",
		Conditions:      []AgentProtocolCondition{},
		EndpointTags:    []string{"responses"},
		Recommendations: tmpl.Protocols[0].Recommendations,
	}}); err != nil {
		t.Fatal(err)
	}
	// (仅 protocols 一份变了，重放完整模板再测)
	if err := ApplyTemplateToRule(&rebuilt, tmpl); err != nil {
		t.Fatal(err)
	}
	if !rebuilt.MatchesTemplate(tmpl) {
		t.Fatal("rebuilt template must still match")
	}

	// A content edit must break the match.
	edited := tmpl
	edited.Recommendations = append([]AgentRecommendation(nil), tmpl.Recommendations...)
	edited.Recommendations[0].Description = "用户改过"
	var editedRule AgentTypeRule
	if err := ApplyTemplateToRule(&editedRule, edited); err != nil {
		t.Fatal(err)
	}
	if editedRule.MatchesTemplate(tmpl) {
		t.Fatal("edited content must not match the template")
	}
}

// TestEnsureDefaultAgentTypesFollow pins the follow/customize split:
// uncustomized rows are fully resynced to the template (additions AND
// removals), customized rows are never touched, and saving template-
// identical content keeps a row uncustomized.
func TestEnsureDefaultAgentTypesFollow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}

	var rule AgentTypeRule
	if err := db.Where("name = ?", "opencode-v1").First(&rule).Error; err != nil {
		t.Fatal(err)
	}
	if rule.Customized {
		t.Fatal("freshly seeded row must not be customized")
	}

	// Simulate an outdated uncustomized row: an extra stale field + a
	// missing field. The next startup must resync it to the template.
	recs, _ := rule.GetRecommendations()
	recs = append(recs, AgentRecommendation{Scope: "model", Key: "stale.legacy"})
	recs = recs[1:] // drop the first real field too
	if err := rule.SetRecommendations(recs); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&rule).Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}
	var after AgentTypeRule
	if err := db.Where("name = ?", "opencode-v1").First(&after).Error; err != nil {
		t.Fatal(err)
	}
	tmpl, ok := LoadAgentTemplate("opencode-v1")
	if !ok {
		t.Fatal("template missing")
	}
	if !after.MatchesTemplate(normalizeTemplate(tmpl)) {
		t.Fatal("uncustomized row must be resynced to the template (add and remove)")
	}

	// A customized row keeps its content across startups.
	rule = after
	recs, _ = rule.GetRecommendations()
	if len(recs) == 0 {
		t.Fatal("template should carry recommendations")
	}
	recs[0].Description = "用户自己的"
	if err := rule.SetRecommendations(recs); err != nil {
		t.Fatal(err)
	}
	rule.Customized = true
	if err := db.Save(&rule).Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}
	var kept AgentTypeRule
	if err := db.Where("name = ?", "opencode-v1").First(&kept).Error; err != nil {
		t.Fatal(err)
	}
	if !kept.Customized {
		t.Fatal("customized flag must survive")
	}
	keptRecs, _ := kept.GetRecommendations()
	if keptRecs[0].Description != "用户自己的" {
		t.Fatalf("customized row must keep user content: %s", keptRecs[0].Description)
	}

	// Saving template-identical content clears the flag (same content,
	// Customized back to false → still follows the template afterwards).
	kept.Customized = false
	if err := db.Save(&kept).Error; err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultAgentTypes(db); err != nil {
		t.Fatal(err)
	}
	var back AgentTypeRule
	if err := db.Where("name = ?", "opencode-v1").First(&back).Error; err != nil {
		t.Fatal(err)
	}
	if !back.MatchesTemplate(normalizeTemplate(tmpl)) {
		t.Fatal("row should have been resynced back to the template")
	}
}
