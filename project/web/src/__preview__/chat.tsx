// 聊天预览：用假的 dashboardApi 验证会话恢复和默认模型，不连后端。
// ?scenario=default|first|restore|restore-provider
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import '@/index.css'
import '@/i18n/i18n'
import { AgentChat } from '@/components/wooh/AgentChat'
import { AgentDockProvider } from '@/components/wooh/AgentDock'
import { ThemeProvider } from '@/components/wooh/theme-provider'
import { dashboardApi } from '@/lib/dashboard-api'
import type { ChatMessageRecord, ChatModelOption, ChatThread } from '@/lib/dashboard-api'

const params = new URLSearchParams(window.location.search)
const scenario = params.get('scenario') ?? 'default'

const models: readonly ChatModelOption[] = [
  {
    model: 'deepseek',
    providers: [{ id: 'p1', name: 'One', autoDisabled: false, workflowEnabled: true, status: true }],
  },
  { model: 'gpt', providers: [] },
]

const threads: readonly ChatThread[] = [
  {
    id: 't1',
    title: 'Thread one',
    model: 'gpt',
    providerId: '',
    archived: false,
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
  },
  {
    id: 't2',
    title: 'Thread two',
    model: 'deepseek',
    providerId: 'p1',
    archived: false,
    createdAt: '2026-10-24T09:00:00Z',
    updatedAt: '2026-10-24T09:00:00Z',
  },
]

const messages: Readonly<Record<string, readonly ChatMessageRecord[]>> = {
  t1: [
    {
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'hello from thread one',
      model: 'gpt',
      providerId: '',
      providerName: '',
      error: '',
      createdAt: '2026-10-24T10:00:00Z',
    },
  ],
  t2: [
    {
      id: 'm2',
      threadId: 't2',
      role: 'user',
      content: 'hello from thread two',
      model: 'deepseek',
      providerId: 'p1',
      providerName: 'One',
      error: '',
      createdAt: '2026-10-24T09:00:00Z',
    },
  ],
}

const preference =
  scenario === 'first'
    ? { model: '', providerId: '' }
    : scenario === 'restore-provider'
      ? { model: 'deepseek', providerId: 'p1' }
      : { model: 'gpt', providerId: '' }

const storedThreadId = scenario === 'restore' ? 't1' : scenario === 'restore-provider' ? 't2' : ''
if (storedThreadId) window.sessionStorage.setItem('agent_active_thread', storedThreadId)
else window.sessionStorage.removeItem('agent_active_thread')

const mock = dashboardApi as unknown as Record<string, unknown>
mock.getChatModels = async () => models
mock.listChatThreads = async () => threads
mock.getChatPreferences = async () => preference
mock.listChatMessages = async (id: string) => messages[id] ?? []
mock.createChatThread = async (input: { model: string; providerId: string }) => ({
  ...threads[0],
  id: 't-new',
  title: '',
  model: input.model,
  providerId: input.providerId,
})
mock.updateChatThread = async (id: string, patch: Record<string, unknown>) => ({
  ...threads.find((thread) => thread.id === id),
  ...patch,
})
mock.deleteChatThread = async () => {}
mock.sendChatMessage = async () => {
  throw new Error('preview does not send')
}

function Measure() {
  const [data, setData] = useState('')
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const picker = [...document.querySelectorAll('button[aria-label]')]
        .map((button) => button.getAttribute('aria-label') ?? '')
        .find((label) => label.startsWith('deepseek-') || label.startsWith('gpt-')) ?? ''
      setData(JSON.stringify({
        picker,
        storedThread: window.sessionStorage.getItem('agent_active_thread'),
        hasThreadOne: document.body.innerText.includes('hello from thread one'),
        hasThreadTwo: document.body.innerText.includes('hello from thread two'),
      }))
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return <pre id="measure">{data}</pre>
}

function PreviewApp() {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <AgentDockProvider>
          <div className="h-svh w-[520px] p-2">
            <AgentChat className="h-full" />
          </div>
          <Measure />
        </AgentDockProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
