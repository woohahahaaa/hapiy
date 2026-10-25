import { parseChatUIAction, type ChatUIAction } from '@/lib/dashboard-api'

// chat_ui_action events are published while a console-chat turn is still
// running, so the page can follow the agent (navigate, open the dialog, flash
// the changed row) instead of waiting for the final response. The same action
// is also returned in that response; both carry an id so the page applies it
// once.
export type ChatUIActionEvent = {
  readonly threadId: string
  readonly action: ChatUIAction
}

// parseChatUIActionEvent reads one SSE frame. Returns null for anything that
// is not a well-formed chat action, so a malformed frame cannot break the
// stream listener.
export function parseChatUIActionEvent(raw: string): ChatUIActionEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const threadId = typeof record.thread_id === 'string' ? record.thread_id : ''
  if (threadId === '' || typeof record.action !== 'object' || record.action === null) return null
  try {
    return { threadId, action: parseChatUIAction(record.action) }
  } catch {
    return null
  }
}
