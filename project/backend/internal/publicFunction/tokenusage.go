// Package publicfunction holds shared, reusable helpers.
package publicfunction

import (
	"encoding/json"
	"strings"

	"github.com/tidwall/gjson"
)

// TokenUsage is the four token counters the system records per request.
type TokenUsage struct {
	PromptTokens     int64
	CacheWriteTokens int64
	CacheReadTokens  int64
	CompletionTokens int64
}

// TokenUsageFields maps each recorded token counter to ordered gjson paths.
// Paths are tried in order; the first existing hit wins and later paths are
// skipped. The JSON shape is persisted as the "token_usage_fields" setting.
type TokenUsageFields struct {
	PromptTokens     []string `json:"prompt_tokens"`
	CacheWriteTokens []string `json:"cache_write_tokens"`
	CacheReadTokens  []string `json:"cache_read_tokens"`
	CompletionTokens []string `json:"completion_tokens"`
}

// DefaultTokenUsageFields presets the common upstream conventions: OpenAI
// (prompt_tokens/completion_tokens, nested prompt_tokens_details.cached_tokens),
// Anthropic (input_tokens/output_tokens, cache_creation_input_tokens,
// cache_read_input_tokens), and OpenAI-compatible gateways that surface the
// cache counters at the top level.
func DefaultTokenUsageFields() TokenUsageFields {
	return TokenUsageFields{
		PromptTokens:     []string{"usage.prompt_tokens", "usage.input_tokens"},
		CacheWriteTokens: []string{"usage.prompt_cache_miss_tokens", "usage.cache_creation_input_tokens"},
		CacheReadTokens:  []string{"usage.prompt_cache_hit_tokens", "usage.cache_read_input_tokens", "usage.prompt_tokens_details.cached_tokens"},
		CompletionTokens: []string{"usage.completion_tokens", "usage.output_tokens"},
	}
}

// ParseTokenUsageFields decodes a persisted JSON blob; an empty or invalid
// blob falls back to DefaultTokenUsageFields.
func ParseTokenUsageFields(raw string) TokenUsageFields {
	fields := DefaultTokenUsageFields()
	if strings.TrimSpace(raw) == "" {
		return fields
	}
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return DefaultTokenUsageFields()
	}
	return fields
}

// SerializeTokenUsageFields encodes the config for persistence.
func SerializeTokenUsageFields(fields TokenUsageFields) (string, error) {
	b, err := json.Marshal(fields)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ExtractTokenUsage reads the four token counters from a JSON response body
// using the configured gjson paths. Each counter tries its paths in order and
// stops at the first existing field. A counter with no matching path stays 0.
func ExtractTokenUsage(body []byte, fields TokenUsageFields) TokenUsage {
	return TokenUsage{
		PromptTokens:     firstHit(body, fields.PromptTokens),
		CacheWriteTokens: firstHit(body, fields.CacheWriteTokens),
		CacheReadTokens:  firstHit(body, fields.CacheReadTokens),
		CompletionTokens: firstHit(body, fields.CompletionTokens),
	}
}

func firstHit(body []byte, paths []string) int64 {
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if r := gjson.GetBytes(body, p); r.Exists() {
			return r.Int()
		}
	}
	return 0
}
