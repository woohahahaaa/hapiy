import { useSyncExternalStore } from 'react'
import { dashboardApi, type ConcurrencyWindowActive } from '@/lib/dashboard-api'

// 并发窗口占用的共享轮询 store：所有并发卡订阅同一份数据，由首个订阅者
// 启动一个全局 1.5s 轮询，最后一个退订后停止。后端行只在工作流运行时存在，
// 所以正常展示的是"当前窗口内活跃条数"。数据无变化时不通知，避免空转重渲染。

const POLL_INTERVAL_MS = 1500

type Snapshot = ReadonlyMap<string, ConcurrencyWindowActive>

let cache: Snapshot = new Map()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let polling = false

function notify() {
  for (const listener of listeners) listener()
}

function sameSnapshot(next: Snapshot): boolean {
  if (next.size !== cache.size) return false
  for (const [nodeId, row] of next) {
    const current = cache.get(nodeId)
    if (!current || current.windowCount !== row.windowCount || current.maxCount !== row.maxCount) return false
  }
  return true
}

async function refresh() {
  if (polling) return
  polling = true
  try {
    const rows = await dashboardApi.listConcurrencyWindows()
    const next: Snapshot = new Map()
    for (const row of rows) next.set(row.nodeId, row)
    if (!sameSnapshot(next)) {
      cache = next
      notify()
    }
  } catch {
    // 后端不可达时保持上一次快照，避免闪屏
  } finally {
    polling = false
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === null) {
    void refresh()
    timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): Snapshot {
  return cache
}

export function useConcurrencyWindows(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useConcurrencyWindowCount(nodeId: string | undefined): ConcurrencyWindowActive | undefined {
  const snapshot = useConcurrencyWindows()
  return nodeId ? snapshot.get(nodeId) : undefined
}