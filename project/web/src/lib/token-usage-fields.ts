// Token usage field configuration shared between the settings dialog and the
// backend contract (settings key "token_usage_fields").
export type TokenUsageFields = {
  readonly prompt_tokens: readonly string[]
  readonly cache_write_tokens: readonly string[]
  readonly cache_read_tokens: readonly string[]
  readonly completion_tokens: readonly string[]
}

// Preset common upstream conventions (OpenAI, Anthropic, compatible gateways).
// Mirrors the backend default; paths are tried in order, first hit wins.
export const DEFAULT_TOKEN_USAGE_FIELDS: TokenUsageFields = {
  prompt_tokens: ['usage.prompt_tokens', 'usage.input_tokens'],
  cache_write_tokens: ['usage.prompt_cache_miss_tokens', 'usage.cache_creation_input_tokens'],
  cache_read_tokens: [
    'usage.prompt_cache_hit_tokens',
    'usage.cache_read_input_tokens',
    'usage.prompt_tokens_details.cached_tokens',
  ],
  completion_tokens: ['usage.completion_tokens', 'usage.output_tokens'],
}

export function parseTokenUsageFields(raw: string): TokenUsageFields {
  if (!raw) return DEFAULT_TOKEN_USAGE_FIELDS
  try {
    const parsed = JSON.parse(raw) as Partial<TokenUsageFields>
    return {
      prompt_tokens: Array.isArray(parsed.prompt_tokens) ? parsed.prompt_tokens : DEFAULT_TOKEN_USAGE_FIELDS.prompt_tokens,
      cache_write_tokens: Array.isArray(parsed.cache_write_tokens) ? parsed.cache_write_tokens : DEFAULT_TOKEN_USAGE_FIELDS.cache_write_tokens,
      cache_read_tokens: Array.isArray(parsed.cache_read_tokens) ? parsed.cache_read_tokens : DEFAULT_TOKEN_USAGE_FIELDS.cache_read_tokens,
      completion_tokens: Array.isArray(parsed.completion_tokens) ? parsed.completion_tokens : DEFAULT_TOKEN_USAGE_FIELDS.completion_tokens,
    }
  } catch {
    return DEFAULT_TOKEN_USAGE_FIELDS
  }
}
