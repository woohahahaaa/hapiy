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
    effortLevels: [],
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

  it('matches after stripping hyphens/spaces (GLM5.3 ↔ glm-5.3)', () => {
    const g = [
      makeModel({ id: 'glm-5.3', name: 'GLM-5.3', providerName: 'Zhipu AI', providerId: 'zhipuai' }),
      makeModel({ id: 'zai/glm-5.3', name: 'GLM-5.3', providerName: 'Z.AI', providerId: 'zai' }),
      makeModel({ id: 'kimi-k3', name: 'Kimi K3', providerName: 'Moonshot AI', providerId: 'moonshotai' }),
    ]
    // 同分时按 providerName 字母序（'.' < 'h'），所以 Z.AI 在前。
    const result = searchModelsDevModels(g, 'GLM5.3')
    expect(result.map((m) => m.id)).toEqual(['zai/glm-5.3', 'glm-5.3'])
    const kimi = searchModelsDevModels(g, 'KimiK3')
    expect(kimi.map((m) => m.id)).toEqual(['kimi-k3'])
  })

  it('respects the limit', () => {
    const result = searchModelsDevModels(models, 'gpt', 1)
    expect(result).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(searchModelsDevModels(models, 'claude')).toEqual([])
  })

  it('sorts same-tier results by provider name', () => {
    const sameId = [
      makeModel({ id: 'gpt-4o', providerName: 'Zhipu AI', providerId: 'zhipu' }),
      makeModel({ id: 'gpt-4o', providerName: 'Alibaba', providerId: 'alibaba' }),
      makeModel({ id: 'gpt-4o', providerName: 'DeepSeek', providerId: 'deepseek' }),
    ]
    const result = searchModelsDevModels(sameId, 'gpt-4o')
    expect(result.map((m) => m.providerName)).toEqual(['Alibaba', 'DeepSeek', 'Zhipu AI'])
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

  it('matches after stripping hyphens/spaces', () => {
    expect(findModelsDevModel(models, 'deepseekv3flash')?.id).toBe('deepseek-v3-flash')
    expect(findModelsDevModel(models, 'DeepSeekV3Flash')?.id).toBe('deepseek-v3-flash')
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

  it('returns distinct providers, official (lab) provider first then by name', () => {
    const result = providersForModel(models, 'DEEPSEEK-V3-FLASH')
    expect(result).toEqual([
      { providerId: 'deepseek', providerName: 'DeepSeek' },
      { providerId: 'alibaba', providerName: 'Alibaba' },
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
      { providerId: 'deepseek', providerName: 'DeepSeek' },
      { providerId: 'alibaba', providerName: 'Alibaba' },
      { providerId: 'zhipu', providerName: 'Zhipu AI' },
    ])
  })

  it('finds providers when the model value strips hyphens/spaces (GLM5.3 ↔ glm-5.3)', () => {
    const g: readonly ModelsDevModel[] = [
      makeModel({ id: 'glm-5.3', name: 'GLM-5.3', providerName: 'Zhipu AI', providerId: 'zhipuai' }),
      makeModel({ id: 'glm-5.3', name: 'GLM-5.3', providerName: 'Deep Infra', providerId: 'deepinfra' }),
      makeModel({ id: 'kimi-k3', name: 'Kimi K3', providerName: 'Moonshot AI', providerId: 'moonshotai' }),
    ]
    // 官方（zhipuai）排最前，其余按供应商名排序。
    const glm = providersForModel(g, 'GLM5.3')
    expect(glm).toEqual([
      { providerId: 'zhipuai', providerName: 'Zhipu AI' },
      { providerId: 'deepinfra', providerName: 'Deep Infra' },
    ])
    const kimi = providersForModel(g, 'KimiK3')
    expect(kimi).toEqual([{ providerId: 'moonshotai', providerName: 'Moonshot AI' }])
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
    const row = findModelsDevProviderRow(models, 'deepseek-v3-flash', 'Zhipu AI')
    expect(row?.providerName).toBe('Zhipu AI')
  })

  it('finds a qualified provider/model row for the requested provider', () => {
    const qualified: readonly ModelsDevModel[] = [
      makeModel({ id: 'alibaba/deepseek-v4-flash', providerName: 'Alibaba', providerId: 'alibaba' }),
      makeModel({ id: 'deepseek/deepseek-v4-flash', providerName: 'DeepSeek', providerId: 'deepseek' }),
    ]
    const row = findModelsDevProviderRow(qualified, 'deepseek-v4-flash', 'DeepSeek')
    expect(row?.providerId).toBe('deepseek')
  })

  it('returns null when the provider is not present for the model', () => {
    expect(findModelsDevProviderRow(models, 'deepseek-v3-flash', 'OpenAI')).toBeNull()
  })

  it('finds the row when the model value strips hyphens/spaces', () => {
    const row = findModelsDevProviderRow(models, 'deepseekv3flash', 'Zhipu AI')
    expect(row?.providerName).toBe('Zhipu AI')
  })

  it('matches a provider_id the same way as its provider_name (moonshotai ↔ Moonshot AI)', () => {
    const kimi: readonly ModelsDevModel[] = [
      makeModel({ id: 'kimi-k3', name: 'Kimi K3', providerName: 'Moonshot AI', providerId: 'moonshotai' }),
      makeModel({ id: 'kimi-k3', name: 'Kimi K3', providerName: 'SiliconFlow', providerId: 'siliconflow' }),
    ]
    // 手动选择存的是 providerName；lab 推断返回的是 provider_id，两者都要能命中。
    expect(findModelsDevProviderRow(kimi, 'kimi-k3', 'Moonshot AI')?.providerId).toBe('moonshotai')
    expect(findModelsDevProviderRow(kimi, 'KimiK3', 'moonshotai')?.providerId).toBe('moonshotai')
  })

  it('returns null for an unmatched model value', () => {
    expect(findModelsDevProviderRow(models, 'claude', 'DeepSeek')).toBeNull()
  })
})