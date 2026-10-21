// AgentPanel 的独立预览页：同一份组件分别渲染深色 / 浅色皮肤，
// 发送消息后 700ms 由本地假回复填充，用来确认视觉与交互。
import { StrictMode, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '@/index.css'
import '@/i18n/i18n'
import { AgentPanel } from '@/components/wooh/AgentPanel'
import type { AgentChatMessage } from '@/components/wooh/AgentPanel'

const seed: readonly AgentChatMessage[] = [
  {
    id: 'a1',
    role: 'agent',
    author: 'hapiy',
    content: '早上好。想看哪段时间的数据？',
    createdAt: '08:56',
  },
  {
    id: 'u1',
    role: 'user',
    content: '昨天下午的调用，顺便看看有没有失败率偏高的渠道。',
    createdAt: '09:01',
  },
  {
    id: 'a2',
    role: 'agent',
    author: 'hapiy',
    content:
      '昨天 12:00–18:00 共 1,284 次请求，失败 7 次（0.54%）。失败集中在 Backup-GPT 这一个渠道，其余正常。明细我整理成文件了：',
    createdAt: '09:02',
    attachments: [{ name: 'hapiy-usage-2026-10-20.csv', size: '18 KB' }],
  },
  {
    id: 'u2',
    role: 'user',
    content: 'Backup-GPT 先禁用，等会儿我再看。',
    createdAt: '09:03',
    attachments: [{ name: '渠道排查.md', size: '2.1 KB' }],
  },
  {
    id: 'a3',
    role: 'agent',
    author: 'hapiy',
    content: '这个面板只负责展示，禁用渠道需要在控制台的供应商页操作。需要我把入口发给你吗？',
    createdAt: '09:03',
  },
]

function Demo({ dark }: { dark: boolean }) {
  const [messages, setMessages] = useState<readonly AgentChatMessage[]>(seed)
  const [sending, setSending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)

  const send = (text: string) => {
    seq.current += 1
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const userMessage: AgentChatMessage = {
      id: `u-${seq.current}`,
      role: 'user',
      content: text,
      createdAt: stamp,
    }
    const replyId = `a-${seq.current}`
    setSending(true)
    setMessages((current) => [
      ...current,
      userMessage,
      { id: replyId, role: 'agent', author: 'hapiy', content: '', pending: true },
    ])
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.id === replyId
            ? {
                ...message,
                pending: false,
                content: `收到：「${text}」。这是预览页的假回复，真实接入后由 /v1/chat/completions 的流式响应填充。`,
                createdAt: stamp,
              }
            : message,
        ),
      )
      setSending(false)
    }, 700)
  }

  const title = useMemo(() => (dark ? 'agentpanel · 深色' : 'agentpanel · 浅色'), [dark])

  return (
    <div className={dark ? 'dark' : undefined}>
      <div className="flex h-[700px] flex-col gap-2 rounded-2xl border border-border bg-background p-3">
        <div className="px-1 text-xs text-muted-foreground">{title}</div>
        <div className="min-h-0 flex-1">
          <AgentPanel
            title="hapiy"
            subtitle="在线 · 已接入网关数据"
            messages={messages}
            onSend={send}
            sending={sending}
          />
        </div>
      </div>
    </div>
  )
}

function PreviewApp() {
  return (
    <div className="min-h-screen bg-neutral-100 p-6 text-foreground dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-lg font-semibold">AgentPanel</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          同一组件的深色 / 浅色渲染。输入框可发送：回车提交，Shift+回车换行，发送中会显示打字动画。
        </p>
        <div className="grid gap-5 lg:grid-cols-2">
          <Demo dark />
          <Demo dark={false} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
