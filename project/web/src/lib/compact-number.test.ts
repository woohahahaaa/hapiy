import { describe, expect, it } from 'vitest'
import { formatCompactNumber } from './compact-number'

describe('formatCompactNumber', () => {
  it('uses latin magnitude units in english', () => {
    expect(formatCompactNumber(999, 'en-US')).toBe('999')
    expect(formatCompactNumber(1_500, 'en-US')).toBe('1.5K')
    expect(formatCompactNumber(1_234_567, 'en-US')).toBe('1.2M')
    expect(formatCompactNumber(12_141_723_903, 'en-US')).toBe('12.1B')
  })

  it('uses chinese magnitude units in chinese', () => {
    expect(formatCompactNumber(999, 'zh-CN')).toBe('999')
    expect(formatCompactNumber(1_234_567, 'zh-CN')).toBe('123.5万')
    expect(formatCompactNumber(121_417_239, 'zh-CN')).toBe('1.2亿')
    expect(formatCompactNumber(12_141_723_903, 'zh-CN')).toBe('121.4亿')
  })
})
