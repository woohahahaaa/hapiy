import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedCommit, shouldNotifyOnDisable } from './debounce'

describe('createDebouncedCommit', () => {
  afterEach(() => vi.useRealTimers())

  it('commits the scheduled value after the delay, no explicit flush needed', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.schedule('user typed')
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(399)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('user typed')
  })

  it('resets the timer on every schedule so only the last value commits', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.schedule('a')
    vi.advanceTimersByTime(200)
    d.schedule('b')
    vi.advanceTimersByTime(200)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('b')
  })

  it('flush commits the pending value immediately and cancels the timer', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.schedule('v')
    d.flush()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('v')
    vi.advanceTimersByTime(1000)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing pending does not call commit', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.flush()
    expect(commit).not.toHaveBeenCalled()
  })

  it('dispose (unmount) flushes pending so typed-but-unblurred input is not lost', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.schedule('typed then unmounted')
    d.dispose()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('typed then unmounted')
    vi.advanceTimersByTime(1000)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('dispose with nothing pending does not call commit', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const d = createDebouncedCommit(400, commit)

    d.dispose()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('shouldNotifyOnDisable', () => {
  it('never notifies on mount, even when the item starts disabled', () => {
    expect(shouldNotifyOnDisable(null, false)).toBe(false)
    expect(shouldNotifyOnDisable(null, true)).toBe(false)
  })

  it('notifies only on the true→false transition', () => {
    const transitions: Array<[boolean | null, boolean]> = [
      [null, true], // mount enabled
      [true, true], // stays enabled
      [true, false], // transition
      [false, false], // stays disabled
      [false, false], // still disabled
      [false, true], // re-enabled
      [true, false], // transition again
    ]
    const fired = transitions.filter(([prev, curr]) => shouldNotifyOnDisable(prev, curr))
    expect(fired).toEqual([[true, false], [true, false]])
  })

  it('does not notify for non-transition states', () => {
    expect(shouldNotifyOnDisable(false, false)).toBe(false)
    expect(shouldNotifyOnDisable(false, true)).toBe(false)
    expect(shouldNotifyOnDisable(true, true)).toBe(false)
  })
})