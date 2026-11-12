import { describe, expect, it } from 'vitest'

import type { Provider } from '@/lib/dashboard-api'
import { providerCopyInput, providerCopyName } from '@/lib/provider-copy'

describe('providerCopyName 复制命名', () => {
  it('默认在原名称后加副本后缀', () => {
    expect(providerCopyName('OpenAI', '副本', ['OpenAI'])).toBe('OpenAI 副本')
  })

  it('重名时依次追加序号', () => {
    expect(providerCopyName('OpenAI', '副本', ['OpenAI', 'OpenAI 副本'])).toBe('OpenAI 副本 2')
    expect(providerCopyName('OpenAI', '副本', ['OpenAI 副本', 'OpenAI 副本 2'])).toBe('OpenAI 副本 3')
  })
})

describe('providerCopyInput 复制载荷', () => {
  const source: Provider = {
    id: 'p1',
    name: 'OpenAI',
    baseUrls: ['https://api.example.com/v1'],
    keys: ['sk-1'],
    keyNotes: { 'sk-1': '主账号' },
    endpoints: [{ pathSuffix: '/v1/chat/completions' }],
    models: [{ model: 'm1', endpoints: [], rate: '2', ratePriceConfigId: null, referenceProvider: 'lab', referencePrices: null, referenceAt: null, prices: null }],
    status: false,
    autoDisabled: true,
    workflowEnabled: true,
    dedupeV1Suffix: false,
    keyStrategy: 'sequential',
    baseUrlStrategy: 'balanced',
  }

  it('复制全部配置，自动禁用状态从干净开始', () => {
    const input = providerCopyInput(source, 'OpenAI 副本')
    expect(input.name).toBe('OpenAI 副本')
    expect(input.baseUrls).toEqual(source.baseUrls)
    expect(input.keys).toEqual(source.keys)
    expect(input.keyNotes).toEqual(source.keyNotes)
    expect(input.endpoints).toEqual(source.endpoints)
    expect(input.models).toEqual(source.models)
    expect(input.status).toBe(false)
    expect(input.workflowEnabled).toBe(true)
    expect(input.dedupeV1Suffix).toBe(false)
    expect(input.keyStrategy).toBe('sequential')
    expect(input.baseUrlStrategy).toBe('balanced')
    expect(input.autoDisabled).toBe(false)
  })
})
