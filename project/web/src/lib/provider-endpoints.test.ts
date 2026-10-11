import { describe, expect, it } from 'vitest'
import type { ProviderModel } from './dashboard-api'
import { collectDeclaredEndpoints, seedModelEndpointsFromProvider } from './provider-endpoints'

const row = (model: string, endpoints: readonly string[]): ProviderModel => ({ model, endpoints, rate: '2', ratePriceConfigId: null, referenceProvider: null, referencePrices: null, referenceAt: null, prices: null })

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
