import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import remarkGfm from 'remark-gfm'
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { ChatModelAdapter, ThreadMessage, ThreadMessageLike } from '@assistant-ui/react'
import { AgentAvatar } from '@/components/wooh/AgentAvatar'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { ChatMessageRecord } from '@/lib/dashboard-api'

const markdownClass =
  'text-[15px] leading-relaxed [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-4 ' +
  '[&_li]:my-0.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/60 ' +
  '[&_pre]:p-2 [&_code]:font-mono [&_code]:text-xs [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground'

// AssistantText renders markdown once tokens arrive and the typing dots while
// the reply is still empty (our backend answers in one shot, so the bubble
// exists but stays blank until the request finishes).
function AssistantText() {
  const text = useAuiState((s) => (s.part?.type === 'text' ? s.part.text : ''))
  if (!text) return <TypingDots />
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className={markdownClass} />
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="typing">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  )
}

// messageText flattens the text parts so the copy action works for both the
// user's own turns and the assistant's markdown reply.
function messageText(message: ThreadMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

function MessageRow({
  role,
  createdAt,
  message,
}: {
  readonly role: 'user' | 'assistant' | 'system'
  readonly createdAt: Date
  readonly message: ThreadMessage
}) {
  const { t } = useTranslation('agentPanel')
  const outgoing = role === 'user'
  const time = createdAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const label = outgoing ? t('you') : t('agent')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(messageText(message))
      toast(t('copied'))
    } catch {
      toast(t('copyFailed'))
    }
  }

  return (
    <MessagePrimitive.Root className="group mb-4 flex min-w-0 flex-col gap-1">
      <div
        className={cn(
          'flex w-full items-center gap-2 px-1 text-xs text-muted-foreground',
          outgoing && 'justify-end',
        )}
      >
        <span className="truncate font-medium text-foreground/80">{label}</span>
        <span className={cn('shrink-0 tabular-nums', !outgoing && 'ms-auto')}>{time}</span>
      </div>
      <div
        className={cn(
          'flex min-w-0 max-w-[80%] flex-col',
          outgoing ? 'items-end self-end' : 'items-start self-start',
        )}
      >
        <div
          className={cn(
            'min-w-0 rounded-2xl px-4 py-2.5',
            outgoing ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          )}
        >
          <MessagePrimitive.Parts components={{ Text: AssistantText }} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('messageActions')}
              className="mt-1 shrink-0 text-muted-foreground opacity-100 transition-opacity data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <AppIcon name="more_horiz" size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onSelect={() => void copy()}>
              <AppIcon name="content_copy" size={14} />
              <span>{t('copy')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </MessagePrimitive.Root>
  )
}

function Composer({ centered = false }: { readonly centered?: boolean }) {
  const { t } = useTranslation('agentPanel')
  return (
    <ComposerPrimitive.Root
      className={cn(
        // The send button is bottom-aligned. One line of input is exactly the
        // button height (40px: 24px line-height + py-2), so a single line reads
        // as vertically centred while a grown box puts the button bottom-right.
        'flex w-full items-end gap-2 bg-card',
        centered
          ? 'rounded-3xl border border-border p-2 pl-4 shadow-sm'
          : 'rounded-3xl border border-border p-2 pl-3',
      )}
    >
      <ComposerPrimitive.Input
        placeholder={t('placeholder')}
        rows={1}
        className="min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      <ComposerPrimitive.Send asChild>
        <Button size="icon" className="size-10 shrink-0 rounded-full" aria-label={t('send')}>
          <AppIcon name="expand_less" size={20} strokeWidth={5} />
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  )
}

function lastUserText(messages: readonly ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    return message.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
  }
  return ''
}

export type AgentThreadProps = {
  /** Used as the accessible name only; the header shows the avatar. */
  readonly title: string
  /** Header content to the right of the avatar (model/provider selectors). */
  readonly controls?: ReactNode
  readonly initialMessages: readonly ChatMessageRecord[]
  /** Sends the turn through the backend; resolves with the assistant text. */
  readonly onSend: (text: string) => Promise<string>
  readonly actions?: ReactNode
}

// AgentThread is the ChatGPT-style transcript + composer, built on
// assistant-ui primitives. The backend stays the source of truth: history is
// passed in as initialMessages and each run is sent through onSend.
export function AgentThread({ title, controls, initialMessages, onSend, actions }: AgentThreadProps) {
  const { t } = useTranslation('agentPanel')
  const sendRef = useRef(onSend)
  useEffect(() => {
    sendRef.current = onSend
  }, [onSend])

  const seeds = useMemo<readonly ThreadMessageLike[]>(
    () =>
      initialMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: [{ type: 'text', text: message.content }],
        createdAt: new Date(message.createdAt),
      })),
    [initialMessages],
  )

  const chatModel = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages }) {
        const text = lastUserText(messages)
        if (!text.trim()) return { content: [] }
        try {
          const reply = await sendRef.current(text)
          return { content: [{ type: 'text', text: reply }] }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            content: [{ type: 'text', text: `⚠ ${message}` }],
            status: { type: 'incomplete', reason: 'error' },
          }
        }
      },
    }),
    [],
  )

  const runtime = useLocalRuntime(chatModel, { initialMessages: seeds })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
        aria-label={title}
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <AgentAvatar size={36} className="shrink-0" />
          {controls && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{controls}</div>}
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>

        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
              <h2 className="text-center text-[28px] leading-tight font-semibold tracking-tight">{t('greeting')}</h2>
              <div className="w-full max-w-2xl">
                <Composer centered />
              </div>
            </div>
          </AuiIf>

          <AuiIf condition={(state) => !state.thread.isEmpty}>
            <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
              <ThreadPrimitive.Messages>
                {({ message }) => (
                  <MessageRow role={message.role} createdAt={message.createdAt} message={message} />
                )}
              </ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>
            <div className="border-t border-border p-3">
              <Composer />
            </div>
          </AuiIf>
        </ThreadPrimitive.Root>
      </section>
    </AssistantRuntimeProvider>
  )
}
