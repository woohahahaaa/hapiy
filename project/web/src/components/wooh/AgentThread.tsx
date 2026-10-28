import { Fragment, useEffect, useMemo, useRef } from 'react'
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
import type { Components } from 'react-markdown'
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

// Brand word in the greeting uses the logo face, everything else stays in the UI font.
const brandWord = 'hapiy'

function GreetingTitle({ text }: { text: string }) {
  return (
    <>
      {text.split(/(hapiy)/i).map((part, index) =>
        part.toLowerCase() === brandWord ? (
          <span key={index} className="font-hapiy-logo text-[1.35em] font-normal">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

const markdownClass =
  'text-sm leading-6 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-4 ' +
  '[&_li]:my-0.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/60 ' +
  '[&_pre]:p-2 [&_code]:font-mono [&_code]:text-xs [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground ' +
  '[&_table]:w-full [&_table]:min-w-full [&_table]:border-collapse ' +
  '[&_thead]:bg-muted/60 ' +
  '[&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-middle [&_th]:font-medium ' +
  '[&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top ' +
  '[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:nth-child(even)]:bg-muted/20'

// markdownComponents wraps wide tables in a scroll container so a gateway
// listing cannot stretch the chat column or drop its borders.
const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="my-2 w-full overflow-x-auto rounded-lg border border-border">
      <table {...props} />
    </div>
  ),
}

// AssistantText renders markdown once tokens arrive and the typing dots while
// the reply is still empty (our backend answers in one shot, so the bubble
// exists but stays blank until the request finishes).
function AssistantText() {
  const text = useAuiState((s) => (s.part?.type === 'text' ? s.part.text : ''))
  if (!text) return <TypingDots />
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className={markdownClass}
      components={markdownComponents}
    />
  )
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
  message,
}: {
  readonly role: 'user' | 'assistant' | 'system'
  readonly message: ThreadMessage
}) {
  const { t } = useTranslation('agentPanel')
  const outgoing = role === 'user'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(messageText(message))
      toast(t('copied'))
    } catch {
      toast(t('copyFailed'))
    }
  }

  return (
    <MessagePrimitive.Root
      className={cn(
        'group mb-5 flex min-w-0 flex-col',
        outgoing ? 'items-end' : 'items-start',
      )}
    >
      <div
        className={cn(
          'min-w-0',
          outgoing
            ? 'max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-foreground'
            : 'w-full text-foreground',
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
            className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <AppIcon name="more_horiz" size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onSelect={() => void copy()}>
            <AppIcon name="content_copy" size={14} />
            <span>{t('copy')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </MessagePrimitive.Root>
  )
}

function Composer({
  toolbar,
  controls,
}: {
  readonly toolbar?: ReactNode
  readonly controls?: ReactNode
}) {
  const { t } = useTranslation('agentPanel')
  return (
    <ComposerPrimitive.Root
      className={
        // Two rows in one box: the input grows upward, while the tool row keeps
        // the mode switch, model/thinking chips and the send button in a fixed
        // line at the bottom.
        'flex w-full flex-col rounded-2xl border border-border bg-background p-2 shadow-sm'
      }
    >
      <ComposerPrimitive.Input
        placeholder={t('placeholder')}
        rows={1}
        className="min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">{toolbar}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {controls}
          <ComposerPrimitive.Send asChild>
            <Button size="icon-sm" className="shrink-0 rounded-full" aria-label={t('send')}>
              <AppIcon name="expand_less" size={16} strokeWidth={5} />
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </div>
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
  /** Composer controls on the right of the tool row (chat/execute switch). */
  readonly controls?: ReactNode
  readonly initialMessages: readonly ChatMessageRecord[]
  /** Sends the turn through the backend; resolves with the assistant text. */
  readonly onSend: (text: string) => Promise<string>
  /** Rendered on the left of the tool row on both composers (model/thinking chips). */
  readonly composerToolbar?: ReactNode
  readonly actions?: ReactNode
}

// Empty-state prompts run simple → concrete: the first few answer "what is
// this and how do I start", the rest walk the help doc's eight real-world
// scenarios, one or two prompts each. Every prompt is shown at once; the list
// scrolls inside the empty state instead of hiding entries behind a shuffle.
const suggestions: readonly string[] = [
  'intro1',
  'intro2',
  'intro3',
  'intro4',
  'suggestion1',
  'suggestion2',
  'suggestion3',
  'suggestion4',
  'suggestion5',
  'suggestion6',
  'suggestion7',
  'suggestion8',
  'suggestion9',
  'suggestion10',
  'suggestion11',
  'suggestion12',
  'suggestion13',
  'suggestion14',
]

// AgentThread is the ChatGPT-style transcript + composer, built on
// assistant-ui primitives. The backend stays the source of truth: history is
// passed in as initialMessages and each run is sent through onSend.
export function AgentThread({ title, controls, initialMessages, onSend, composerToolbar, actions }: AgentThreadProps) {
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
      async *run({ messages, abortSignal }) {
        const text = lastUserText(messages)
        if (!text.trim()) return
        try {
          const reply = await sendRef.current(text)
          // Typewriter effect: the backend answers in one shot, so grow the
          // assistant message over a few hundred frames instead of dropping the
          // whole block in at once. Long replies use bigger steps so the total
          // reveal stays under ~4s.
          const chars = Array.from(reply)
          const step = Math.max(1, Math.ceil(chars.length / 200))
          for (let end = step; end < chars.length; end += step) {
            if (abortSignal.aborted) return
            yield { content: [{ type: 'text', text: chars.slice(0, end).join('') }] }
            await new Promise((resolve) => setTimeout(resolve, 18))
          }
          yield { content: [{ type: 'text', text: reply }] }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          yield {
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
          <div className="flex min-w-0 flex-1" />
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>

        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="m-auto w-full max-w-lg text-center">
                  <h2 className="text-[28px] leading-tight font-semibold tracking-tight text-balance">
                    <GreetingTitle text={t('greetingTitle')} />
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {t('greetingSubtitle')}
                    <br />
                    {t('suggestedLabel')}
                  </p>
                  <div className="mt-2">
                    <div className="flex flex-wrap justify-center gap-2">
                      {suggestions.map((key) => (
                        <ThreadPrimitive.Suggestion
                          key={key}
                          prompt={t(key)}
                          send
                          className="max-w-full whitespace-normal rounded-lg border border-border bg-background px-3 py-2 text-center text-sm text-foreground transition-colors hover:bg-accent"
                        >
                          {t(key)}
                        </ThreadPrimitive.Suggestion>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-4 pb-3">
                <div className="mx-auto w-full max-w-2xl">
                  <Composer toolbar={composerToolbar} controls={controls} />
                </div>
              </div>
            </div>
          </AuiIf>

          <AuiIf condition={(state) => !state.thread.isEmpty}>
            <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
              <div className="mx-auto w-full max-w-2xl">
                <ThreadPrimitive.Messages>
                  {({ message }) => (
                    <MessageRow role={message.role} message={message} />
                  )}
                </ThreadPrimitive.Messages>
              </div>
            </ThreadPrimitive.Viewport>
            <div className="px-4 py-3">
              <div className="mx-auto w-full max-w-2xl">
                <Composer toolbar={composerToolbar} controls={controls} />
              </div>
            </div>
          </AuiIf>
        </ThreadPrimitive.Root>
      </section>
    </AssistantRuntimeProvider>
  )
}
