import { describe, expect, it } from 'vitest'
import type { ProviderModel } from './dashboard-api'
import { collectDeclaredEndpoints, normalizeEndpointPath, parseEndpointPaths, seedModelEndpointsFromProvider } from './provider-endpoints'

const row = (model: string, endpoints: readonly string[]): ProviderModel => ({ model, endpoints, rate: '2', ratePriceConfigId: null, referenceProvider: null, referencePrices: null, referenceAt: null, prices: null })

describe('normalizeEndpointPath 单条路径', () => {
  it('去空白并补开头的斜杠', () => {
    expect(normalizeEndpointPath('  /v1/models ')).toBe('/v1/models')
    expect(normalizeEndpointPath('v1/models')).toBe('/v1/models')
    expect(normalizeEndpointPath('   ')).toBe('')
  })
})

describe('parseEndpointPaths 输入拆分', () => {
  it('空格、逗号、分号都当作分隔符', () => {
    expect(parseEndpointPaths('/a /b,/c;/d')).toEqual(['/a', '/b', '/c', '/d'])
    expect(parseEndpointPaths('/images/generations,/images/edits')).toEqual(['/images/generations', '/images/edits'])
    expect(parseEndpointPaths('/a，/b；/c、/d')).toEqual(['/a', '/b', '/c', '/d'])
  })

  it('没写开头的斜杠自动补上', () => {
    expect(parseEndpointPaths('v1/chat/completions')).toEqual(['/v1/chat/completions'])
    expect(parseEndpointPaths(' /a, v1/responses ')).toEqual(['/a', '/v1/responses'])
  })

  it('去空、去重并保持输入顺序', () => {
    expect(parseEndpointPaths('  ')).toEqual([])
    expect(parseEndpointPaths('/b,,/a; /b')).toEqual(['/b', '/a'])
  })
})

describe('legacy endpoint migration', () => {
  it('copies all legacy endpoints onto empty models and preserves explicit choices', () => {
    const endpoints = [{ pathSuffix: '/v1/chat/completions' }, { pathSuffix: '/v1/responses' }]
    const models = [row('a', []), row('b', ['/v1/responses'])]
    const migrated = seedModelEndpointsFromProvider(endpoints, models)
    expect(migrated[0].endpoints).toEqual(['/v1/chat/completions', '/v1/responses'])
    expect(migrated[0].rate).toBe('2')
    expect(migrated[1].endpoints).toEqual(['/v1/responses'])
    expect(models[0].endpoints).toEqual([])
    expect(collectDeclaredEndpoints({ endpoints, models: migrated })).toEqual(['/v1/chat/completions', '/v1/responses'])
  })
})
