import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { AgentPanel } from '@/components/wooh/AgentPanel'
import type { AgentChatMessage } from '@/components/wooh/AgentPanel'
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

const AUTO_PROVIDER = 'auto'

function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof DashboardApiError ? error.message : fallback
}

// AgentChat is the data layer + panel for the console chat: model/provider
// selection, account-scoped thread history and sending through
// /v1/dashboard/chat. Replies are produced by the relay engine, so "自动" goes
// through the topology while a fixed provider bypasses it.
export function AgentChat({ className }: { readonly className?: string }) {
  const { t } = useTranslation('agentPanel')
  const [models, setModels] = useState<readonly ChatModelOption[]>([])
  const [threads, setThreads] = useState<readonly ChatThread[]>([])
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null)
  const [messages, setMessages] = useState<readonly ChatMessageRecord[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(AUTO_PROVIDER)
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([dashboardApi.getChatModels(), dashboardApi.listChatThreads()])
      .then(([nextModels, nextThreads]) => {
        if (cancelled) return
        setModels(nextModels)
        setThreads(nextThreads)
        setSelectedModel((current) => current || nextModels[0]?.model || '')
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

  // Keep the provider inside the new model's list; otherwise fall back to 自动.
  useEffect(() => {
    if (selectedProvider === AUTO_PROVIDER) return
    if (!providerOptions.some((provider) => provider.id === selectedProvider)) {
      setSelectedProvider(AUTO_PROVIDER)
    }
  }, [providerOptions, selectedProvider])

  const openThread = async (thread: ChatThread) => {
    setActiveThread(thread)
    setSelectedModel(thread.model)
    setSelectedProvider(thread.providerId || AUTO_PROVIDER)
    setHistoryOpen(false)
    try {
      setMessages(await dashboardApi.listChatMessages(thread.id))
    } catch (error) {
      toast(errorMessage(error, t('sendFailed')))
      setMessages([])
    }
  }

  const startNewThread = () => {
    setActiveThread(null)
    setMessages([])
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

  const handleModelChange = (value: string) => {
    setSelectedModel(value)
    setSelectedProvider(AUTO_PROVIDER)
  }

  const handleSend = async (text: string) => {
    if (!selectedModel) {
      toast(t('selectModelFirst'))
      return
    }
    const providerId = selectedProvider === AUTO_PROVIDER ? '' : selectedProvider
    setSending(true)
    try {
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
      })
      setMessages((current) => [...current, result.userMessage, result.assistantMessage])
      setActiveThread(result.thread)
      setThreads((current) => [result.thread, ...current.filter((item) => item.id !== result.thread.id)])
    } catch (error) {
      const message = errorMessage(error, t('sendFailed'))
      toast(message)
      const stamp = new Date().toISOString()
      setMessages((current) => [
        ...current,
        {
          id: `local-user-${stamp}`,
          threadId: activeThread?.id ?? '',
          role: 'user',
          content: text,
          model: selectedModel,
          providerId,
          providerName: '',
          error: '',
          createdAt: stamp,
        },
        {
          id: `local-error-${stamp}`,
          threadId: activeThread?.id ?? '',
          role: 'assistant',
          content: message,
          model: selectedModel,
          providerId,
          providerName: '',
          error: 'failed',
          createdAt: stamp,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const panelMessages: readonly AgentChatMessage[] = messages.map((message) => ({
    id: message.id,
    role: message.role === 'assistant' ? 'agent' : 'user',
    content: message.content,
    author: message.role === 'assistant' ? message.providerName || 'hapiy' : undefined,
    createdAt: formatClock(message.createdAt),
    error: Boolean(message.error),
  }))

  const providerLabel =
    selectedProvider === AUTO_PROVIDER
      ? t('providerAuto')
      : providerOptions.find((provider) => provider.id === selectedProvider)?.name ?? selectedProvider

  return (
    <div className={className}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <Select value={selectedModel || undefined} onValueChange={handleModelChange}>
            <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={t('modelLabel')}>
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

          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={t('providerLabel')}>
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
        </div>

        <AgentPanel
          className="min-h-0 flex-1"
          title={activeThread?.title || 'Agent'}
          subtitle={`${selectedModel || '—'} · ${providerLabel}`}
          messages={panelMessages}
          onSend={(text) => void handleSend(text)}
          sending={sending}
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
            </>
          }
        />
      </div>
    </div>
  )
}
