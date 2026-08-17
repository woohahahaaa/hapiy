package handler

import (
	"testing"
)

func TestExtractUsageInfoOpenAIChatCompletion(t *testing.T) {
	body := []byte(`{"object":"chat.completion","usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}}`)
	got := extractUsageInfo(body, "application/json")
	if got == nil {
		t.Fatal("expected usage to be extracted")
	}
	if got.PromptTokens != 12 || got.CompletionTokens != 34 || got.TotalTokens != 46 {
		t.Fatalf("got %+v, want prompt=12 completion=34 total=46", got)
	}
}

func TestExtractUsageInfoSSEChatChunks(t *testing.T) {
	body := "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n" +
		"data: {\"object\":\"chat.completion.chunk\",\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":5}}\n\n" +
		"data: [DONE]\n\n"
	got := extractUsageInfo([]byte(body), "text/event-stream")
	if got == nil {
		t.Fatal("expected usage info from SSE chunks")
	}
	if got.PromptTokens != 7 || got.CompletionTokens != 5 {
		t.Fatalf("got %+v, want prompt=7 completion=5", got)
	}
}

func TestExtractUsageInfoAnthropicInputOutputTokens(t *testing.T) {
	body := `data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}` + "\n\n"
	got := extractUsageInfo([]byte(body), "text/event-stream")
	if got == nil {
		t.Fatal("expected usage info from Anthropic message")
	}
	if got.PromptTokens != 9 || got.CompletionTokens != 1 {
		t.Fatalf("got %+v, want prompt=9 completion=1", got)
	}
}

func TestExtractUsageInfoNoUsageReturnsNil(t *testing.T) {
	if got := extractUsageInfo([]byte(`{"object":"chat.completion"}`), "application/json"); got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
	if got := extractUsageInfo(nil, "application/json"); got != nil {
		t.Fatalf("expected nil for empty body, got %+v", got)
	}
	if got := extractUsageInfo([]byte(`not json`), "application/json"); got != nil {
		t.Fatalf("expected nil for invalid json, got %+v", got)
	}
}

func TestExtractUsageInfoZeroTokensReturnsNil(t *testing.T) {
	body := []byte(`{"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`)
	if got := extractUsageInfo(body, "application/json"); got != nil {
		t.Fatalf("expected nil when both token counts are zero, got %+v", got)
	}
}

func TestExtractUsageInfoDeepSeekCacheFields(t *testing.T) {
	body := []byte(`{"usage":{"prompt_tokens":120,"completion_tokens":50,"total_tokens":170,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":40}}`)
	got := extractUsageInfo(body, "application/json")
	if got == nil {
		t.Fatal("expected usage info")
	}
	if got.CacheWriteTokens != 40 || got.CacheReadTokens != 80 {
		t.Fatalf("got cacheWrite=%d cacheRead=%d, want write=40 read=80", got.CacheWriteTokens, got.CacheReadTokens)
	}
}

func TestExtractUsageInfoMissingCacheFieldsDefaultsZero(t *testing.T) {
	body := []byte(`{"usage":{"prompt_tokens":5,"completion_tokens":3}}`)
	got := extractUsageInfo(body, "application/json")
	if got == nil {
		t.Fatal("expected usage info")
	}
	if got.CacheWriteTokens != 0 || got.CacheReadTokens != 0 {
		t.Fatalf("got write=%d read=%d, want 0/0", got.CacheWriteTokens, got.CacheReadTokens)
	}
}