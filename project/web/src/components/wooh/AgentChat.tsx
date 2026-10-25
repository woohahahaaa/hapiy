import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AgentThread } from '@/components/wooh/AgentThread'
import { AgentModelPicker } from '@/components/wooh/AgentModelPicker'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { ChatMessageRecord, ChatModelOption, ChatThread } from '@/lib/dashboard-api'
import { pickDefaultModel } from '@/lib/agent-chat'
import { dispatchUIAction } from '@/lib/ui-actions'
import { useAgentDock } from '@/components/wooh/agent-dock-context'

const AUTO_PROVIDER = 'auto'
// Actions that need the provider page mounted: one targets an existing
// provider, the other opens the create dialog with the fields pre-filled.
const PROVIDER_DIALOG_ACTIONS = new Set(['open_provider_dialog', 'create_provider_dialog'])
// sessionStorage survives a reload but dies with the tab, which is exactly the
// lifetime of "the conversation this tab is in".
const ACTIVE_THREAD_KEY = 'agent_active_thread'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof DashboardApiError ? error.message : fallback
}

// AgentChat is the console chat: model/provider selection, account-scoped
// history and sending through /v1/dashboard/chat. Replies are produced by the
// relay engine, so "自动" goes through the topology while a fixed provider
// bypasses it. Rendering/state live in AgentThread (assistant-ui primitives).
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
    const result = await dashboardApi.sendChatMessage(thread.id, {
      content: text,
      model: selectedModel,
      providerId,
      pageContext: location.pathname,
    })
    // Apply the console actions the agent asked for. Navigating first lets a
    // page that is not mounted yet pick the action up from the queue.
    for (const action of result.uiActions) {
      if (PROVIDER_DIALOG_ACTIONS.has(action.type)) {
        if (location.pathname !== '/provider') navigate('/provider')
        dispatchUIAction({ type: action.type, payload: action.payload })
      }
    }
    setActiveThread(result.thread)
    setThreads((current) => [result.thread, ...current.filter((item) => item.id !== result.thread.id)])
    return result.assistantMessage.content
  }

  return (
    <div className={className}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <AgentThread
          key={sessionKey}
          title={activeThread?.title || 'Agent'}
          controls={
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
          }
          initialMessages={initialMessages}
          onSend={handleSend}
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
