import { describe, expect, it } from 'vitest'

import { pickDefaultModel } from './agent-chat'
import type { ChatModelOption } from './dashboard-api'

function provider(id: string, autoDisabled: boolean): ChatModelOption['providers'][number] {
  return {
    id,
    name: id,
    autoDisabled,
    workflowEnabled: true,
    status: true,
    providerDisabled: autoDisabled,
    disabledBaseURLs: 0,
    totalBaseURLs: 1,
    disabledKeys: 0,
    totalKeys: 1,
  }
}

const models: readonly ChatModelOption[] = [
  { model: 'deepseek', providers: [provider('p1', false)] },
  { model: 'gpt', providers: [provider('p2', true)] },
  { model: 'kimi', providers: [provider('p3', false)] },
]

describe('pickDefaultModel', () => {
  it('picks the most used model that still has a usable channel', () => {
    expect(
      pickDefaultModel(models, [
        { model: 'gpt', count: 9 },
        { model: 'kimi', count: 4 },
        { model: 'deepseek', count: 2 },
      ]),
    ).toEqual({ model: 'kimi', providerId: '' })
  })

  it('skips usage rows for models no longer offered', () => {
    expect(
      pickDefaultModel(models, [
        { model: 'removed', count: 20 },
        { model: 'deepseek', count: 1 },
      ]),
    ).toEqual({ model: 'deepseek', providerId: '' })
  })

  it('falls back to the first usable model when there is no usage', () => {
    expect(pickDefaultModel(models, [])).toEqual({ model: 'deepseek', providerId: '' })
  })

  it('keeps the first model when every channel is disabled', () => {
    const allDisabled: readonly ChatModelOption[] = [
      { model: 'gpt', providers: [provider('p2', true)] },
      { model: 'kimi', providers: [provider('p3', true)] },
    ]
    expect(pickDefaultModel(allDisabled, [{ model: 'gpt', count: 3 }])).toEqual({
      model: 'gpt',
      providerId: '',
    })
  })

  it('returns an empty choice when no model is available', () => {
    expect(pickDefaultModel([], [{ model: 'deepseek', count: 1 }])).toEqual({
      model: '',
      providerId: '',
    })
  })
})
