import { describe, expect, it } from 'vitest'
import { compareTitle } from './title-sort'

const sorted = (names: readonly string[]): string[] => [...names].sort(compareTitle)

describe('compareTitle', () => {
  it('interleaves english and pinyin', () => {
    // Same expectations as internal/handler/name_sort_test.go.
    expect(sorted(['银河gpt-R', '多元探索', 'opencode go', 'deepseek'])).toEqual([
      'deepseek',
      '多元探索',
      'opencode go',
      '银河gpt-R',
    ])
  })

  it('orders Han names by pinyin', () => {
    expect(sorted(['张三', '李四', '王五', '陈六'])).toEqual(['陈六', '李四', '王五', '张三'])
  })

  it('orders latin names case-insensitively', () => {
    expect(sorted(['opencode-v2', 'Openclaw', 'opencode-v1', 'ChatGPT'])).toEqual([
      'ChatGPT',
      'Openclaw',
      'opencode-v1',
      'opencode-v2',
    ])
  })

  it('puts english before chinese on an equal key', () => {
    expect(sorted(['开', 'kai'])).toEqual(['kai', '开'])
  })
})
