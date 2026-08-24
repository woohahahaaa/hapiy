package relay

import (
	"strings"
	"testing"
)

func TestApplyRecoveryHandler_gjsonWildcardPaths(t *testing.T) {
	body := []byte(`{"model":"gpt-5","messages":[{"role":"system","content":"非常长的系统提示"},{"role":"user","content":[{"type":"text","text":"很长的用户消息"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}]}],"tools":[{"type":"function","function":{"name":"a","parameters":{"type":"object"}}}]}`)

	h := &RecoveryRequestHandler{Ops: []RecoveryOp{
		{Path: "messages.#.content", Action: "replace", Value: "你好"},
		{Path: "messages.#.content.#(type==\"image_url\").image_url.url", Action: "delete"},
		{Path: "messages.#(role==\"system\").content", Action: "replace", Value: "你好"},
		{Path: "tools", Action: "delete"},
	}}

	out, applied := applyRecoveryHandler(body, h)
	if !applied {
		t.Fatalf("expected applied=true")
	}
	s := string(out)
	if strings.Contains(s, "非常长的系统提示") {
		t.Errorf("system content was not replaced: %s", s)
	}
	if strings.Contains(s, "data:image/png;base64,AAAA") {
		t.Errorf("image_url base64 was not deleted: %s", s)
	}
	if strings.Contains(s, "tools") {
		t.Errorf("tools was not deleted: %s", s)
	}
	if !strings.Contains(s, "你好") {
		t.Errorf("expected 你好 in output: %s", s)
	}
}

func TestApplyRecoveryHandler_skipsMissingPath(t *testing.T) {
	body := []byte(`{"model":"gpt-5","messages":[{"role":"user","content":"你好"}]}`)
	h := &RecoveryRequestHandler{Ops: []RecoveryOp{
		{Path: "messages.#(role==\"system\").content", Action: "replace", Value: "你好"},
		{Path: "instructions", Action: "replace", Value: "你好"},
		{Path: "tools", Action: "delete"},
	}}
	out, applied := applyRecoveryHandler(body, h)
	if applied {
		t.Fatalf("expected applied=false when nothing matched, got %s", string(out))
	}
}
