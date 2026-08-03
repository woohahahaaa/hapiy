import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dashboardApi,
  parsePrice,
  serializePrice,
  type PriceConfig,
  type PriceConfigInput,
} from './dashboard-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function priceConfig(): PriceConfig {
  return {
    id: 'p-1',
    model: 'gpt-4o',
    inputPrice: 1,
    outputPrice: 2,
    cacheWritePrice: 0.5,
    cacheReadPrice: 0.1,
    contextLength: 128000,
    maxToken: 4096,
    supportedTypes: ['text', 'image'],
    aliases: ['gpt-4o-alias'],
    endpoints: ['openai', 'azure'],
    thinkingLevels: ['low', 'high'],
    rules: [{ pattern: 'gpt-*', multiplier: 1.5 }],
  }
}

describe('parsePrice', () => {
  it('parses the model-info fields', () => {
    const parsed = parsePrice({
      id: 'p-1',
      model: 'gpt-4o',
      input_price: 1,
      output_price: 2,
      cache_write_price: 0.5,
      cache_read_price: 0.1,
      context_length: 128000,
      max_token: 4096,
      supported_types: '["text","image"]',
      aliases: '["gpt-4o-alias"]',
      endpoints: '["openai","azure"]',
      thinking_levels: '["low","high"]',
      rules: '[{"pattern":"gpt-*","multiplier":1.5}]',
    })

    expect(parsed).toEqual(priceConfig())
  })

  it('falls back to 0 and [] when the model-info fields are missing', () => {
    const parsed = parsePrice({
      id: 'p-2',
      model: 'claude',
      input_price: 3,
      output_price: 15,
      cache_write_price: 3,
      cache_read_price: 1.5,
    })

    expect(parsed.contextLength).toBe(0)
    expect(parsed.maxToken).toBe(0)
    expect(parsed.supportedTypes).toEqual([])
    expect(parsed.aliases).toEqual([])
    expect(parsed.endpoints).toEqual([])
    expect(parsed.thinkingLevels).toEqual([])
    expect(parsed.rules).toEqual([])
  })

  it('parses list fields and rules when they arrive as arrays', () => {
    const parsed = parsePrice({
      id: 'p-3',
      model: 'deepseek-chat',
      input_price: 0,
      output_price: 0,
      cache_write_price: 0,
      cache_read_price: 0,
      max_token: 8192,
      supported_types: ['text'],
      aliases: ['ds-chat'],
      endpoints: ['deepseek'],
      thinking_levels: ['off'],
      rules: [{ pattern: 'deepseek-*', multiplier: 2 }],
    })

    expect(parsed.maxToken).toBe(8192)
    expect(parsed.supportedTypes).toEqual(['text'])
    expect(parsed.aliases).toEqual(['ds-chat'])
    expect(parsed.endpoints).toEqual(['deepseek'])
    expect(parsed.thinkingLevels).toEqual(['off'])
    expect(parsed.rules).toEqual([{ pattern: 'deepseek-*', multiplier: 2 }])
  })
})

describe('serializePrice', () => {
  it('serializes the model-info fields as snake_case with JSON-stringified lists', () => {
    const config = priceConfig()

    expect(serializePrice(config)).toEqual({
      model: 'gpt-4o',
      input_price: 1,
      output_price: 2,
      cache_write_price: 0.5,
      cache_read_price: 0.1,
      context_length: 128000,
      max_token: 4096,
      supported_types: JSON.stringify(['text', 'image']),
      aliases: JSON.stringify(['gpt-4o-alias']),
      endpoints: JSON.stringify(['openai', 'azure']),
      thinking_levels: JSON.stringify(['low', 'high']),
      rules: JSON.stringify([{ pattern: 'gpt-*', multiplier: 1.5 }]),
    })
  })

  it('roundtrips through parsePrice', () => {
    const input: PriceConfigInput = priceConfig()

    expect(parsePrice({ id: 'p-1', ...serializePrice(input) })).toEqual(priceConfig())
  })
})

describe('dashboardApi.fetchModelsFromEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns fetched models and falls name back to id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const models = await dashboardApi.fetchModelsFromEndpoint('https://api.openai.com/v1')

    expect(models).toEqual([
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/dashboard/providers/fetch-models',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://api.openai.com/v1' }),
      }),
    )
  })

  it('includes the key in the request body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await dashboardApi.fetchModelsFromEndpoint('https://api.openai.com/v1', 'sk-123')

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/dashboard/providers/fetch-models',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://api.openai.com/v1', key: 'sk-123' }),
      }),
    )
  })
})

describe('dashboardApi settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getSettings returns the setting list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ key: 'model_whitelist', value: 'gpt-4o' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const settings = await dashboardApi.getSettings()

    expect(settings).toEqual([{ key: 'model_whitelist', value: 'gpt-4o' }])
    expect(fetchMock).toHaveBeenCalledWith('/v1/dashboard/settings', expect.objectContaining({ credentials: 'include' }))
  })

  it('updateSetting PUTs the key/value pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { key: 'model_whitelist', value: 'gpt-4o' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const setting = await dashboardApi.updateSetting('model_whitelist', 'gpt-4o')

    expect(setting).toEqual({ key: 'model_whitelist', value: 'gpt-4o' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/dashboard/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ key: 'model_whitelist', value: 'gpt-4o' }),
      }),
    )
  })
})
