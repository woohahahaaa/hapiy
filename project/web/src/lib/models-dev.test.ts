import { describe, expect, it } from 'vitest'
import {
  findModelsDevModel,
  findModelsDevProviderRow,
  providersForModel,
  searchModelsDevModels,
  type ModelsDevModel,
} from './models-dev'

function makeModel(partial: Partial<ModelsDevModel> & { id: string }): ModelsDevModel {
  return {
    name: partial.name ?? partial.id,
    providerId: 'openai',
    providerName: 'OpenAI',
    inputPrice: 0,
    outputPrice: 0,
    cacheWritePrice: 0,
    cacheReadPrice: 0,
    contextLength: 0,
    maxOutput: 0,
    inputTypes: [],
    outputTypes: [],
    reasoning: false,
    ...partial,
  }
}

describe('searchModelsDevModels', () => {
  const models: readonly ModelsDevModel[] = [
    makeModel({ id: 'gpt-4o', providerName: 'OpenAI' }),
    makeModel({ id: 'gpt-4o-mini', providerName: 'OpenAI' }),
    makeModel({ id: 'deepseek-chat', providerName: 'DeepSeek' }),
    makeModel({ id: 'o3', name: 'o3', providerName: 'OpenAI' }),
  ]

  it('matches id prefix first, exact id first among prefixes', () => {
    const result = searchModelsDevModels(models, 'gpt-4o')
    expect(result.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('matches case-insensitively', () => {
    const result = searchModelsDevModels(models, 'DEEPSEEK-CHAT')
    expect(result.map((m) => m.id)).toEqual(['deepseek-chat'])
  })

  it('returns empty for blank query', () => {
    expect(searchModelsDevModels(models, '   ')).toEqual([])
    expect(searchModelsDevModels(models, '')).toEqual([])
  })

  it('respects the limit', () => {
    const result = searchModelsDevModels(models, 'gpt', 1)
    expect(result).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(searchModelsDevModels(models, 'claude')).toEqual([])
  })
})

describe('findModelsDevModel', () => {
  const models: readonly ModelsDevModel[] = [
    makeModel({ id: 'gpt-4o', providerName: 'OpenAI' }),
    makeModel({ id: 'deepseek-v3-flash', providerName: 'DeepSeek' }),
    makeModel({ id: 'other', name: 'DeepSeek V3 Flash', providerName: 'Alibaba' }),
  ]

  it('matches id case-insensitively and trims whitespace', () => {
    const found = findModelsDevModel(models, '  DEEPSEEK-V3-FLASH  ')
    expect(found?.id).toBe('deepseek-v3-flash')
  })

  it('matches name case-insensitively', () => {
    expect(findModelsDevModel(models, 'deepseek v3 flash')?.id).toBe('other')
  })

  it('matches an id published as provider/model by its bare trailing segment', () => {
    const qualified: readonly ModelsDevModel[] = [
      makeModel({ id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', providerName: 'DeepSeek' }),
      makeModel({ id: 'alibaba/deepseek-v4-flash', name: 'DeepSeek V4 Flash', providerName: 'Alibaba' }),
    ]
    const found = findModelsDevModel(qualified, 'deepseek-v4-flash')
    expect(found?.id).toBe('deepseek/deepseek-v4-flash')
  })

  it('prefers an exact bare id row over a qualified provider/model row', () => {
    const mixed: readonly ModelsDevModel[] = [
      makeModel({ id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', providerName: 'DeepSeek' }),
      makeModel({ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', providerName: 'Zhipu AI' }),
    ]
    const found = findModelsDevModel(mixed, 'deepseek-v4-flash')
    expect(found?.id).toBe('deepseek-v4-flash')
  })

  it('returns null for blank or unmatched values', () => {
    expect(findModelsDevModel(models, '   ')).toBeNull()
    expect(findModelsDevModel(models, 'claude')).toBeNull()
  })
})

describe('providersForModel', () => {
  const models: readonly ModelsDevModel[] = [
    makeModel({ id: 'deepseek-v3-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
    makeModel({ id: 'deepseek-v3-flash', providerName: 'Zhipu AI', providerId: 'zhipu' }),
    makeModel({ id: 'deepseek-v3-flash', providerName: 'Alibaba', providerId: 'alibaba' }),
    makeModel({ id: 'gpt-4o', providerName: 'OpenAI' }),
  ]

  it('returns distinct providers sorted by provider name', () => {
    const result = providersForModel(models, 'DEEPSEEK-V3-FLASH')
    expect(result).toEqual([
      { providerId: 'alibaba', providerName: 'Alibaba' },
      { providerId: 'deepseek', providerName: 'DeepSeek' },
      { providerId: 'zhipu', providerName: 'Zhipu AI' },
    ])
  })

  it('collects providers whose id is a qualified provider/model row', () => {
    const qualified: readonly ModelsDevModel[] = [
      makeModel({ id: 'deepseek/deepseek-v4-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
      makeModel({ id: 'alibaba/deepseek-v4-flash', providerName: 'Alibaba', providerId: 'alibaba' }),
      makeModel({ id: 'deepseek-v4-flash', providerName: 'Zhipu AI', providerId: 'zhipu' }),
      makeModel({ id: 'gpt-4o', providerName: 'OpenAI', providerId: 'openai' }),
    ]
    const result = providersForModel(qualified, 'deepseek-v4-flash')
    expect(result).toEqual([
      { providerId: 'alibaba', providerName: 'Alibaba' },
      { providerId: 'deepseek', providerName: 'DeepSeek' },
      { providerId: 'zhipu', providerName: 'Zhipu AI' },
    ])
  })

  it('dedupes rows of the same provider', () => {
    const duplicated = [
      ...models,
      makeModel({ id: 'deepseek-v3-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
    ]
    expect(providersForModel(duplicated, 'deepseek-v3-flash')).toHaveLength(3)
  })

  it('returns empty for blank or unmatched model values', () => {
    expect(providersForModel(models, 'gpt-5')).toEqual([])
    expect(providersForModel(models, '')).toEqual([])
  })
})

describe('findModelsDevProviderRow', () => {
  const models: readonly ModelsDevModel[] = [
    makeModel({ id: 'deepseek-v3-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
    makeModel({ id: 'deepseek-v3-flash', providerName: 'Zhipu AI', providerId: 'zhipu' }),
  ]

  it('finds the row for the requested provider', () => {
    const row = findModelsDevProviderRow(models, 'deepseek-v3-flash', 'zhipu')
    expect(row?.providerName).toBe('Zhipu AI')
  })

  it('finds a qualified provider/model row for the requested provider', () => {
    const qualified: readonly ModelsDevModel[] = [
      makeModel({ id: 'alibaba/deepseek-v4-flash', providerName: 'Alibaba', providerId: 'alibaba' }),
      makeModel({ id: 'deepseek/deepseek-v4-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
    ]
    const row = findModelsDevProviderRow(qualified, 'deepseek-v4-flash', 'deepseek')
    expect(row?.providerId).toBe('deepseek')
  })

  it('returns null when the provider is not present for the model', () => {
    expect(findModelsDevProviderRow(models, 'deepseek-v3-flash', 'openai')).toBeNull()
  })

  it('returns null for an unmatched model value', () => {
    expect(findModelsDevProviderRow(models, 'claude', 'deepseek')).toBeNull()
  })
})