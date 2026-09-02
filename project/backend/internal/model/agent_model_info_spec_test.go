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
