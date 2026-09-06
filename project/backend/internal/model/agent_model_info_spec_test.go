package model

import (
	"encoding/json"
	"testing"
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

// TestUpgradeLegacyThinkingLevels pins the in-place seed upgrade: only
// the old plain "reasoning" default is rewritten; customized blobs are
// left alone.
func TestUpgradeLegacyThinkingLevels(t *testing.T) {
	oldBlob := `{"max_context":"limit.context","max_output_token":"limit.output","input_types":"modalities.input","thinking_levels":"reasoning"}`
	upgraded, changed := upgradeLegacyThinkingLevels(oldBlob)
	if !changed {
		t.Fatal("legacy blob should be upgraded")
	}
	var p AgentModelInfoFieldPaths
	if err := json.Unmarshal([]byte(upgraded), &p); err != nil {
		t.Fatal(err)
	}
	if p.ThinkingLevels.Path != "reasoning" || p.ThinkingLevels.Op != "bool" {
		t.Fatalf("thinking_levels not upgraded: %s", upgraded)
	}
	if p.MaxContext.Path != "limit.context" {
		t.Fatalf("other paths must survive: %s", upgraded)
	}
	if _, changed := upgradeLegacyThinkingLevels(upgraded); changed {
		t.Fatal("already-upgraded blob must not re-upgrade")
	}
	if _, changed := upgradeLegacyThinkingLevels(`{"thinking_levels":"my.reasoning"}`); changed {
		t.Fatal("customized path must not be touched")
	}
}

// TestUpgradeMissingModelInfoValues pins the allowed-values back-fill:
// an existing row that has the same path but no whitelist gets the
// builtin Values added, while other snippets are preserved.
func TestUpgradeMissingModelInfoValues(t *testing.T) {
	want := AgentModelInfoFieldPaths{
		InputTypes: AgentModelInfoFieldSpec{Path: "input", Values: []string{"text", "image", "video", "audio"}},
	}
	stored := `{"max_context":"ctx","input_types":{"path":"input","op":"join","sep":"+"}}`
	upgraded, changed := upgradeMissingModelInfoValues(stored, want)
	if !changed {
		t.Fatalf("should be upgraded: %s", stored)
	}
	var p AgentModelInfoFieldPaths
	if err := json.Unmarshal([]byte(upgraded), &p); err != nil {
		t.Fatal(err)
	}
	if p.InputTypes.Path != "input" || p.InputTypes.Op != "join" || p.InputTypes.Sep != "+" {
		t.Fatalf("custom op/sep must survive: %s", upgraded)
	}
	if len(p.InputTypes.Values) != 4 || p.InputTypes.Values[3] != "audio" {
		t.Fatalf("values not back-filled: %s", upgraded)
	}
	if p.MaxContext.Path != "ctx" {
		t.Fatalf("unrelated path must survive: %s", upgraded)
	}
	// Already-filled rows are untouched.
	if _, changed := upgradeMissingModelInfoValues(upgraded, want); changed {
		t.Fatalf("already-filled row must not change again: %s", upgraded)
	}
	// Different path must not be touched.
	if _, changed := upgradeMissingModelInfoValues(`{"input_types":"modalities.input"}`, want); changed {
		t.Fatal("different path must not be rewritten")
	}
}
