import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentPanel } from './AgentPanel'
import type { AgentChatMessage } from './AgentPanel'

const thread: AgentChatMessage[] = [
  {
    id: 'm1',
    role: 'agent',
    content: '需要我帮你查一下用量吗？',
    author: 'hapiy',
    createdAt: '09:41',
  },
  {
    id: 'm2',
    role: 'user',
    content: '好，看看今天的。',
    createdAt: '09:42',
    attachments: [{ name: 'report.pdf', size: '4.8 MB' }],
  },
]

describe('AgentPanel', () => {
  it('empty_thread_renders_hint_and_composer', () => {
    const html = renderToStaticMarkup(<AgentPanel messages={[]} onSend={() => {}} />)
    expect(html).toContain('还没有消息')
    expect(html).toContain('<textarea')
    expect(html).toContain('aria-label="发送"')
    // Nothing to send yet, so the send button stays disabled.
    expect(html).toContain('disabled=""')
  })

  it('renders_authors_times_bubbles_and_attachments', () => {
    const html = renderToStaticMarkup(<AgentPanel messages={thread} onSend={() => {}} title="hapiy" />)
    expect(html).toContain('hapiy')
    expect(html).toContain('需要我帮你查一下用量吗？')
    expect(html).toContain('09:41')
    expect(html).toContain('你')
    expect(html).toContain('好，看看今天的。')
    expect(html).toContain('report.pdf')
    expect(html).toContain('4.8 MB')
    expect(html).not.toContain('还没有消息')
  })

  it('pending_message_renders_typing_dots_instead_of_content', () => {
    const html = renderToStaticMarkup(
      <AgentPanel
        messages={[{ id: 'm3', role: 'agent', content: 'ignored', pending: true }]}
        onSend={() => {}}
      />,
    )
    expect(html).toContain('正在输入')
    expect(html).not.toContain('ignored')
  })

  it('sending_disables_composer_and_spins_the_send_icon', () => {
    const html = renderToStaticMarkup(
      <AgentPanel messages={thread} onSend={() => {}} sending />,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('animate-spin')
  })

  it('error_message_uses_destructive_styling', () => {
    const html = renderToStaticMarkup(
      <AgentPanel
        messages={[{ id: 'm4', role: 'agent', content: 'upstream 502', error: true }]}
        onSend={() => {}}
      />,
    )
    expect(html).toContain('text-destructive')
    expect(html).toContain('upstream 502')
  })

  it('custom_labels_override_the_defaults', () => {
    const html = renderToStaticMarkup(
      <AgentPanel
        messages={[
          { id: 'a', role: 'agent', content: 'hi' },
          { id: 'b', role: 'user', content: 'yo' },
        ]}
        onSend={() => {}}
        userLabel="我"
        agentLabel="网关助手"
      />,
    )
    expect(html).toContain('网关助手')
    expect(html).toContain('我')
  })
})
