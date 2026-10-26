import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AgentThread } from '@/components/wooh/AgentThread'
import { AgentModelPicker } from '@/components/wooh/AgentModelPicker'
import { AgentModeToggle } from '@/components/wooh/AgentModeToggle'
import { AgentThinkingPicker } from '@/components/wooh/AgentThinkingPicker'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { apiBaseUrl, dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { ChatMessageRecord, ChatModelOption, ChatReasoningEffort, ChatSendMode, ChatThread, ChatUIAction } from '@/lib/dashboard-api'
import { pickDefaultModel } from '@/lib/agent-chat'
import { dispatchUIAction } from '@/lib/ui-actions'
import { parseChatUIActionEvent } from '@/lib/chat-follow'
import { useAgentDock } from '@/components/wooh/agent-dock-context'

const AUTO_PROVIDER = 'auto'
// Actions handled by the provider page: dialogs the agent opens, plus the
// mirror of writes it already made (navigate + refresh + show the result).
const PROVIDER_ACTIONS = new Set([
  'open_provider_dialog',
  'create_provider_dialog',
  'create_provider',
  'update_provider',
  'delete_provider',
  'set_provider_status',
  'set_provider_workflow',
  'set_provider_dedupe_v1',
  'reset_provider_disable',
  'reset_all_provider_disable',
])
// sessionStorage survives a reload but dies with the tab, which is exactly the
// lifetime of "the conversation this tab is in".
const ACTIVE_THREAD_KEY = 'agent_active_thread'
// The permission level the composer is on. Remembered per tab, like the active
// thread, so a reload keeps the user in the safer read-only mode.
const CHAT_MODE_KEY = 'agent_chat_mode'
// Thinking level follows the same tab lifetime as the mode: a reload keeps the
// level the user picked, a new tab starts at the provider default.
const CHAT_THINKING_KEY = 'agent_thinking_level'

function readStoredMode(): ChatSendMode {
  return window.sessionStorage.getItem(CHAT_MODE_KEY) === 'chat' ? 'chat' : 'execute'
}

function readStoredThinking(): ChatReasoningEffort {
  const stored = window.sessionStorage.getItem(CHAT_THINKING_KEY)
  return stored === 'low' || stored === 'medium' || stored === 'high' ? stored : ''
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof DashboardApiError ? error.message : fallback
}

// AgentChat is the console chat: model/provider selection, account-scoped
// history and sending through /v1/dashboard/chat. Replies are produced by the
// relay engine, so "自动" goes through the topology while a fixed provider
// bypasses it. Rendering/state live in AgentThread (assistant-ui primitives).
// openChatActionStream subscribes to the dashboard SSE endpoint for the
// duration of one chat turn. A missing EventSource (old browser) simply means
// no live following; the final response still applies every action.
function openChatActionStream(
  threadId: string,
  onAction: (action: ChatUIAction) => void,
): EventSource | null {
  if (typeof EventSource === 'undefined') return null
  const source = new EventSource(`${apiBaseUrl}/v1/dashboard/events`, { withCredentials: true })
  source.addEventListener('chat_ui_action', (event) => {
    const parsed = parseChatUIActionEvent((event as MessageEvent).data)
    if (!parsed || parsed.threadId !== threadId) return
    onAction(parsed.action)
  })
  // EventSource reconnects forever on a failing endpoint; the final response
  // remains the fallback, so stop retrying.
  source.onerror = () => source.close()
  return source
}

export function AgentChat({ className }: { readonly className?: string }) {
  const { t } = useTranslation('agentPanel')
  const navigate = useNavigate()
  const location = useLocation()
  const { rightCollapsed, expandRight, maxWidth, setWidth } = useAgentDock()
  const [models, setModels] = useState<readonly ChatModelOption[]>([])
  const [threads, setThreads] = useState<readonly ChatThread[]>([])
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null)
  const [initialMessages, setInitialMessages] = useState<readonly ChatMessageRecord[]>([])
  const [sessionKey, setSessionKey] = useState('new:0')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(AUTO_PROVIDER)
  const [preference, setPreference] = useState({ model: '', providerId: '' })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mode, setMode] = useState<ChatSendMode>(readStoredMode)
  const [thinking, setThinking] = useState<ChatReasoningEffort>(readStoredThinking)
  // The live action stream for the turn in flight (one connection per send).
  const followRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    const storedThreadId = window.sessionStorage.getItem(ACTIVE_THREAD_KEY)
    void Promise.all([
      dashboardApi.getChatModels(),
      dashboardApi.listChatThreads(),
      // A missing preference only changes which model a new chat starts on.
      dashboardApi.getChatPreferences().catch(() => ({ model: '', providerId: '' })),
    ])
      .then(async ([nextModels, nextThreads, nextPreference]) => {
        if (cancelled) return
        setModels(nextModels)
        setThreads(nextThreads)
        setPreference(nextPreference)

        // Each tab restores the thread it was in. A tab that was closed has
        // no stored id, so it starts with an empty conversation.
        const restored = storedThreadId
          ? nextThreads.find((thread) => thread.id === storedThreadId)
          : undefined
        if (!restored) {
          // The stored thread was deleted (or belongs to another account):
          // drop the stale id instead of restoring a dead conversation.
          if (storedThreadId) window.sessionStorage.removeItem(ACTIVE_THREAD_KEY)
          const fallback = pickDefaultModel(nextModels, nextPreference)
          setSelectedModel(fallback.model)
          setSelectedProvider(fallback.providerId || AUTO_PROVIDER)
          return
        }
        let records: readonly ChatMessageRecord[] = []
        try {
          records = await dashboardApi.listChatMessages(restored.id)
        } catch (error) {
          if (cancelled) return
          toast(errorMessage(error, t('sendFailed')))
        }
        if (cancelled) return
        setActiveThread(restored)
        setInitialMessages(records)
        setSelectedModel(restored.model || pickDefaultModel(nextModels, nextPreference).model)
        setSelectedProvider(restored.providerId || AUTO_PROVIDER)
        setSessionKey(restored.id)
        window.sessionStorage.setItem(ACTIVE_THREAD_KEY, restored.id)
      })
      .catch((error: unknown) => {
        if (!cancelled) toast(errorMessage(error, t('sendFailed')))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => () => {
    followRef.current?.close()
  }, [])

  const modelOptions = useMemo(() => {
    if (!selectedModel || models.some((entry) => entry.model === selectedModel)) return models
    return [{ model: selectedModel, providers: [] }, ...models]
  }, [models, selectedModel])

  const providerOptions = useMemo(
    () => modelOptions.find((entry) => entry.model === selectedModel)?.providers ?? [],
    [modelOptions, selectedModel],
  )

  const effectiveProvider =
    selectedProvider === AUTO_PROVIDER ||
    providerOptions.some((provider) => provider.id === selectedProvider)
      ? selectedProvider
      : AUTO_PROVIDER

  const openThread = async (thread: ChatThread) => {
    setActiveThread(thread)
    setSelectedModel(thread.model || pickDefaultModel(models, preference).model)
    setSelectedProvider(thread.providerId || AUTO_PROVIDER)
    setHistoryOpen(false)
    window.sessionStorage.setItem(ACTIVE_THREAD_KEY, thread.id)
    try {
      const records = await dashboardApi.listChatMessages(thread.id)
      setInitialMessages(records)
      setSessionKey(thread.id)
    } catch (error) {
      toast(errorMessage(error, t('sendFailed')))
      setInitialMessages([])
      setSessionKey(thread.id)
    }
  }

  const startNewThread = () => {
    setActiveThread(null)
    setInitialMessages([])
    setSessionKey(`new:${Date.now()}`)
    setHistoryOpen(false)
    window.sessionStorage.removeItem(ACTIVE_THREAD_KEY)
    const fallback = pickDefaultModel(models, preference)
    setSelectedModel(fallback.model)
    setSelectedProvider(fallback.providerId || AUTO_PROVIDER)
  }

  const removeThread = async (thread: ChatThread) => {
    if (!window.confirm(t('deleteConfirm'))) return
    try {
      await dashboardApi.deleteChatThread(thread.id)
      setThreads((current) => current.filter((item) => item.id !== thread.id))
      if (activeThread?.id === thread.id) startNewThread()
    } catch (error) {
      toast(errorMessage(error, t('sendFailed')))
    }
  }

  const changeMode = (next: ChatSendMode) => {
    setMode(next)
    window.sessionStorage.setItem(CHAT_MODE_KEY, next)
  }

  const changeThinking = (next: ChatReasoningEffort) => {
    setThinking(next)
    window.sessionStorage.setItem(CHAT_THINKING_KEY, next)
  }

  const handleSend = async (text: string): Promise<string> => {
    if (!selectedModel) throw new Error(t('selectModelFirst'))
    const providerId = effectiveProvider === AUTO_PROVIDER ? '' : effectiveProvider
    let thread = activeThread
    if (!thread) {
      thread = await dashboardApi.createChatThread({ model: selectedModel, providerId })
      // The backend records this too; keep the local copy so a new chat in
      // this tab defaults to the same model without a round-trip.
      setPreference({ model: selectedModel, providerId })
      setActiveThread(thread)
      setThreads((current) => [thread!, ...current])
      window.sessionStorage.setItem(ACTIVE_THREAD_KEY, thread.id)
    }
    // Follow the turn live: the backend publishes one chat_ui_action event per
    // tool call, so the page navigates and updates while the agent is still
    // working. The final response repeats the same actions (same ids), so a
    // dropped stream still leaves the UI correct.
    const seen = new Set<string>()
    const applyAction = (action: ChatUIAction) => {
      if (action.id) {
        if (seen.has(action.id)) return
        seen.add(action.id)
      }
      if (!PROVIDER_ACTIONS.has(action.type)) return
      if (location.pathname !== '/provider') navigate('/provider')
      dispatchUIAction({ type: action.type, payload: action.payload })
    }
    followRef.current?.close()
    followRef.current = openChatActionStream(thread.id, applyAction)
    try {
      const result = await dashboardApi.sendChatMessage(thread.id, {
        content: text,
        model: selectedModel,
        providerId,
        pageContext: location.pathname,
        mode,
        reasoningEffort: thinking,
      })
      // Navigating first lets a page that is not mounted yet pick the queued
      // action up when it mounts.
      for (const action of result.uiActions) applyAction(action)
      setActiveThread(result.thread)
      setThreads((current) => [result.thread, ...current.filter((item) => item.id !== result.thread.id)])
      return result.assistantMessage.content
    } finally {
      followRef.current?.close()
      followRef.current = null
    }
  }

  return (
    <div className={className}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <AgentThread
          key={sessionKey}
          title={activeThread?.title || 'Agent'}
          controls={
            <>
              <AgentModelPicker
                models={modelOptions}
                model={selectedModel}
                providerId={effectiveProvider === AUTO_PROVIDER ? '' : effectiveProvider}
                onChange={({ model, providerId }) => {
                  setSelectedModel(model)
                  setSelectedProvider(providerId || AUTO_PROVIDER)
                  if (!activeThread) return
                  // Remember the choice on the thread itself so switching back
                  // to it (or refreshing) restores the same model.
                  const next = { ...activeThread, model, providerId }
                  setActiveThread(next)
                  setThreads((current) => current.map((item) => (item.id === next.id ? next : item)))
                  void dashboardApi
                    .updateChatThread(activeThread.id, { model, providerId })
                    .catch((error: unknown) => {
                      toast(errorMessage(error, t('sendFailed')))
                    })
                }}
              />
              <AgentThinkingPicker effort={thinking} onChange={changeThinking} />
            </>
          }
          initialMessages={initialMessages}
          onSend={handleSend}
          composerToolbar={<AgentModeToggle mode={mode} onChange={changeMode} />}
          actions={
            <>
              <Button size="icon-sm" variant="ghost" aria-label={t('newChat')} onClick={startNewThread}>
                <AppIcon name="add" />
              </Button>
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={t('history')}>
                    <AppIcon name="history" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-1">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('history')}</div>
                  <div className="max-h-80 overflow-y-auto">
                    {threads.length === 0 && (
                      <div className="px-2 py-3 text-xs text-muted-foreground">{t('noThreads')}</div>
                    )}
                    {threads.map((thread) => (
                      <div key={thread.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void openThread(thread)}
                          className={
                            'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ' +
                            (activeThread?.id === thread.id ? 'bg-muted font-medium' : '')
                          }
                          title={thread.title || t('untitled')}
                        >
                          {thread.title || t('untitled')}
                        </button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t('deleteThread')}
                          onClick={() => void removeThread(thread)}
                        >
                          <AppIcon name="delete" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => (rightCollapsed ? expandRight() : setWidth(maxWidth))}
              >
                <span>{rightCollapsed ? t('showConsole') : t('hideConsole')}</span>
              </Button>
            </>
          }
        />
      </div>
    </div>
  )
}
