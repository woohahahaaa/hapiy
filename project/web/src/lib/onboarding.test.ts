import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_SKIPPED_SETTING_KEY,
  shouldShowOnboarding,
} from './onboarding'

describe('shouldShowOnboarding', () => {
  it('没有供应商且没跳过时显示', () => {
    expect(shouldShowOnboarding(0, [])).toBe(true)
    expect(shouldShowOnboarding(0, [{ key: 'ui_language', value: 'zh' }])).toBe(
      true
    )
  })

  it('已经配置了供应商就不显示', () => {
    expect(shouldShowOnboarding(1, [])).toBe(false)
    expect(
      shouldShowOnboarding(3, [
        { key: ONBOARDING_SKIPPED_SETTING_KEY, value: 'false' },
      ])
    ).toBe(false)
  })

  it('手动跳过之后不再显示', () => {
    expect(
      shouldShowOnboarding(0, [
        { key: ONBOARDING_SKIPPED_SETTING_KEY, value: 'true' },
      ])
    ).toBe(false)
  })

  it('跳过标记不是 true 时仍按供应商数量判断', () => {
    expect(
      shouldShowOnboarding(0, [
        { key: ONBOARDING_SKIPPED_SETTING_KEY, value: '' },
      ])
    ).toBe(true)
  })
})
