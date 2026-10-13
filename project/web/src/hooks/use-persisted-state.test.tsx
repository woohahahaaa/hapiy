import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  readPersistedValue,
  usePersistedState,
  writePersistedValue,
} from './use-persisted-state'

// 测试跑在 Node 环境里（没有 DOM）：给 localStorage 一个内存实现，
// 验证读写与恢复逻辑本身。
const memoryStore = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStore.set(key, String(value)),
    removeItem: (key: string) => void memoryStore.delete(key),
    clear: () => memoryStore.clear(),
  },
})

function Probe() {
  const [value] = usePersistedState('probe', 'fallback')
  return <span>{value}</span>
}

describe('usePersistedState', () => {
  beforeEach(() => {
    memoryStore.clear()
  })

  it('没有缓存时用默认值', () => {
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('fallback')
  })

  it('挂载时恢复缓存值（简单刷新不丢失）', () => {
    writePersistedValue('probe', 'saved')
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('saved')
  })

  it('缓存损坏时退回默认值', () => {
    localStorage.setItem('hapiy_filter:probe', '{not json')
    expect(readPersistedValue('probe', 'fallback')).toBe('fallback')
    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('fallback')
  })

  it('对象等结构原样往返', () => {
    writePersistedValue('range', { from: '2026-10-01', to: '2026-10-13' })
    expect(readPersistedValue('range', {})).toEqual({ from: '2026-10-01', to: '2026-10-13' })
  })
})
