import { describe, expect, it } from 'vitest'
import { joinModelListUrl, pickFetchModelKey } from './provider-fetch'

describe('joinModelListUrl', () => {
  it('dedupes /v1 when the base URL already ends with /v1', () => {
    expect(joinModelListUrl('https://opencode.ai/zen/go/v1', '/v1/models', true))
      .toBe('https://opencode.ai/zen/go/v1/models')
    expect(joinModelListUrl('https://api.openai.com/v1/', '/v1/models', true))
      .toBe('https://api.openai.com/v1/models')
  })

  it('keeps the verbatim join when dedupe is off', () => {
    expect(joinModelListUrl('https://opencode.ai/zen/go/v1', '/v1/models', false))
      .toBe('https://opencode.ai/zen/go/v1/v1/models')
  })

  it('does not change a bare-domain base URL', () => {
    expect(joinModelListUrl('https://api.openai.com', '/v1/models', true))
      .toBe('https://api.openai.com/v1/models')
  })

  it('only understands /v1, not other version prefixes', () => {
    expect(joinModelListUrl('https://open.bigmodel.cn/api/paas/v4', '/v1/models', true))
      .toBe('https://open.bigmodel.cn/api/paas/v4/v1/models')
  })

  it('preserves the base query string', () => {
    expect(joinModelListUrl('https://h/v1?tenant=a', '/v1/models', true))
      .toBe('https://h/v1/models?tenant=a')
  })

  it('leaves malformed base URLs on the verbatim path', () => {
    expect(joinModelListUrl('api.example.com/v1', '/v1/models', true))
      .toBe('api.example.com/v1/v1/models')
  })
})

describe('pickFetchModelKey', () => {
  it('skips disabled keys and trims whitespace', () => {
    expect(pickFetchModelKey([' k1 ', 'k2', 'k3'], { k1: true, k2: true })).toBe('k3')
  })

  it('falls back to the first non-empty key when all are disabled', () => {
    expect(pickFetchModelKey(['', 'k1', 'k2'], { k1: true, k2: true })).toBe('k1')
  })

  it('returns undefined when there are no keys', () => {
    expect(pickFetchModelKey(['', '  '], {})).toBeUndefined()
  })
})
