import { describe, expect, it } from 'vitest'
import { computeRuleHits, priceRuleMatches, type RuleHitResult } from './model-rule'

describe('priceRuleMatches', () => {
  it('matches the provider name exactly', () => {
    expect(priceRuleMatches('openai', 'openai')).toBe(true)
    expect(priceRuleMatches('openai', 'OpenAI')).toBe(false)
  })

  it('matches the provider name as a regular expression', () => {
    expect(priceRuleMatches('openai', 'openai-a')).toBe(true)
    expect(priceRuleMatches('openai', 'my-openai')).toBe(true)
    expect(priceRuleMatches('^openai', 'openai-pro')).toBe(true)
  })

  it('returns false when the pattern does not match', () => {
    expect(priceRuleMatches('openai', 'anthropic')).toBe(false)
  })

  it('returns false for an invalid regex without throwing', () => {
    expect(() => priceRuleMatches('(', 'openai')).not.toThrow()
    expect(priceRuleMatches('(', 'openai')).toBe(false)
    expect(priceRuleMatches('[', 'anything')).toBe(false)
  })

  it('returns false for an empty pattern', () => {
    expect(priceRuleMatches('', 'openai')).toBe(false)
    expect(priceRuleMatches('', '')).toBe(false)
  })

  it('prefers the exact match over regex parsing', () => {
    expect(priceRuleMatches('(a', '(a')).toBe(true)
  })
})

describe('computeRuleHits', () => {
  const rules = [
    { pattern: 'a', multiplier: 1 },
    { pattern: 'b', multiplier: 1 },
  ] as const

  const providers = ['a1', 'a2', 'b1', 'ab'] as const

  it('counts all providers matching the first rule with nothing intercepted', () => {
    const result: RuleHitResult = computeRuleHits(rules, providers, 0)
    expect(result).toEqual({ n: 3, m: 0 })
  })

  it('counts matches of the second rule and those already claimed by rule 0', () => {
    const result: RuleHitResult = computeRuleHits(rules, providers, 1)
    expect(result).toEqual({ n: 2, m: 1 })
  })

  it('returns zeroes when the rule matches no provider', () => {
    const result: RuleHitResult = computeRuleHits(rules, ['x1', 'y2'], 0)
    expect(result).toEqual({ n: 0, m: 0 })
  })

  it('returns zeroes for an index without a rule', () => {
    const result: RuleHitResult = computeRuleHits(rules, providers, 2)
    expect(result).toEqual({ n: 0, m: 0 })
  })
})
