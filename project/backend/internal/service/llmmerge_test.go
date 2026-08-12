package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// loadMitllmResponse reads the body field of a mitllm capture file. Skips
// when MERGE_TESTDATA_DIR is unset.
func loadMitllmResponse(t *testing.T, name string) string {
	t.Helper()
	dir := os.Getenv("MERGE_TESTDATA_DIR")
	if dir == "" {
		dir = "testdata"
	}
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Skipf("capture %s not available (set MERGE_TESTDATA_DIR or add it under testdata/): %v", name, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	body, _ := payload["body"].(string)
	return body
}

func TestMergeLLMBody_Anthropic(t *testing.T) {
	body := loadMitllmResponse(t, "anthropic_response.json")
	if body == "" {
		t.Skip("no test fixture")
	}
	merged, err := MergeLLMBody(body, "text/event-stream")
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	m, ok := merged.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", merged)
	}
	content, ok := m["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("expected non-empty content array, got %#v", m["content"])
	}
	first, _ := content[0].(map[string]any)
	if first == nil {
		t.Fatalf("expected first block to be a map")
	}
	if _, hasThinking := first["thinking"]; !hasThinking {
		t.Errorf("expected first block to be the thinking block, got %#v", first)
	}
	hasText := false
	for _, c := range content {
		if m, ok := c.(map[string]any); ok {
			if _, ok := m["text"]; ok {
				hasText = true
				break
			}
		}
	}
	if !hasText {
		t.Errorf("expected at least one merged content block to carry text")
	}
}

func TestMergeLLMBody_Chat(t *testing.T) {
	body := strings.Join([]string{
		`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}`,
		``,
		`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}`,
		``,
		`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")
	merged, err := MergeLLMBody(body, "text/event-stream")
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	m := merged.(map[string]any)
	if m["object"] != "chat.completion" {
		t.Errorf("object = %v, want chat.completion", m["object"])
	}
	choices := m["choices"].([]any)
	if len(choices) != 1 {
		t.Fatalf("expected 1 choice, got %d", len(choices))
	}
	msg := choices[0].(map[string]any)["message"].(map[string]any)
	if msg["content"] != "Hello world" {
		t.Errorf("content = %q, want %q", msg["content"], "Hello world")
	}
	if msg["role"] != "assistant" {
		t.Errorf("role = %v, want assistant", msg["role"])
	}
}

func TestMergeLLMBody_Responses(t *testing.T) {
	body := strings.Join([]string{
		`data: {"type":"response.created","response":{"id":"resp_1"}}`,
		``,
		`data: {"type":"response.completed","response":{"id":"resp_1","output":"done"}}`,
		``,
	}, "\n")
	merged, err := MergeLLMBody(body, "text/event-stream")
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	m := merged.(map[string]any)
	if m["id"] != "resp_1" || m["output"] != "done" {
		t.Errorf("merged = %#v", m)
	}
}

func TestMergeLLMBody_PlainJSON(t *testing.T) {
	body := `{"hello":"world","n":42}`
	merged, err := MergeLLMBody(body, "application/json")
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	m := merged.(map[string]any)
	if m["hello"] != "world" || m["n"].(float64) != 42 {
		t.Errorf("merged = %#v", m)
	}
}