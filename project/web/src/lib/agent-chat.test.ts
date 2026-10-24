import { describe, expect, it } from 'vitest'

import { pickDefaultModel } from './agent-chat'
import type { ChatModelOption } from './dashboard-api'

const models: readonly ChatModelOption[] = [
  {
    model: 'deepseek',
    providers: [
      { id: 'p1', name: 'One', autoDisabled: false, workflowEnabled: true, status: true, providerDisabled: false, disabledBaseURLs: 0, totalBaseURLs: 1, disabledKeys: 0, totalKeys: 1 },
      { id: 'p2', name: 'Two', autoDisabled: false, workflowEnabled: true, status: true, providerDisabled: false, disabledBaseURLs: 0, totalBaseURLs: 1, disabledKeys: 0, totalKeys: 1 },
    ],
  },
  { model: 'gpt', providers: [] },
]

describe('pickDefaultModel', () => {
  it('uses the remembered model and provider while both are available', () => {
    expect(pickDefaultModel(models, { model: 'deepseek', providerId: 'p2' })).toEqual({
      model: 'deepseek',
      providerId: 'p2',
    })
  })

  it('falls back to 自动 when the remembered provider is gone', () => {
    expect(pickDefaultModel(models, { model: 'deepseek', providerId: 'retired' })).toEqual({
      model: 'deepseek',
      providerId: '',
    })
  })

  it('uses the first available model when nothing is remembered', () => {
    expect(pickDefaultModel(models, { model: '', providerId: '' })).toEqual({
      model: 'deepseek',
      providerId: '',
    })
  })

  it('uses the first available model when the remembered one is gone', () => {
    expect(pickDefaultModel(models, { model: 'removed', providerId: 'p1' })).toEqual({
      model: 'deepseek',
      providerId: '',
    })
  })

  it('returns an empty choice when no model is available', () => {
    expect(pickDefaultModel([], { model: 'deepseek', providerId: 'p1' })).toEqual({
      model: '',
      providerId: '',
    })
  })
})
