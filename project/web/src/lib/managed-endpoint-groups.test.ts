import { describe, expect, it } from 'vitest'
import { deriveManagedEndpointGroups, groupKeyOf } from './managed-endpoint-groups'
import type { EndpointRuleMap, ManagedAgentGroup, ManagedProviderOption } from '@/lib/dashboard-api'

// Two rules, as the backend reports them: every endpoint of a rule shares
// the same canonical key, rule-less endpoints stay out of the map.
const rules: EndpointRuleMap = {
  '/chat/completions': { canonical: '/chat/completions', ruleIndex: 1, ruleName: 'completion', tag: '*completion*' },
  '/v1/chat/completions': { canonical: '/chat/completions', ruleIndex: 1, ruleName: 'completion', tag: '*completion*' },
  '/responses': { canonical: '/responses', ruleIndex: 0, ruleName: 'responses', tag: '*responses*' },
  '/v1/responses': { canonical: '/responses', ruleIndex: 0, ruleName: 'responses', tag: '*responses*' },
}

function option(overrides: Partial<ManagedProviderOption> & { id: string; name: string }): ManagedProviderOption {
  return {
    status: true,
    endpoints: [],
    models: [],
    model_endpoints: {},
    endpointCount: 0,
    modelCount: 0,
    ...overrides,
  }
}

describe('groupKeyOf', () => {
  it('uses the rule canonical so /v1 variants fold into one group', () => {
    expect(groupKeyOf('/v1/chat/completions', rules)).toBe('/chat/completions')
    expect(groupKeyOf('/v1/chat/completions', {})).toBe('/v1/chat/completions')
  })
})

describe('deriveManagedEndpointGroups', () => {
  it('folds every endpoint of one rule into a single group with its models', () => {
    const groups = deriveManagedEndpointGroups({
      options: [
        option({ id: 'a', name: 'A', endpoints: ['/chat/completions', '/v1/chat/completions'], models: ['chat'] }),
        option({ id: 'b', name: 'B', endpoints: ['/v1/chat/completions'], models: ['chat2'] }),
        option({ id: 'c', name: 'C', endpoints: ['/v1/embeddings'], models: ['embed'] }),
      ],
      checked: new Set(['a', 'b', 'c']),
      storedGroups: [],
      rules,
    })
    const completion = groups.find((g) => g.ruleTag === '*completion*')
    expect(completion).toBeDefined()
    expect(completion?.endpoint).toBe('/chat/completions')
    expect(completion?.ruleName).toBe('completion')
    expect(completion?.hits).toEqual(['/chat/completions', '/v1/chat/completions'])
    expect(completion?.modelNames).toEqual(['chat', 'chat2'])
    expect(completion?.providerNames).toEqual(['A', 'B'])
    // 没命中规则的 endpoint 独立成组，不带规则标签
    const embed = groups.find((g) => g.endpoint === '/v1/embeddings')
    expect(embed?.ruleTag).toBeNull()
    expect(embed?.ruleIndex).toBe(-1)
  })

  it('keeps a stored pre-fold endpoint and suffix instead of renaming the provider block', () => {
    const stored: readonly ManagedAgentGroup[] = [
      { endpoint: '/v1/chat/completions', suffix: '_c', model_sources: {} },
    ]
    const groups = deriveManagedEndpointGroups({
      options: [
        option({ id: 'a', name: 'A', endpoints: ['/chat/completions', '/v1/chat/completions'], models: ['chat'] }),
      ],
      checked: new Set(['a']),
      storedGroups: stored,
      rules,
    })
    expect(groups).toHaveLength(1)
    // endpoint 保持存下来的那个：弹窗按 endpoint 回填 suffix，
    // 也把 endpoint 原样提交回去（改名会删掉配置文件里的旧块）
    expect(groups[0].endpoint).toBe('/v1/chat/completions')
    expect(groups[0].ruleTag).toBe('*completion*')
    expect(groups[0].hits).toEqual(['/chat/completions', '/v1/chat/completions'])
  })

  it('lists a same-rule group with a different suffix as its own group, and drops the same-suffix twin', () => {
    const groups = deriveManagedEndpointGroups({
      options: [
        option({ id: 'a', name: 'A', endpoints: ['/chat/completions', '/v1/chat/completions'], models: ['chat'] }),
      ],
      checked: new Set(['a']),
      storedGroups: [
        { endpoint: '/chat/completions', suffix: '_c', model_sources: {} },
        { endpoint: '/v1/chat/completions', suffix: '_c', model_sources: {} },
        { endpoint: '/v1/chat/completions', suffix: '_c2', model_sources: {} },
      ],
      rules,
    })
    expect(groups.map((g) => [g.endpoint, g.modelNames.length])).toEqual([
      ['/chat/completions', 1],
      ['/v1/chat/completions', 1],
    ])
  })

  it('reports providers without endpoints as the 未配置 endpoint group', () => {
    const groups = deriveManagedEndpointGroups({
      options: [
        option({ id: 'a', name: 'A', endpoints: [], models: ['chat'] }),
        option({ id: 'b', name: 'B', endpoints: ['/v1/responses'], models: ['r'], status: false }),
      ],
      checked: new Set(['a', 'b']),
      storedGroups: [],
      rules,
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].endpoint).toBe('__none__')
    expect(groups[0].modelNames).toEqual(['chat'])
    expect(groups[0].noEndpointProviderIds).toEqual(['a'])
  })

  it('routes a model that declares its own endpoints only into matching groups', () => {
    const groups = deriveManagedEndpointGroups({
      options: [
        option({
          id: 'a',
          name: 'A',
          endpoints: ['/v1/chat/completions', '/v1/responses'],
          models: ['chat', 'resp'],
          model_endpoints: { chat: ['/v1/chat/completions'], resp: ['/v1/responses'] },
        }),
      ],
      checked: new Set(['a']),
      storedGroups: [],
      rules,
    })
    expect(groups.find((g) => g.ruleTag === '*completion*')?.modelNames).toEqual(['chat'])
    expect(groups.find((g) => g.ruleTag === '*responses*')?.modelNames).toEqual(['resp'])
  })
})
