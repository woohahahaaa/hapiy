import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AgentThread } from '@/components/wooh/AgentThread'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { ChatMessageRecord, ChatModelOption, ChatThread } from '@/lib/dashboard-api'
import { dispatchUIAction } from '@/lib/ui-actions'
import { useAgentDock } from '@/components/wooh/agent-dock-context'

const AUTO_PROVIDER = 'auto'

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
  const { rightCollapsed, expandRight } = useAgentDock()
  const [models, setModels] = useState<readonly ChatModelOption[]>([])
  const [threads, setThreads] = useState<readonly ChatThread[]>([])
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null)
  const [initialMessages, setInitialMessages] = useState<readonly ChatMessageRecord[]>([])
  const [sessionKey, setSessionKey] = useState('new:0')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(AUTO_PROVIDER)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([dashboardApi.getChatModels(), dashboardApi.listChatThreads()])
      .then(([nextModels, nextThreads]) => {
        if (cancelled) return
        setModels(nextModels)
        setThreads(nextThreads)
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
    setSelectedModel(thread.model)
    setSelectedProvider(thread.providerId || AUTO_PROVIDER)
    setHistoryOpen(false)
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
      setActiveThread(thread)
      setThreads((current) => [thread!, ...current])
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
      if (action.type === 'open_provider_dialog') {
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
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs text-muted-foreground">{t('modelLabel')}</span>
              <Select value={selectedModel || undefined} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-fit max-w-full min-w-0 shrink-0" aria-label={t('modelLabel')}>
                  <SelectValue placeholder={t('modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((entry) => (
                    <SelectItem key={entry.model} value={entry.model}>
                      {entry.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedModel && (
                <>
                  <span className="ms-1.5 shrink-0 text-xs text-muted-foreground">{t('providerLabel')}</span>
                  <Select value={effectiveProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger className="w-fit max-w-full min-w-0 shrink-0" aria-label={t('providerLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_PROVIDER}>{t('providerAuto')}</SelectItem>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                          {provider.autoDisabled ? ` ${t('providerDisabledSuffix')}` : ''}
                          {provider.workflowEnabled ? '' : ` ${t('providerNoTopologySuffix')}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          }
          initialMessages={initialMessages}
          onSend={handleSend}
          actions={
            <>
              {rightCollapsed && (
                <Button size="sm" variant="outline" onClick={expandRight}>
                  <AppIcon name="view_sidebar" />
                  <span>{t('expandRight')}</span>
                </Button>
              )}
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
            </>
          }
        />
      </div>
    </div>
  )
}
