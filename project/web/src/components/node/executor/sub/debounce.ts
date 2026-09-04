/**
 * Shared debounce + transition helpers for the executor sub components.
 *
 * `createDebouncedCommit` coalesces rapid `schedule` calls into a single
 * `commit` after a quiet period, and can be flushed explicitly (on blur) or
 * disposed (on unmount) to avoid losing typed-but-uncommitted input.
 */

export interface DebouncedCommit<T> {
  /** (Re)arm the timer with a new value; resets any pending timer. */
  schedule: (value: T) => void
  /** Commit the pending value immediately (if any) and cancel the timer. */
  flush: () => void
  /** Cancel the timer and commit the pending value (if any) — unmount flush. */
  dispose: () => void
}

export function createDebouncedCommit<T>(
  delayMs: number,
  commit: (value: T) => void,
): DebouncedCommit<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | undefined
  let hasPending = false

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const commitPending = () => {
    if (!hasPending) return
    hasPending = false
    const value = pending as T
    pending = undefined
    commit(value)
  }

  return {
    schedule(value) {
      pending = value
      hasPending = true
      clearTimer()
      timer = setTimeout(commitPending, delayMs)
    },
    flush() {
      clearTimer()
      commitPending()
    },
    dispose() {
      clearTimer()
      commitPending()
    },
  }
}

/**
 * True only on an enabled `true -> false` edge. `prevEnabled === null` marks
 * the first render, so a component mounting already-disabled never fires.
 */
export function shouldNotifyOnDisable(
  prevEnabled: boolean | null,
  currEnabled: boolean,
): boolean {
  return prevEnabled === true && currEnabled === false
}