// AgentThread 的独立预览页：assistant-ui 的线程/输入框、空会话居中态、
// 以及发送后 700ms 的本地假回复。用来确认视觉与交互，不连后端。
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '@/index.css'
import '@/i18n/i18n'
import { AgentThread } from '@/components/wooh/AgentThread'
import type { ChatMessageRecord } from '@/lib/dashboard-api'

function record(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
  providerName = '',
): ChatMessageRecord {
  return {
    id,
    threadId: 'preview',
    role,
    content,
    model: 'gpt-5',
    providerId: providerName ? 'p1' : '',
    providerName,
    error: '',
    createdAt,
  }
}

const seed: readonly ChatMessageRecord[] = [
  record('m1', 'assistant', '早上好。想看哪段时间的数据？', '2026-10-22T08:56:00Z', 'hapiy'),
  record('m2', 'user', '昨天下午的调用，顺便看看有没有失败率偏高的渠道。', '2026-10-22T09:01:00Z'),
  record(
    'm3',
    'assistant',
    '昨天 12:00–18:00 共 **1,284** 次请求，失败 7 次（0.54%）。失败集中在 `Backup-GPT` 这个渠道，其余正常。\n\n| 渠道 | 失败 |\n| --- | --- |\n| Backup-GPT | 7 |\n| 其他 | 0 |',
    '2026-10-22T09:02:00Z',
    'hapiy',
  ),
]

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Demo({ dark, empty }: { dark: boolean; empty: boolean }) {
  const [key] = useState(0)
  return (
    <div className={dark ? 'dark' : undefined}>
      <div className="flex h-[700px] flex-col gap-2 rounded-2xl border border-border bg-background p-3">
        <div className="px-1 text-xs text-muted-foreground">
          {dark ? '深色' : '浅色'} · {empty ? '空会话（输入框居中）' : '有历史消息'}
        </div>
        <div className="min-h-0 flex-1">
          <AgentThread
            key={`${key}-${empty}`}
            title="Agent"
            controls={
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                <span className="text-xs text-muted-foreground">模型</span>
                <div className="h-6 truncate rounded-md border border-border px-2 text-xs leading-6">gpt-5</div>
                <span className="text-xs text-muted-foreground">供应商</span>
                <div className="h-6 truncate rounded-md border border-border px-2 text-xs leading-6">自动（按拓扑）</div>
              </div>
            }
            initialMessages={empty ? [] : seed}
            onSend={async (text) => {
              await wait(700)
              return `收到：${text}\n\n这是预览页的假回复；真实回复由 /v1/chat/completions 返回。`
            }}
          />
        </div>
      </div>
    </div>
  )
}

function PreviewApp() {
  return (
    <div className="min-h-screen bg-neutral-100 p-6 text-foreground dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-lg font-semibold">AgentThread · assistant-ui</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          左上：空会话；右上：有历史；下方：同一组件的浅色渲染。可以真的输入发送，700ms 后出假回复。
        </p>
        <div className="grid gap-5 lg:grid-cols-3">
          <Demo dark empty />
          <Demo dark empty={false} />
          <Demo dark={false} empty={false} />
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
