package relay

import (
	"regexp"
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

func TestApplyScript_set_boolean_preserves_json_type(t *testing.T) {
	updated, err := ApplyScript([]byte(`{}`), `[{"mode":"set","path":"reasoning_split","value":true}]`)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"reasoning_split":true}` {
		t.Fatalf("expected native JSON boolean, got %s", updated)
	}
}

func TestCondition_native_bool_is_type_aware(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"out","mode":"set","value":"hit","conditions":[{"path":"f","op":"eq","value":true}]}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	out, _, err := applyRewriteChains([]byte(`{"f":true}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply bool: %v", err)
	}
	if !strings.Contains(string(out), `"out":"hit"`) {
		t.Fatalf("native true should match JSON bool true: %s", out)
	}
	out, _, err = applyRewriteChains([]byte(`{"f":"true"}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply string: %v", err)
	}
	if strings.Contains(string(out), `"out":"hit"`) {
		t.Fatalf("native true must NOT match JSON string \"true\": %s", out)
	}
}

func TestCondition_native_null_and_number(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"a","mode":"set","value":"1","conditions":[{"path":"v","op":"eq","value":null}]},
		{"path":"b","mode":"set","value":"2","conditions":[{"path":"n","op":"gte","value":1.5}]}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	out, _, err := applyRewriteChains([]byte(`{"v":null,"n":2}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply match: %v", err)
	}
	if !strings.Contains(string(out), `"a":"1"`) || !strings.Contains(string(out), `"b":"2"`) {
		t.Fatalf("null eq and numeric gte should match: %s", out)
	}
	out, _, err = applyRewriteChains([]byte(`{"v":"null","n":1}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply no-match: %v", err)
	}
	if strings.Contains(string(out), `"a":"1"`) || strings.Contains(string(out), `"b":"2"`) {
		t.Fatalf("string \"null\" and n=1 must not match: %s", out)
	}
}

func TestCompileCondition_rejects_object_value(t *testing.T) {
	_, err := compileRewriteChain("r", `[{"path":"a","mode":"delete","conditions":[{"path":"x","op":"eq","value":{"k":1}}]}]`)
	if err == nil {
		t.Fatal("object condition value must fail compilation")
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

func TestRewriteHeaderSetDelete(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-Foo","mode":"set","value":"bar"},
		{"path":"header.X-Foo","mode":"delete"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Other": "keep"}
	_, out, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Foo"] != "" {
		t.Fatalf("expected X-Foo deleted, got %q", out["X-Foo"])
	}
	if out["X-Other"] != "keep" {
		t.Fatalf("expected X-Other untouched, got %q", out["X-Other"])
	}
}

func TestRewriteHeaderAppendPrepend(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-Foo","mode":"set","value":"world"},
		{"path":"header.X-Foo","mode":"append","value":"!"},
		{"path":"header.X-Foo","mode":"prepend","value":"hello "}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Foo"] != "hello world!" {
		t.Fatalf("expected 'hello world!', got %q", out["X-Foo"])
	}
}

func TestRewriteHeaderEnsureTrim(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-A","mode":"set","value":"foo-bar"},
		{"path":"header.X-A","mode":"ensure_prefix","value":"pre-"},
		{"path":"header.X-A","mode":"ensure_suffix","value":"-suf"},
		{"path":"header.X-A","mode":"trim_prefix","value":"pre-"},
		{"path":"header.X-A","mode":"trim_suffix","value":"-suf"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-A"] != "foo-bar" {
		t.Fatalf("expected 'foo-bar', got %q", out["X-A"])
	}
}

func TestRewriteHeaderStringOps(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-Lo","mode":"set","value":"FOO"},
		{"path":"header.X-Lo","mode":"to_lower"},
		{"path":"header.X-Up","mode":"set","value":"bar"},
		{"path":"header.X-Up","mode":"to_upper"},
		{"path":"header.X-Trim","mode":"set","value":"  baz  "},
		{"path":"header.X-Trim","mode":"trim_space"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Lo"] != "foo" {
		t.Fatalf("expected 'foo', got %q", out["X-Lo"])
	}
	if out["X-Up"] != "BAR" {
		t.Fatalf("expected 'BAR', got %q", out["X-Up"])
	}
	if out["X-Trim"] != "baz" {
		t.Fatalf("expected 'baz', got %q", out["X-Trim"])
	}
}

func TestRewriteHeaderReplaceRegex(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-Rep","mode":"set","value":"hello world"},
		{"path":"header.X-Rep","mode":"replace","from":"world","to":"go"},
		{"path":"header.X-Reg","mode":"set","value":"aaa bbb ccc"},
		{"path":"header.X-Reg","mode":"regex_replace","from":"\\s+","to":"-"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Rep"] != "hello go" {
		t.Fatalf("expected 'hello go', got %q", out["X-Rep"])
	}
	if out["X-Reg"] != "aaa-bbb-ccc" {
		t.Fatalf("expected 'aaa-bbb-ccc', got %q", out["X-Reg"])
	}
}

func TestRewriteHeaderConditionPath(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{
			"path":"header.X-Route",
			"mode":"set",
			"value":"premium",
			"conditions":[{"path":"header.X-Tenant","op":"neq","value":"free"}]
		},
		{
			"path":"header.X-Tag",
			"mode":"set",
			"value":"matched",
			"conditions":[{"path":"header.X-Route","op":"matches","value":"^premium$"}]
		}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Tenant": "pro", "X-Route": "basic"}
	_, out, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Route"] != "premium" {
		t.Fatalf("expected X-Route=premium (neq passed), got %q", out["X-Route"])
	}
	if out["X-Tag"] != "matched" {
		t.Fatalf("expected X-Tag=matched (matches passed), got %q", out["X-Tag"])
	}
}

func TestRewriteHeaderConditionPathFailsWhenNoMatch(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{
			"path":"header.X-Route",
			"mode":"set",
			"value":"premium",
			"conditions":[{"path":"header.X-Tenant","op":"eq","value":"free"}]
		}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Tenant": "pro"}
	_, out, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["X-Route"] != "" {
		t.Fatalf("expected X-Route unset (condition failed), got %q", out["X-Route"])
	}
}

func TestRewriteHeaderCopyMoveRejected(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"copy","dst":"header.X-Bar"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, _, err = applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err == nil || !strings.Contains(err.Error(), "copy/move not supported") {
		t.Fatalf("expected copy/move error, got: %v", err)
	}
}

func TestRewriteEngineHeaderWiring(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.X-Foo","mode":"set","value":"bar"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	e := &Engine{plans: map[string]*ExecutionPlan{}}
	req := &RelayRequest{
		Headers: map[string]string{},
		Body:    map[string]interface{}{"model": "gpt-4"},
	}
	plan := &ExecutionPlan{CompiledRewrite: []CompiledRewriteChain{{RuleID: "r", Ops: chain}}}
	if err := e.applyCompiledRewriteRules(plan, req); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if req.Headers["X-Foo"] != "bar" {
		t.Fatalf("expected X-Foo=bar, got %q", req.Headers["X-Foo"])
	}
	if req.Body["model"] != "gpt-4" {
		t.Fatalf("expected model unchanged, got %v", req.Body["model"])
	}
}

func TestApplyRewriteChain_negative_index_resolves_to_last_message(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"messages.-1.content","mode":"set","value":"今天天气如何"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"role":"system","content":"sys"},{"role":"user","content":"你好"}]}`)
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	got := string(updated)
	if !strings.Contains(got, `"content":"今天天气如何"`) {
		t.Fatalf("negative index set did not rewrite last message: %s", got)
	}
	if !strings.Contains(got, `"content":"sys"`) {
		t.Fatalf("first message was wrongly touched: %s", got)
	}
}

func TestApplyRewriteChain_negative_index_into_content_array(t *testing.T) {
	// opencode's newer chat format uses content as an array of {type,text}.
	chain, err := compileRewriteChain("r", `[
		{"path":"messages.-1.content.0.text","mode":"set","value":"今天天气如何"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"role":"system","content":"sys"},{"role":"user","content":[{"text":"你好","type":"text"},{"text":"<system-reminder>x</system-reminder>","type":"text"}]}]}`)
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	got := string(updated)
	if !strings.Contains(got, `"text":"今天天气如何"`) {
		t.Fatalf("content array element was not rewritten: %s", got)
	}
	if strings.Contains(got, `"text":"你好"`) {
		t.Fatalf("original 你好 still present: %s", got)
	}
	if !strings.Contains(got, `"text":"<system-reminder>x</system-reminder>"`) {
		t.Fatalf("second content element was lost: %s", got)
	}
}

func TestResolveSjsonPath_negative_indexes(t *testing.T) {
	body := []byte(`{"messages":[{"a":1},{"a":2},{"a":3}]}`)
	cases := map[string]string{
		"messages.-1.content": "messages.2.content",
		"messages.-2.x":       "messages.1.x",
		"messages.0":          "messages.0",
		"messages.-1":         "messages.2",
		"messages":            "messages",
		"messages.-9.content": "messages.-9.content", // out of range: unchanged
	}
	for in, want := range cases {
		if got := resolveSjsonPath(body, in); got != want {
			t.Errorf("resolveSjsonPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// ── 变量引用（set 的 {"ref":"..."}） ──

func TestRewriteRefHeaderSetFromOriginalHeader(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.x-opencode-session","mode":"set","value":{"ref":"X-Session-Id"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Session-Id": "session-123"}
	_, out, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["x-opencode-session"] != "session-123" {
		t.Fatalf("expected ref value copied, got %q", out["x-opencode-session"])
	}
	if out["X-Session-Id"] != "session-123" {
		t.Fatalf("source header must stay untouched, got %q", out["X-Session-Id"])
	}
}

func TestRewriteRefHeaderStripsHeaderPrefixAndSkipsMissingSource(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.X-Copy","mode":"set","value":{"ref":"header.X-Session-Id"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	// 源不存在：op 跳过，不写入空值。
	_, out, err := applyRewriteChains([]byte(`{}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if _, ok := out["X-Copy"]; ok {
		t.Fatalf("missing ref source should skip the op, got %q", out["X-Copy"])
	}
	// 源存在：header. 前缀被剥掉后按名字查找。
	headers := map[string]string{"X-Session-Id": "s1"}
	_, out2, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out2["X-Copy"] != "s1" {
		t.Fatalf("expected prefixed ref to resolve, got %q", out2["X-Copy"])
	}
}

func TestRewriteRefBodyCopiesOriginalValueWithType(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"target","mode":"set","value":{"ref":"source"}}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"source":{"nested":1},"target":null}`)
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"source":{"nested":1},"target":{"nested":1}}` {
		t.Fatalf("expected raw source value copied, got %s", updated)
	}
}

func TestRewriteRefReadsOriginalSnapshotNotEarlierOps(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"source","mode":"set","value":99},
		{"path":"target","mode":"set","value":{"ref":"source"}}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	updated, _, err := applyRewriteChains([]byte(`{"source":1}`), nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"source":99,"target":1}` {
		t.Fatalf("ref should read the pre-rewrite value, got %s", updated)
	}
}

func TestRewriteRefMissingBodySourceIsNoOp(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"target","mode":"set","value":{"ref":"nope"}}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"target":"keep"}`)
	updated, _, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != string(body) {
		t.Fatalf("expected unchanged body, got %s", updated)
	}
}

// ── header 名字大小写不敏感 ──

// 客户端头进 map 时是 Go 规范拼写（X-Opencode-Session），规则作者写的名字保持
// 自己的拼写；两条路径必须能对上，否则条件会误判、写入会留下两个同名条目。
func TestRewriteHeaderNameCaseInsensitive(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.x-out","mode":"set","value":{"ref":"x-session-id"},"scope":"header",
		 "conditions":[{"path":"header.x-session-id","op":"eq","value":"","scope":"header","invert":true}]}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	// 客户端按规范拼写发来，规则用全小写引用 + 条件，都要能命中。
	headers := map[string]string{"X-Session-Id": "ses_1"}
	_, out, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["x-out"] != "ses_1" {
		t.Fatalf("lowercase ref must resolve the canonical client header, got %q", out["x-out"])
	}

	// 写 x-opencode-session 时必须更新已有的规范拼写条目，而不是新增一个小写条目。
	chain2, err := compileRewriteChain("r2", `[
		{"path":"header.x-opencode-session","mode":"set","value":"derived","scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile 2: %v", err)
	}
	_, out2, err := applyRewriteChains([]byte(`{}`), map[string]string{"X-Opencode-Session": "ses_1"},
		[]CompiledRewriteChain{{RuleID: "r2", Ops: chain2}})
	if err != nil {
		t.Fatalf("apply 2: %v", err)
	}
	if out2["X-Opencode-Session"] != "derived" {
		t.Fatalf("write must update the existing canonical entry, got %q", out2["X-Opencode-Session"])
	}
	if _, dup := out2["x-opencode-session"]; dup {
		t.Fatalf("write must not leave a second case-variant entry: %#v", out2)
	}
}

func TestRewriteHeaderDeleteCaseInsensitive(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.x-api-key","mode":"delete","scope":"header"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains([]byte(`{}`), map[string]string{"X-Api-Key": "secret", "Other": "keep"},
		[]CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if _, ok := out["X-Api-Key"]; ok {
		t.Fatalf("delete must remove the case variant, got %#v", out)
	}
	if out["Other"] != "keep" {
		t.Fatalf("unrelated headers must stay, got %#v", out)
	}
}

// The deployed "为 opencode go 添加x-opencode-session" chain, verbatim: the
// client's own session id wins, the harness's native header comes next, and the
// derived id is the last resort. This guards the property the whole rule exists
// for — never replacing an id the client already sent.
func TestRewriteOpencodeSessionChain(t *testing.T) {
	const script = `[
		{"mode":"set","path":"header.x-opencode-session","value":{"ref":"X-Session-Id"},"scope":"header"},
		{"mode":"set","path":"header.x-opencode-session","value":{"ref":"x-deepseek-harness-session-id"},"scope":"header",
		 "conditions":[{"path":"header.x-opencode-session","op":"eq","value":"","scope":"header"}]},
		{"mode":"set","path":"header.x-opencode-session","value":{"hash":"body.messages.1.content"},"scope":"header",
		 "conditions":[{"path":"header.x-opencode-session","op":"eq","value":"","scope":"header"}]}
	]`
	chain, err := compileRewriteChain("r", script)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"role":"system","content":"s"},{"role":"user","content":"你好"}]}`)

	// opencode 自己带了会话头（规范拼写）：原值必须原样保留，不能被派生 id 顶掉。
	clientHeaders := map[string]string{"X-Session-Id": "ses_client", "X-Opencode-Session": "ses_client"}
	_, out, err := applyRewriteChains(body, clientHeaders, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply client: %v", err)
	}
	if out["X-Opencode-Session"] != "ses_client" {
		t.Fatalf("a client-provided session must win, got %q", out["X-Opencode-Session"])
	}

	// 只带 DSH 原生头（任意拼写）：优先照抄它。
	native := map[string]string{"x-deepseek-harness-session-id": "native-1"}
	_, out2, err := applyRewriteChains(body, native, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply native: %v", err)
	}
	if out2["x-opencode-session"] != "native-1" {
		t.Fatalf("the harness native header must be copied, got %q", out2["x-opencode-session"])
	}

	// 什么都没有：派生一个稳定 id。这就是 DSH 现在走的路径。
	_, out3, err := applyRewriteChains(body, map[string]string{"User-Agent": "deepseek-harness/0.2.0-rc.2"},
		[]CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply derived: %v", err)
	}
	if out3["x-opencode-session"] != "670d9743-542c-4e3e-a7eb-e36af56bd536" {
		t.Fatalf("expected the derived id, got %q", out3["x-opencode-session"])
	}
}

// ── 哈希来源（set 的 {"hash":"<来源>"}） ──

func TestCompileHashSource(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.x","mode":"set","value":{"hash":"body.messages.1.content"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if chain[0].HashPath != "messages.1.content" || chain[0].HashDomain != "body" {
		t.Fatalf("hash source = %q/%q, want messages.1.content/body", chain[0].HashDomain, chain[0].HashPath)
	}
	// 裸来源同样按目标域解释。
	bare, err := compileRewriteChain("r", `[{"path":"out","mode":"set","value":{"hash":"messages.1.content"}}]`)
	if err != nil {
		t.Fatalf("compile bare: %v", err)
	}
	if bare[0].HashPath != "messages.1.content" || bare[0].HashDomain != "body" {
		t.Fatalf("bare hash source = %q/%q, want messages.1.content/body", bare[0].HashDomain, bare[0].HashPath)
	}
}

func TestCompileHashSourceRejectsBadShapes(t *testing.T) {
	if _, err := compileRewriteChain("r", `[{"path":"x","mode":"set","value":{"hash":123}}]`); err == nil || !strings.Contains(err.Error(), "hash is not a string") {
		t.Fatalf("expected non-string hash rejection, got: %v", err)
	}
	if _, err := compileRewriteChain("r", `[{"path":"x","mode":"set","value":{"hash":"header."}}]`); err == nil || !strings.Contains(err.Error(), "hash source is empty") {
		t.Fatalf("expected empty hash source rejection, got: %v", err)
	}
}

// The motivating shape: derive the per-conversation id from the first user
// message and write it into the required header. The value must be a stable,
// UUID-shaped token — the exact vector pins both the algorithm and the format.
func TestRewriteHashDerivesStableID(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.x-opencode-session","mode":"set","value":{"hash":"body.messages.1.content"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"content":"hi"},{"content":"你好"}]}`)
	_, out, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	const want = "670d9743-542c-4e3e-a7eb-e36af56bd536"
	if out["x-opencode-session"] != want {
		t.Fatalf("derived id = %q, want %q", out["x-opencode-session"], want)
	}

	// 同一条首句再来一次：同一个 id（每轮稳定）。
	_, out2, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply again: %v", err)
	}
	if out2["x-opencode-session"] != want {
		t.Fatalf("derived id must be stable across turns, got %q", out2["x-opencode-session"])
	}

	// 换个首句：不同的 id（会话之间不同）。
	other := []byte(`{"messages":[{"content":"hi"},{"content":"hello"}]}`)
	_, out3, err := applyRewriteChains(other, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply other: %v", err)
	}
	if out3["x-opencode-session"] == want || out3["x-opencode-session"] == "" {
		t.Fatalf("a different opener must derive a different id, got %q", out3["x-opencode-session"])
	}
}

func TestRewriteHashBodyDestinationWritesString(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"session","mode":"set","value":{"hash":"header.X-Session-Id"}}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Session-Id": "ses-1"}
	updated, _, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	// 跨域（header → body）+ 确定性：同一来源两次得到同一个 UUID 形状的值。
	updated2, _, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply again: %v", err)
	}
	if string(updated) != string(updated2) {
		t.Fatalf("hash must be deterministic: %s vs %s", updated, updated2)
	}
	uuidShape := regexp.MustCompile(`^\{"session":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"\}$`)
	if !uuidShape.Match(updated) {
		t.Fatalf("expected a UUID-shaped JSON string, got %s", updated)
	}
}

func TestCompileRefDomain(t *testing.T) {
	cases := []struct {
		script string
		domain string
		ref    string
	}{
		// 裸文本沿用历史语义：按目标路径的域解释。
		{`[{"path":"header.a","mode":"set","value":{"ref":"X-Session-Id"},"scope":"header"}]`, "header", "X-Session-Id"},
		{`[{"path":"a","mode":"set","value":{"ref":"value"}}]`, "body", "value"},
		// 显式前缀决定来源域。
		{`[{"path":"header.a","mode":"set","value":{"ref":"header.X-Session-Id"},"scope":"header"}]`, "header", "X-Session-Id"},
		{`[{"path":"a","mode":"set","value":{"ref":"body.value"}}]`, "body", "value"},
		{`[{"path":"header.a","mode":"set","value":{"ref":"body.messages.1.content"},"scope":"header"}]`, "body", "messages.1.content"},
		{`[{"path":"a","mode":"set","value":{"ref":"header.X-Session-Id"},"scope":"body"}]`, "header", "X-Session-Id"},
	}
	for _, tc := range cases {
		chain, err := compileRewriteChain("r", tc.script)
		if err != nil {
			t.Fatalf("compile %s: %v", tc.script, err)
		}
		op := chain[0]
		if op.RefDomain != tc.domain || op.Ref != tc.ref {
			t.Errorf("%s → domain=%q ref=%q, want domain=%q ref=%q", tc.script, op.RefDomain, op.Ref, tc.domain, tc.ref)
		}
	}
}

func TestRewriteRefCrossDomainHeaderReadsBody(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"header.x-from-body","mode":"set","value":{"ref":"body.messages.1.content"},"scope":"header"}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	body := []byte(`{"messages":[{"content":"hi"},{"content":"你好"}]}`)
	_, out, err := applyRewriteChains(body, nil, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["x-from-body"] != "你好" {
		t.Fatalf("expected the body value in the header, got %q", out["x-from-body"])
	}
}

func TestRewriteRefCrossDomainBodyReadsHeader(t *testing.T) {
	chain, err := compileRewriteChain("r", `[
		{"path":"session","mode":"set","value":{"ref":"header.X-Session-Id"}}
	]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	headers := map[string]string{"X-Session-Id": "s-1"}
	updated, _, err := applyRewriteChains([]byte(`{}`), headers, []CompiledRewriteChain{{RuleID: "r", Ops: chain}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"session":"s-1"}` {
		t.Fatalf("expected the header value as a JSON string, got %s", updated)
	}
}

// 裸引用仍按目标域解释：同名值同时存在于 body 和 header 时各取各的，不能被
// 跨域能力顺手改掉。
func TestRewriteRefBareKeepsDestinationScope(t *testing.T) {
	chain, err := compileRewriteChain("r", `[{"path":"header.out","mode":"set","value":{"ref":"value"}}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_, out, err := applyRewriteChains(
		[]byte(`{"value":"from-body"}`),
		map[string]string{"value": "from-header"},
		[]CompiledRewriteChain{{RuleID: "r", Ops: chain}},
	)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if out["out"] != "from-header" {
		t.Fatalf("bare ref in a header op must read the header, got %q", out["out"])
	}

	chainBody, err := compileRewriteChain("r", `[{"path":"out","mode":"set","value":{"ref":"value"}}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	updated, _, err := applyRewriteChains(
		[]byte(`{"value":"from-body"}`),
		map[string]string{"value": "from-header"},
		[]CompiledRewriteChain{{RuleID: "r", Ops: chainBody}},
	)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"value":"from-body","out":"from-body"}` {
		t.Fatalf("bare ref in a body op must read the body, got %s", updated)
	}
}

func TestRewriteRefRejectsBadShapes(t *testing.T) {
	if _, err := compileRewriteChain("r", `[{"path":"x","mode":"set","value":{"ref":123}}]`); err == nil || !strings.Contains(err.Error(), "ref is not a string") {
		t.Fatalf("expected non-string ref rejection, got: %v", err)
	}
	if _, err := compileRewriteChain("r", `[{"path":"header.X","mode":"set","value":{"ref":"header."},"scope":"header"}]`); err == nil || !strings.Contains(err.Error(), "ref is empty") {
		t.Fatalf("expected empty ref rejection, got: %v", err)
	}
}

func TestRewriteRefObjectLiteralStillWorks(t *testing.T) {
	// 非引用形状的对象仍是普通对象字面量，别误判成引用。
	updated, err := ApplyScript([]byte(`{}`), `[{"mode":"set","path":"obj","value":{"a":1}}]`)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if string(updated) != `{"obj":{"a":1}}` {
		t.Fatalf("expected object literal preserved, got %s", updated)
	}
}
