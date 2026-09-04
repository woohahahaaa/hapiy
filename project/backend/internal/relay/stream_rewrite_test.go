package relay

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func compileStreamChain(t *testing.T, ruleID, script string) []CompiledRewriteChain {
	t.Helper()
	ops, err := compileRewriteChain(ruleID, script)
	if err != nil {
		t.Fatalf("compile %s: %v", ruleID, err)
	}
	return []CompiledRewriteChain{{RuleID: ruleID, Ops: ops}}
}

func readAllStream(t *testing.T, src string, chains []CompiledRewriteChain) string {
	t.Helper()
	r := newStreamRewriteReader(strings.NewReader(src), chains)
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	return string(out)
}

func TestStreamRewrite_first_prepend_applies_on_first_matching_event_only(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"choices.0.delta.reasoning_content","mode":"first_prepend","value":"[[think]]"}]`)
	src := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"a\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"b\"}}]}\n\n" +
		"data: [DONE]\n\n"
	got := readAllStream(t, src, chains)
	if strings.Contains(got, "[[think]]a") == false {
		t.Fatalf("first event should get prefix: %s", got)
	}
	if strings.Contains(got, "[[think]]b") {
		t.Fatalf("second event must NOT get prefix: %s", got)
	}
}

func TestStreamRewrite_last_append_applies_on_last_matching_event_only(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"choices.0.delta.reasoning_content","mode":"last_append","value":"[[/think]]"}]`)
	src := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"a\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"b\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"c\"}}]}\n\n" +
		"data: [DONE]\n\n"
	got := readAllStream(t, src, chains)
	if strings.Contains(got, "a[[/think]]") {
		t.Fatalf("first reasoning event must NOT get suffix: %s", got)
	}
	if !strings.Contains(got, `"reasoning_content":"b[[/think]]"`) {
		t.Fatalf("last reasoning event should get suffix: %s", got)
	}
}

func TestStreamRewrite_first_prepend_and_last_append_think_tag(t *testing.T) {
	chains := compileStreamChain(t, "r", `[
		{"path":"choices.0.delta.reasoning_content","mode":"first_prepend","value":"  thinking\n"},
		{"path":"choices.0.delta.reasoning_content","mode":"last_append","value":"\n  /thinking"}
	]`)
	src := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"a\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"b\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"c\"}}]}\n\n" +
		"data: [DONE]\n\n"
	got := readAllStream(t, src, chains)
	if !strings.Contains(got, `"reasoning_content":"  thinking\na"`) {
		t.Fatalf("first event missing thinking prefix: %s", got)
	}
	if strings.Contains(got, `"reasoning_content":"  thinking\nb"`) {
		t.Fatalf("second event must not repeat prefix: %s", got)
	}
	if !strings.Contains(got, `"reasoning_content":"b\n  /thinking"`) {
		t.Fatalf("last reasoning event missing think suffix: %s", got)
	}
}

func TestStreamRewrite_regular_op_applies_to_every_event(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"model","mode":"set","value":"gpt-x"}]`)
	src := "data: {\"choices\":[{\"delta\":{\"content\":\"a\"},\"model\":\"m\"}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"b\"},\"model\":\"m\"}]}\n\n"
	got := readAllStream(t, src, chains)
	if strings.Count(got, `"model":"gpt-x"`) != 2 {
		t.Fatalf("set op should apply to both events: %s", got)
	}
}

func TestStreamRewrite_passthrough_non_json_and_done(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"model","mode":"set","value":"gpt-x"}]`)
	src := ": keep-alive\n\n" +
		"data: [DONE]\n\n"
	got := readAllStream(t, src, chains)
	if !strings.Contains(got, ": keep-alive") {
		t.Fatalf("comment line should pass through: %s", got)
	}
	if !strings.Contains(got, "data: [DONE]") {
		t.Fatalf("[DONE] should pass through: %s", got)
	}
}

func TestStreamRewrite_multiple_last_append_ops_across_different_paths(t *testing.T) {
	chains := compileStreamChain(t, "r", `[
		{"path":"a","mode":"last_append","value":"A"},
		{"path":"b","mode":"last_append","value":"B"}
	]`)
	src := "data: {\"a\":\"1\",\"b\":\"2\"}\n\n" +
		"data: {\"a\":\"3\"}\n\n" +
		"data: {\"c\":\"4\"}\n\n"
	got := readAllStream(t, src, chains)
	// a's last event is the second (a=3); b's last event is the first (b=2).
	if !strings.Contains(got, `"a":"3A"`) {
		t.Fatalf("a should get suffix on its last event: %s", got)
	}
	if !strings.Contains(got, `"b":"2B"`) {
		t.Fatalf("b should get suffix on its last event: %s", got)
	}
	if strings.Contains(got, `"a":"1A"`) || strings.Contains(got, `"b":"2"B"`) {
		t.Fatalf("non-last events must not carry suffix: %s", got)
	}
}

func TestStreamRewrite_no_trailing_newline_finalizes_held(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"choices.0.delta.reasoning_content","mode":"last_append","value":"X"}]`)
	// No trailing blank line: the final reasoning event must still get its
	// suffix at EOF.
	src := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"a\"}}]}"
	got := readAllStream(t, src, chains)
	if !strings.Contains(got, `"reasoning_content":"aX"`) {
		t.Fatalf("held event should be finalized at EOF: %s", got)
	}
}

func TestStreamRewrite_move_op_renames_key(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"choices.0.delta.reasoning_content","mode":"move","dst":"choices.0.delta.content"}]`)
	src := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hi\"}}]}\n\n"
	got := readAllStream(t, src, chains)
	if strings.Contains(got, "reasoning_content") {
		t.Fatalf("move should remove source key: %s", got)
	}
	if !strings.Contains(got, `"content":"hi"`) {
		t.Fatalf("move should place value at destination: %s", got)
	}
}

func TestStreamRewrite_reader_byte_chunks(t *testing.T) {
	chains := compileStreamChain(t, "r", `[{"path":"a","mode":"set","value":"ok"}]`)
	src := "data: {\"a\":\"1\"}\n\ndata: {\"a\":\"2\"}\n\n"
	r := newStreamRewriteReader(strings.NewReader(src), chains)
	var buf bytes.Buffer
	tmp := make([]byte, 5)
	for {
		n, err := r.Read(tmp)
		buf.Write(tmp[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read: %v", err)
		}
	}
	got := buf.String()
	if strings.Count(got, `"a":"ok"`) != 2 {
		t.Fatalf("set op should apply to both events across chunked reads: %s", got)
	}
}
