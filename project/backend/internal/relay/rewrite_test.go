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
