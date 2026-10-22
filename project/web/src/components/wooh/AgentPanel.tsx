import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentAvatar } from '@/components/wooh/AgentAvatar'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type AgentChatRole = 'user' | 'agent'

export type AgentChatAttachment = {
  readonly name: string
  readonly size?: string
}

export type AgentChatMessage = {
  readonly id: string
  readonly role: AgentChatRole
  readonly content: string
  /** Display name; falls back to the localized "you" / "agent" label. */
  readonly author?: string
  readonly avatarUrl?: string
  /** Already-formatted time (e.g. "09:41"); shown as-is. */
  readonly createdAt?: string
  readonly attachments?: readonly AgentChatAttachment[]
  /** Renders a typing indicator instead of the content. */
  readonly pending?: boolean
  readonly error?: boolean
}

export type AgentPanelProps = {
  readonly messages: readonly AgentChatMessage[]
  readonly onSend: (text: string) => void | Promise<void>
  readonly title?: string
  readonly subtitle?: string
  readonly placeholder?: string
  readonly emptyHint?: string
  /** Disables the composer and shows the composer spinner. */
  readonly sending?: boolean
  readonly disabled?: boolean
  /** Header trailing slot (call buttons, menu…). */
  readonly actions?: ReactNode
  readonly userLabel?: string
  readonly agentLabel?: string
  readonly className?: string
}

// AgentPanel is the chat surface for talking to an agent: header with status,
// a scrolling message list (bubbles, attachments, typing dots, error style)
// and a composer. It is presentation-only — messages and sending live with the
// caller, so the same panel works against any transport.
export function AgentPanel({
  messages,
  onSend,
  title,
  subtitle,
  placeholder,
  emptyHint,
  sending = false,
  disabled = false,
  actions,
  userLabel,
  agentLabel,
  className,
}: AgentPanelProps) {
  const { t } = useTranslation('agentPanel')
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest message in view. Runs on length rather than the array
  // itself so a re-render with the same thread does not yank the viewport.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, sending])

  const canSend = !disabled && !sending && draft.trim() !== ''

  const submit = () => {
    const text = draft.trim()
    if (!text || disabled || sending) return
    setDraft('')
    void onSend(text)
  }

  const labelFor = (message: AgentChatMessage) =>
    message.author ?? (message.role === 'user' ? (userLabel ?? t('you')) : (agentLabel ?? t('agent')))

  const empty = messages.length === 0

  // 同一条输入框用在两个位置：有消息时贴在底部，空会话时浮在正中间。
  const composer = (standalone: boolean) => (
    <form
      className={standalone ? 'border-t border-border p-3' : 'w-full'}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div
        className={cn(
          'flex items-end gap-2',
          standalone
            ? 'rounded-xl bg-muted/60 p-1.5'
            : 'rounded-2xl border border-border bg-card p-2 shadow-sm',
        )}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // IME composition (Chinese/Japanese input) must not send on Enter.
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          placeholder={placeholder ?? t('placeholder')}
          disabled={disabled}
          rows={1}
          aria-label={placeholder ?? t('placeholder')}
          className="min-h-9 border-transparent bg-transparent py-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon"
          className="size-8 shrink-0 rounded-full"
          disabled={!canSend}
          aria-label={t('send')}
        >
          <AppIcon
            name={sending ? 'progress_activity' : 'expand_less'}
            size={16}
            className={cn(sending && 'animate-spin')}
          />
        </Button>
      </div>
    </form>
  )

  return (
    <section
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground',
        className,
      )}
      aria-label={title ?? t('agent')}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <AgentAvatar size={36} className="shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{title ?? t('agent')}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
        {actions && <div className="ms-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-8">
          <AgentAvatar size={48} />
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-base font-medium">{t('greeting')}</span>
            <span className="text-xs text-muted-foreground">{emptyHint ?? t('empty')}</span>
          </div>
          <div className="w-full max-w-sm">{composer(false)}</div>
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            {messages.map((message) => {
              const outgoing = message.role === 'user'
              return (
                <div key={message.id} className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground/80">{labelFor(message)}</span>
                    {message.createdAt && <span className="ms-auto shrink-0 tabular-nums">{message.createdAt}</span>}
                  </div>

                  <div className={cn('flex min-w-0 items-start gap-2', outgoing && 'flex-row-reverse')}>
                    {!outgoing && !message.avatarUrl ? (
                      <AgentAvatar size={28} className="mt-0.5 shrink-0" />
                    ) : (
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
                        {message.avatarUrl ? (
                          <img src={message.avatarUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <AppIcon name="person" size={14} />
                        )}
                      </span>
                    )}

                    <div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1.5', outgoing && 'items-end')}>
                      <div
                        className={cn(
                          'min-w-0 rounded-2xl px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
                          outgoing ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                          message.error && 'border border-destructive/40 bg-destructive/10 text-destructive',
                        )}
                      >
                        {message.pending ? (
                          <span className="inline-flex items-center gap-1" aria-label={t('typing')}>
                            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-current" />
                          </span>
                        ) : (
                          message.content
                        )}
                      </div>

                      {message.attachments?.map((attachment) => (
                        <div
                          key={attachment.name}
                          className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs"
                        >
                          <AppIcon name="description" size={14} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{attachment.name}</span>
                          {attachment.size && (
                            <span className="shrink-0 text-muted-foreground">{attachment.size}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {composer(true)}
        </>
      )}
    </section>
  )
}
