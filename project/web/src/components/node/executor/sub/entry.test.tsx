import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedCommit } from './debounce'
import { clampWeight, WEIGHT_DEBOUNCE_MS } from './weight'

describe('clampWeight', () => {
  it('keeps values already within [0, 1]', () => {
    expect(clampWeight('0')).toBe(0)
    expect(clampWeight('0.5')).toBe(0.5)
    expect(clampWeight('1')).toBe(1)
  })

  it('clamps values outside [0, 1]', () => {
    expect(clampWeight('1.5')).toBe(1)
    expect(clampWeight('-0.2')).toBe(0)
  })

  it('rounds to two decimals', () => {
    expect(clampWeight('0.3333')).toBe(0.33)
    expect(clampWeight('0.9999')).toBe(1)
  })

  it('returns null for non-numeric input', () => {
    expect(clampWeight('abc')).toBeNull()
    expect(clampWeight('')).not.toBeNull()
  })
})

describe('weight debounce commit', () => {
  afterEach(() => vi.useRealTimers())

  it('calls onChangeWeight exactly once with the clamped value after the timer', () => {
    vi.useFakeTimers()
    const onChangeWeight = vi.fn()
    const debounce = createDebouncedCommit<number>(WEIGHT_DEBOUNCE_MS, onChangeWeight)

    debounce.schedule(clampWeight('0.3')!)
    vi.advanceTimersByTime(200)
    debounce.schedule(clampWeight('0.723')!)
    expect(onChangeWeight).not.toHaveBeenCalled()
    vi.advanceTimersByTime(WEIGHT_DEBOUNCE_MS)
    expect(onChangeWeight).toHaveBeenCalledTimes(1)
    expect(onChangeWeight).toHaveBeenCalledWith(0.72)
  })

  it('flush on blur commits the pending weight immediately', () => {
    vi.useFakeTimers()
    const onChangeWeight = vi.fn()
    const debounce = createDebouncedCommit<number>(WEIGHT_DEBOUNCE_MS, onChangeWeight)

    debounce.schedule(clampWeight('0.6')!)
    debounce.flush()
    expect(onChangeWeight).toHaveBeenCalledTimes(1)
    expect(onChangeWeight).toHaveBeenCalledWith(0.6)
  })
})