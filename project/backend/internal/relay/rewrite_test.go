package relay

import (
	"strings"
	"testing"
)

func TestCompileRewriteChain_rejects_non_array_script(t *testing.T) {
	_, err := compileRewriteChain("rule-1", `{"mode":"set"}`)
	if err == nil || !strings.Contains(err.Error(), "script is not a JSON array") {
		t.Fatalf("expected array-shape error, got %v", err)
	}
}

func TestCompileRewriteChain_handles_empty_script(t *testing.T) {
	chain, err := compileRewriteChain("rule-1", "  ")
	if err != nil {
		t.Fatalf("empty script should compile to no-op: %v", err)
	}
	if len(chain) != 0 {
		t.Fatalf("empty script produced %d ops", len(chain))
	}
}

func TestCompileRewriteChain_rejects_unknown_mode(t *testing.T) {
	_, err := compileRewriteChain("rule-1", `[{"path":"a","mode":"blowup"}]`)
	if err == nil || !strings.Contains(err.Error(), "unsupported mode") {
		t.Fatalf("expected unsupported mode error, got %v", err)
	}
}

func TestCompileRewriteChain_rejects_compile_failures_with_rule_id(t *testing.T) {
	_, err := compileRewriteChain("rule-42", `[{"path":"a","mode":"replace"}]`)
	if err == nil || !strings.Contains(err.Error(), "rule rule-42") || !strings.Contains(err.Error(), "from is required") {
		t.Fatalf("expected error naming rule and reason, got %v", err)
	}
}

func TestCompileRewriteChain_compiles_regex(t *testing.T) {
	ops, err := compileRewriteChain("r", `[{"path":"text","mode":"regex_replace","from":"a+","to":"b"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if len(ops) != 1 || ops[0].Regex == nil {
		t.Fatalf("regex was not compiled: %+v", ops)
	}
}

func TestApplyRewriteChain_set_append_delete(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"messages.0.content","mode":"set","value":"hi"},
		{"path":"messages.0.role","mode":"append","value":"!"},
		{"path":"messages.1","mode":"delete"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"role":"user","content":"hello"},{"role":"user","content":"x"}]}`)
	updated, err := applyRewriteChains(body, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	got := string(updated)
	if !strings.Contains(got, `"content":"hi"`) {
		t.Fatalf("set op missing in output: %s", got)
	}
	if !strings.Contains(got, `"role":"user!"`) {
		t.Fatalf("append op missing in output: %s", got)
	}
	if strings.Contains(got, `"content":"x"`) {
		t.Fatalf("delete op did not remove second message: %s", got)
	}
}

func TestApplyRewriteChain_string_transforms(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"u","mode":"to_upper"},
		{"path":"v","mode":"to_lower"},
		{"path":"w","mode":"trim_space"},
		{"path":"x","mode":"trim_prefix","value":"pre-"},
		{"path":"y","mode":"trim_suffix","value":"-suf"},
		{"path":"z","mode":"ensure_prefix","value":"pre-"},
		{"path":"a","mode":"ensure_suffix","value":"-suf"},
		{"path":"b","mode":"replace","from":"old","to":"new"},
		{"path":"c","mode":"regex_replace","from":"\\s+","to":"_"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"u":"abc","v":"ABC","w":"  hi  ","x":"pre-foo","y":"foo-suf","z":"foo","a":"foo","b":"old text","c":"a b c"}`)
	updated, err := applyRewriteChains(body, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	got := string(updated)
	for _, want := range []string{
		`"u":"ABC"`,
		`"v":"abc"`,
		`"w":"hi"`,
		`"x":"foo"`,
		`"y":"foo"`,
		`"z":"pre-foo"`,
		`"a":"foo-suf"`,
		`"b":"new text"`,
		`"c":"a_b_c"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %s in output: %s", want, got)
		}
	}
}

func TestApplyRewriteChain_conditions_gate_op(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"foo","mode":"set","value":"new","conditions":[
			{"path":"foo","op":"eq","value":"old"}
		]}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body1 := []byte(`{"foo":"old"}`)
	out1, err := applyRewriteChains(body1, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.Contains(string(out1), `"foo":"new"`) {
		t.Fatalf("condition matched; op should fire: %s", out1)
	}
	body2 := []byte(`{"foo":"other"}`)
	out2, err := applyRewriteChains(body2, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if strings.Contains(string(out2), `"foo":"new"`) {
		t.Fatalf("condition not matched; op should not fire: %s", out2)
	}
}

func TestApplyRewriteChain_combined_logic(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"x","mode":"set","value":"yes","conditions":[
			{"logic":"OR","children":[
				{"path":"a","op":"eq","value":"apple"},
				{"path":"a","op":"eq","value":"banana","invert":true}
			]}
		]}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	mustApply := []byte(`{"a":"apple"}`)
	out, err := applyRewriteChains(mustApply, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.Contains(string(out), `"x":"yes"`) {
		t.Fatalf("OR logic should have matched: %s", out)
	}
	mustSkip := []byte(`{"a":"banana"}`)
	out2, err := applyRewriteChains(mustSkip, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if strings.Contains(string(out2), `"x":"yes"`) {
		t.Fatalf("OR logic should NOT have matched: %s", out2)
	}
}

func TestApplyRewriteChain_move_and_copy(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"src","mode":"copy","dst":"dup"},
		{"path":"src","mode":"move","dst":"moved"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"src":"hello"}`)
	updated, err := applyRewriteChains(body, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	got := string(updated)
	if !strings.Contains(got, `"dup":"hello"`) {
		t.Fatalf("copy missed: %s", got)
	}
	if !strings.Contains(got, `"moved":"hello"`) {
		t.Fatalf("move dest missing: %s", got)
	}
	if strings.Contains(got, `"src":"hello"`) {
		t.Fatalf("move should have removed src: %s", got)
	}
}

func TestApplyRewriteChain_missing_path_no_op_for_string_ops(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"missing.path","mode":"trim_space"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"x":1}`)
	updated, err := applyRewriteChains(body, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != string(body) {
		t.Fatalf("expected unchanged body, got %s", updated)
	}
}
