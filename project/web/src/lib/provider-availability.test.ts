import { describe, expect, it } from 'vitest'
import { computeProviderAvailability, formatAutoDisableSummary, fullyDisabledEntries } from './provider-availability'

describe('fullyDisabledEntries', () => {
  it('空映射不算禁用', () => {
    expect(fullyDisabledEntries({})).toBe(0)
  })

  it('部分禁用不算完全禁用', () => {
    expect(fullyDisabledEntries({ a: true, b: false })).toBe(0)
  })

  it('全部禁用返回条目数', () => {
    expect(fullyDisabledEntries({ a: true, b: true })).toBe(2)
  })
})

describe('computeProviderAvailability', () => {
  it('整体可用：没有任何维度完全禁用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': false },
      keysDisabled: { 'sk-a': false, 'sk-b': true },
    })
    expect(result).toEqual({ dimensions: [], counts: { provider: 0, base_url: 0, key: 0 }, overall: true })
  })

  it('provider 维度禁用 → 整体不可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: true,
      baseUrlsDisabled: { 'https://a.example.com': false },
      keysDisabled: {},
    })
    expect(result.dimensions).toEqual(['provider'])
    expect(result.counts.provider).toBe(1)
    expect(result.overall).toBe(false)
  })

  it('base URL 全部禁用 → 整体不可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': true, 'https://b.example.com': true },
      keysDisabled: {},
    })
    expect(result.dimensions).toEqual(['base_url'])
    expect(result.counts.base_url).toBe(2)
    expect(result.overall).toBe(false)
  })

  it('base URL 仅部分禁用 → 整体可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': true, 'https://b.example.com': false },
      keysDisabled: {},
    })
    expect(result.overall).toBe(true)
    expect(result.dimensions).toEqual([])
  })

  it('key 全部禁用 → 整体不可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true, 'sk-b': true, 'sk-c': true },
    })
    expect(result.dimensions).toEqual(['key'])
    expect(result.counts.key).toBe(3)
    expect(result.overall).toBe(false)
  })

  it('key 仅部分禁用 → 整体可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true, 'sk-b': false },
    })
    expect(result.overall).toBe(true)
    expect(result.dimensions).toEqual([])
  })

  it('禁用映射仅包含实际禁用的 key 时，使用配置数量判定部分禁用', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true },
      baseURLCount: 0,
      keyCount: 2,
    })
    expect(result.overall).toBe(true)
    expect(result.dimensions).toEqual([])
  })

  it('多维度同时完全禁用：provider + key 都列出且整体不可用', () => {
    const result = computeProviderAvailability({
      providerDisabled: true,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true },
    })
    expect(result.dimensions).toEqual(['provider', 'key'])
    expect(result.counts).toEqual({ provider: 1, base_url: 0, key: 1 })
    expect(result.overall).toBe(false)
  })

  it('provider 活跃 + 单个 key 组全部禁用 → 整体不可用（用户给出的例子）', () => {
    const result = computeProviderAvailability({
      providerDisabled: false,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true },
    })
    expect(result.overall).toBe(false)
    expect(result.dimensions).toEqual(['key'])
  })
})

describe('formatAutoDisableSummary', () => {
  it('供应商故障转移时只显示供应商 1/1', () => {
    expect(formatAutoDisableSummary({
      providerDisabled: true,
      baseUrlsDisabled: { 'https://a.example.com': true },
      keysDisabled: { 'sk-a': true },
      baseURLCount: 1,
      keyCount: 1,
    })).toBe('故障转移：供应商 1/1、base URL 1/1、key 1/1')
  })

  it('部分禁用时按 key、base URL 顺序显示分数', () => {
    expect(formatAutoDisableSummary({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': true, 'https://b.example.com': true },
      keysDisabled: { 'sk-a': true },
      baseURLCount: 3,
      keyCount: 2,
    })).toBe('故障转移：base URL 2/3、key 1/2')
  })

  it('全部 base URL 禁用时显示 base URL n/n', () => {
    expect(formatAutoDisableSummary({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': true, 'https://b.example.com': true },
      keysDisabled: {},
      baseURLCount: 2,
      keyCount: 0,
    })).toBe('故障转移：base URL 2/2')
  })

  it('全部 key 禁用时显示 key n/n', () => {
    expect(formatAutoDisableSummary({
      providerDisabled: false,
      baseUrlsDisabled: {},
      keysDisabled: { 'sk-a': true, 'sk-b': true },
      baseURLCount: 0,
      keyCount: 2,
    })).toBe('故障转移：key 2/2')
  })

  it('全量与部分禁用混合时按分数同时显示', () => {
    expect(formatAutoDisableSummary({
      providerDisabled: false,
      baseUrlsDisabled: { 'https://a.example.com': true, 'https://b.example.com': true },
      keysDisabled: { 'sk-a': true },
      baseURLCount: 2,
      keyCount: 3,
    })).toBe('故障转移：base URL 2/2、key 1/3')
  })
})
