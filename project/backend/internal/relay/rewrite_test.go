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
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
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
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
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
	out1, _, err := applyRewriteChains(body1, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.Contains(string(out1), `"foo":"new"`) {
		t.Fatalf("condition matched; op should fire: %s", out1)
	}
	body2 := []byte(`{"foo":"other"}`)
	out2, _, err := applyRewriteChains(body2, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
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
	out, _, err := applyRewriteChains(mustApply, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.Contains(string(out), `"x":"yes"`) {
		t.Fatalf("OR logic should have matched: %s", out)
	}
	mustSkip := []byte(`{"a":"banana"}`)
	out2, _, err := applyRewriteChains(mustSkip, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
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
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
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
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != string(body) {
		t.Fatalf("expected unchanged body, got %s", updated)
	}
}

func TestRewriteScopeCompile_header_path_with_header_scope(t *testing.T) {
	ops, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"set","value":"v","scope":"header"}]`)
	if err != nil {
		t.Fatalf("expected compile success for scope=header+header.X-Foo, got: %v", err)
	}
	if len(ops) != 1 || ops[0].Scope != "header" {
		t.Fatalf("expected Scope=header preserved, got %+v", ops)
	}
}

func TestRewriteScopeCompile_header_scope_rejects_body_path(t *testing.T) {
	_, err := compileRewriteChain("r", `[{"path":"model","mode":"set","value":"x","scope":"header"}]`)
	if err == nil || !strings.Contains(err.Error(), "scope") || !strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("expected scope/path incompatibility error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "rule r") {
		t.Fatalf("expected error to name rule id, got: %v", err)
	}
}

func TestRewriteScopeCompile_body_path_with_body_scope(t *testing.T) {
	ops, err := compileRewriteChain("r", `[{"path":"model","mode":"set","value":"x","scope":"body"}]`)
	if err != nil {
		t.Fatalf("expected compile success for scope=body+model, got: %v", err)
	}
	if len(ops) != 1 || ops[0].Scope != "body" {
		t.Fatalf("expected Scope=body preserved, got %+v", ops)
	}
}

func TestRewriteScopeCompile_body_scope_rejects_header_path(t *testing.T) {
	_, err := compileRewriteChain("r", `[{"path":"header.X","mode":"set","value":"v","scope":"body"}]`)
	if err == nil || !strings.Contains(err.Error(), "scope") || !strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("expected scope/path incompatibility error, got: %v", err)
	}
}

func TestRewriteScopeCompile_all_scope_accepts_both_paths(t *testing.T) {
	if _, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"set","value":"v","scope":"all"}]`); err != nil {
		t.Fatalf("scope=all + header.X-Foo should compile, got: %v", err)
	}
	if _, err := compileRewriteChain("r", `[{"path":"model","mode":"set","value":"x","scope":"all"}]`); err != nil {
		t.Fatalf("scope=all + model should compile, got: %v", err)
	}
}

func TestRewriteScopeCompile_empty_scope_accepts_both_paths(t *testing.T) {
	if _, err := compileRewriteChain("r", `[{"path":"header.X","mode":"set","value":"v"}]`); err != nil {
		t.Fatalf("no scope + header.X should compile (default=all), got: %v", err)
	}
	if _, err := compileRewriteChain("r", `[{"path":"model","mode":"set","value":"x"}]`); err != nil {
		t.Fatalf("no scope + model should compile, got: %v", err)
	}
}

func TestRewriteScopeCompile_rejects_unknown_scope(t *testing.T) {
	_, err := compileRewriteChain("r", `[{"path":"model","mode":"set","value":"x","scope":"invalid_value"}]`)
	if err == nil || !strings.Contains(err.Error(), "unsupported scope") {
		t.Fatalf("expected unsupported scope error, got: %v", err)
	}
}

func TestRewriteHeaderRoutingStub(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"set","value":"v"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, headers, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if headers["X-Foo"] != "v" {
		t.Fatalf("expected X-Foo=v, got %q", headers["X-Foo"])
	}
}

func TestRewriteChainsNilGuard(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"set","value":"v"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, headers, err := applyRewriteChains(nil, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if headers == nil {
		t.Fatal("expected headers to be initialized, got nil")
	}
	if headers["X-Foo"] != "v" {
		t.Fatalf("expected X-Foo=v, got %q", headers["X-Foo"])
	}
}
