import { useEffect, useState } from 'react'
import { dashboardApi, type Provider } from '@/lib/dashboard-api'

// 上游 Key 备注索引：byKey 按 Key 字符串汇总（跨供应商先到先得，供应商
// 改名后仍能命中）；byProviderId 按供应商精确查询（同一 Key 出现在多个
// 供应商时优先用它）。
export type ProviderKeyNoteIndex = {
  readonly byKey: ReadonlyMap<string, string>
  readonly byProviderId: ReadonlyMap<string, ReadonlyMap<string, string>>
}

export function buildProviderKeyNoteIndex(providers: readonly Provider[]): ProviderKeyNoteIndex {
  const byKey = new Map<string, string>()
  const byProviderId = new Map<string, ReadonlyMap<string, string>>()
  for (const provider of providers) {
    const notes = new Map<string, string>()
    for (const [key, note] of Object.entries(provider.keyNotes)) {
      if (note === '') continue
      notes.set(key, note)
      if (!byKey.has(key)) byKey.set(key, note)
    }
    byProviderId.set(provider.id, notes)
  }
  return { byKey, byProviderId }
}

export function keyNoteFromIndex(index: ProviderKeyNoteIndex, key: string, providerId?: string): string {
  if (key === '') return ''
  if (providerId !== undefined) {
    const scoped = index.byProviderId.get(providerId)?.get(key)
    if (scoped !== undefined) return scoped
  }
  return index.byKey.get(key) ?? ''
}

// 备注索引整个会话只拉取一次；失败时清掉缓存，下次再试。
let providerKeyNoteIndexPromise: Promise<ProviderKeyNoteIndex> | null = null

export function loadProviderKeyNoteIndex(): Promise<ProviderKeyNoteIndex> {
  if (!providerKeyNoteIndexPromise) {
    providerKeyNoteIndexPromise = dashboardApi
      .listProviders({ limit: 1000, offset: 0 })
      .then(({ providers }) => buildProviderKeyNoteIndex(providers))
      .catch(() => {
        providerKeyNoteIndexPromise = null
        return buildProviderKeyNoteIndex([])
      })
  }
  return providerKeyNoteIndexPromise
}

// 单个 Key 的备注查询：复用会话级索引，失败时无备注。
export function useProviderKeyNote(key: string, providerId?: string): string {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (key === '') return
    let alive = true
    void loadProviderKeyNoteIndex().then((index) => {
      if (alive) setNote(keyNoteFromIndex(index, key, providerId))
    })
    return () => {
      alive = false
    }
  }, [key, providerId])
  return note
}
