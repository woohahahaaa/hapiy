import { describe, expect, it } from 'vitest'
import { parseChatUIActionEvent } from './chat-follow'

describe('parseChatUIActionEvent', () => {
  it('reads the thread, action type and payload', () => {
    const event = parseChatUIActionEvent(JSON.stringify({
      thread_id: 't1',
      action: { id: 'a1', type: 'provider_changed', payload: { provider_id: 'p1', created: true } },
    }))
    expect(event).not.toBeNull()
    expect(event?.threadId).toBe('t1')
    expect(event?.action.type).toBe('provider_changed')
    expect(event?.action.payload.provider_id).toBe('p1')
    expect(event?.action.id).toBe('a1')
  })

  it('drops frames that are not a chat action', () => {
    expect(parseChatUIActionEvent('not json')).toBeNull()
    expect(parseChatUIActionEvent(JSON.stringify({ thread_id: 't1' }))).toBeNull()
    expect(parseChatUIActionEvent(JSON.stringify({ action: { type: 'x' } }))).toBeNull()
    expect(parseChatUIActionEvent(JSON.stringify({ thread_id: 't1', action: { payload: {} } }))).toBeNull()
  })
})
