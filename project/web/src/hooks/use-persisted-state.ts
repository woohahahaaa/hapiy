import * as React from "react"

// 顶部的筛选状态要在浏览器刷新（F5）后保留：以 localStorage 按「页面/表格 +
// 字段」缓存，组件挂载时恢复、变化时回写。
//
// Filter values survive a plain browser refresh: cached per table+field in
// localStorage, restored on mount and written back on change.
//
// 缓存是 best-effort 的：隐私模式 / 配额写失败时静默退回普通 state，
// 读写都出错也不影响页面本身。

const STORAGE_PREFIX = "hapiy_filter:"

export function readPersistedValue<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writePersistedValue<T>(key: string, value: T): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    /* private mode / quota: the cache is best-effort */
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
  return [value, setValue]
}
