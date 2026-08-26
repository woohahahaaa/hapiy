import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LogOutputSlotEntry } from '@/components/node/slot/items'
import { createDebouncedCommit, shouldNotifyOnDisable } from './debounce'
import { NodeExecutorLogOutputItem, PREFIX_DEBOUNCE_MS } from './log-output'

function makeEntry(overrides: Partial<LogOutputSlotEntry> = {}): LogOutputSlotEntry {
  return {
    id: 'log-1',
    slotType: 'logOutput',
    index: 1,
    enabled: true,
    prefix: 'pfix',
    recordRequest: true,
    recordResponse: false,
    config: {},
    ...overrides,
  }
}

describe('NodeExecutorLogOutputItem', () => {
  it('renders the prefix input with the entry prefix as its value', () => {
    const html = renderToStaticMarkup(
      <NodeExecutorLogOutputItem
        entry={makeEntry()}
        onChange={() => {}}
        onDelete={() => {}}
        onAutoClose={() => {}}
      />,
    )
    expect(html).toContain('value="pfix"')
    expect(html).toContain('日志前缀')
  })

  it('commits a typed prefix after the debounce timer, no blur required', () => {
    vi.useFakeTimers()
    const entry = makeEntry()
    const onChange = vi.fn()
    const debounce = createDebouncedCommit<string>(PREFIX_DEBOUNCE_MS, (prefix) => {
      if (prefix === entry.prefix) return
      onChange({ ...entry, prefix })
    })

    debounce.schedule('hapiy>')
    vi.advanceTimersByTime(PREFIX_DEBOUNCE_MS - 1)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'hapiy>' }))
  })

  it('does not commit a prefix identical to the current entry prefix', () => {
    vi.useFakeTimers()
    const entry = makeEntry()
    const onChange = vi.fn()
    const debounce = createDebouncedCommit<string>(PREFIX_DEBOUNCE_MS, (prefix) => {
      if (prefix === entry.prefix) return
      onChange({ ...entry, prefix })
    })

    debounce.schedule(entry.prefix)
    debounce.dispose()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('onAutoClose wiring', () => {
  afterEach(() => vi.useRealTimers())

  it('does not fire on mount when the entry starts disabled', () => {
    expect(shouldNotifyOnDisable(null, false)).toBe(false)
  })

  it('fires exactly once per true→false transition', () => {
    const transitions: Array<[boolean | null, boolean]> = [
      [null, false], // mount disabled — must not fire
      [false, false], // still disabled — must not fire
      [false, true], // enabled — must not fire
      [true, true], // stays enabled — must not fire
      [true, false], // transition — fires
    ]
    const fired = transitions.filter(([prev, curr]) => shouldNotifyOnDisable(prev, curr))
    expect(fired).toEqual([[true, false]])
  })
})