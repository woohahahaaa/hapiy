import { useEffect, useRef } from 'react'

// UI actions are commands the agent asks the console to perform (open a
// dialog, prefill fields). The backend queues them; this module delivers them
// to whichever page is mounted and keeps them until that page subscribes.
export type UIAction = {
  readonly type: string
  readonly payload: Readonly<Record<string, unknown>>
}

type Handler = (payload: Readonly<Record<string, unknown>>) => void

const handlers = new Map<string, Set<Handler>>()
const pending: UIAction[] = []

/** Delivers an action to the mounted handler(s) or queues it for later. */
export function dispatchUIAction(action: UIAction): void {
  const set = handlers.get(action.type)
  if (set && set.size > 0) {
    for (const handler of set) handler(action.payload)
    return
  }
  pending.push(action)
}

/**
 * Subscribes the current page to one action type and drains any action queued
 * before it mounted (e.g. the agent asked to open a dialog while the user was
 * on another route).
 */
export function useUIAction(type: string, handler: Handler): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  }, [handler])

  useEffect(() => {
    const set = handlers.get(type) ?? new Set<Handler>()
    handlers.set(type, set)
    const listener: Handler = (payload) => latest.current(payload)
    set.add(listener)

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].type !== type) continue
      const action = pending[index]
      pending.splice(index, 1)
      listener(action.payload)
    }

    return () => {
      set.delete(listener)
      if (set.size === 0) handlers.delete(type)
    }
  }, [type])
}
