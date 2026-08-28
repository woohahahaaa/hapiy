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