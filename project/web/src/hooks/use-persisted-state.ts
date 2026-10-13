import * as React from "react"

// 顶部筛选 / 分页状态只在「浏览器刷新（F5）」时保留：
//   1）值缓存在 sessionStorage（仅当前标签页，不跨标签、不跨会话）；
//   2）组件卸载（从菜单切走、返回上一页）时立即清掉缓存，
//      所以从别处再进来是干净的默认值，而不是上次离开时的旧条件。
//
// Filter and pagination state survives a plain browser refresh only: values
// live in sessionStorage for the current tab and are dropped as soon as the
// page unmounts, so menu navigation away and back starts fresh.
//
// 缓存是 best-effort 的：隐私模式 / 配额写失败时静默退回普通 state，
// 读写都出错也不影响页面本身。

const STORAGE_PREFIX = "hapiy_filter:"

export function readPersistedValue<T>(key: string, fallback: T): T {
  if (typeof sessionStorage === "undefined") return fallback
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writePersistedValue<T>(key: string, value: T): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    /* private mode / quota: the cache is best-effort */
  }
}

export function clearPersistedValue(key: string): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    /* private mode: nothing to clear */
  }
}

// useState 的持久化版本：接口一致，页面里直接替换即可。
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(() => readPersistedValue(key, initial))

  React.useEffect(() => {
    writePersistedValue(key, value)
  }, [key, value])

  // 卸载即清缓存。清空用 0ms 定时器延后执行：StrictMode 开发期的
  // 「挂载 → 假卸载 → 再挂载」都在同一个提交里完成，再挂载时取消掉这个定时器，
  // 否则一次假卸载就会把刚恢复的值清掉。
  const clearTimerRef = React.useRef<number | undefined>(undefined)
  React.useEffect(() => {
    if (clearTimerRef.current !== undefined) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = undefined
    }
    return () => {
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = undefined
        clearPersistedValue(key)
      }, 0)
    }
  }, [key])

  return [value, setValue]
}
