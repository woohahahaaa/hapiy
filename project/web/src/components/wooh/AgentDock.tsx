import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { AgentPanel } from '@/components/wooh/AgentPanel'
import type { AgentChatMessage } from '@/components/wooh/AgentPanel'
import {
  AGENT_DOCK_SPLITTER_WIDTH,
  AGENT_DOCK_STORAGE_KEY,
  AgentDockContext,
  useAgentDock,
} from '@/components/wooh/agent-dock-context'
import type { AgentDockContextValue } from '@/components/wooh/agent-dock-context'

const DEFAULT_DOCK_WIDTH = 360
// 低于这个宽度就不显示了：拖过阈值直接收到 0，避免留一条夹不紧的窄缝。
const MIN_DOCK_WIDTH = 320
const KEYBOARD_STEP = 24

// 侧边栏展开宽度与 AppShell 的 `--sidebar-width: calc(var(--spacing) * 64)`
// 对齐（16rem）。右侧面板再宽也不盖住侧边栏。
const SIDEBAR_EXPANDED_REM = 16

function remToPx(rem: number): number {
  if (typeof window === 'undefined') return rem * 16
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return rem * (Number.isFinite(root) && root > 0 ? root : 16)
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DOCK_WIDTH
  try {
    const raw = window.localStorage.getItem(AGENT_DOCK_STORAGE_KEY)
    if (raw === null) return DEFAULT_DOCK_WIDTH
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return DEFAULT_DOCK_WIDTH
    const rounded = Math.round(value)
    return rounded > 0 && rounded < MIN_DOCK_WIDTH ? 0 : rounded
  } catch {
    return DEFAULT_DOCK_WIDTH
  }
}

function clockNow(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// AgentDockProvider owns the width (persisted per browser), the drag state and
// the conversation. The panel sits on the right edge, so the width only eats
// into the content area — the sidebar keeps its place.
export function AgentDockProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('agentPanel')
  const [width, setWidthState] = useState<number>(readStoredWidth)
  const [dragging, setDragging] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )
  const [messages, setMessages] = useState<readonly AgentChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const lastNonZero = useRef(width > 0 ? width : DEFAULT_DOCK_WIDTH)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)

  // Remember the last visible width so the sidebar button restores it rather
  // than always snapping back to the default.
  useEffect(() => {
    if (width >= MIN_DOCK_WIDTH) lastNonZero.current = width
  }, [width])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 面板在最右边，上限是「视口 - 展开的侧边栏 - 分隔条」：拖到头时内容区
  // 被盖完，但侧边栏始终可用。
  const maxWidth = Math.max(
    0,
    viewportWidth - remToPx(SIDEBAR_EXPANDED_REM) - AGENT_DOCK_SPLITTER_WIDTH,
  )

  const setWidth = useCallback(
    (next: number) => {
      const limited = Math.max(0, Math.min(Math.round(next), maxWidth))
      // 小于最小宽度视为要关掉，而不是留一条窄缝。
      const clamped = limited > 0 && limited < MIN_DOCK_WIDTH ? 0 : limited
      setWidthState(clamped)
      try {
        window.localStorage.setItem(AGENT_DOCK_STORAGE_KEY, String(clamped))
      } catch {
        // 隐私模式下 localStorage 可能不可写，宽度仍按内存值生效。
      }
    },
    [maxWidth],
  )

  // 视口变窄时按可用上限显示，但不改写用户存下来的宽度：窗口再变宽时
  // 面板会回到原来的宽度。
  const visibleWidth = Math.max(0, Math.min(width, maxWidth))

  const openDock = useCallback(() => {
    setWidth(Math.max(lastNonZero.current, MIN_DOCK_WIDTH))
  }, [setWidth])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      seq.current += 1
      const id = seq.current
      const createdAt = clockNow()
      setMessages((current) => [
        ...current,
        { id: `u-${id}`, role: 'user', content: trimmed, createdAt },
      ])
      setSending(true)
      clearTimeout(replyTimer.current)
      // TODO: 接入真实对话后端（/v1/chat/completions 流式）。在那之前只回一条
      // 明确的提示，不伪造模型输出。
      replyTimer.current = setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: `a-${id}`,
            role: 'agent',
            author: 'hapiy',
            content: t('notWired'),
            error: true,
            createdAt: clockNow(),
          },
        ])
        setSending(false)
      }, 450)
    },
    [t],
  )

  useEffect(() => () => clearTimeout(replyTimer.current), [])

  const value = useMemo<AgentDockContextValue>(
    () => ({
      width: visibleWidth,
      maxWidth,
      dragging,
      messages,
      sending,
      setWidth,
      setDragging,
      openDock,
      send,
    }),
    [visibleWidth, maxWidth, dragging, messages, sending, setWidth, openDock, send],
  )

  return <AgentDockContext.Provider value={value}>{children}</AgentDockContext.Provider>
}

// AgentDock renders the panel itself. Mobile keeps the existing layout: the
// dock is desktop-only for now.
export function AgentDock() {
  const { t } = useTranslation('agentPanel')
  const { width, dragging, messages, sending, send } = useAgentDock()

  // 收起/展开时整条（分隔条 + 面板）一起做宽度过渡；拖动过程中关掉过渡，
  // 否则面板会追着指针慢半拍。
  return (
    <div
      className={cn(
        'hidden min-h-0 shrink-0 overflow-hidden md:flex',
        !dragging && 'transition-[width] duration-200 ease-linear',
      )}
      style={{ width: width > 0 ? width + AGENT_DOCK_SPLITTER_WIDTH : 0 }}
    >
      {(width > 0 || dragging) && <AgentDockSplitter />}
      <div className="min-h-0 min-w-0 p-2 pl-0" style={{ width }}>
        <AgentPanel
          className="h-full w-full"
          title="Agent"
          subtitle={t('subtitle')}
          messages={messages}
          onSend={send}
          sending={sending}
        />
      </div>
    </div>
  )
}

// AgentDockSplitter is the drag handle on the panel's left edge.
export function AgentDockSplitter() {
  const { t } = useTranslation('agentPanel')
  const { width, maxWidth, setWidth, setDragging } = useAgentDock()
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize')}
      aria-valuemin={0}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: width }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        // 面板在右侧：指针往左拖变大。
        setWidth(current.startWidth + (current.startX - event.clientX))
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        drag.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={(event) => {
        if (!drag.current) return
        drag.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        setWidth(width + (event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP))
      }}
      className="group hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:flex"
    >
      {/* 与转发规则页的分隔条同规格（4px 粗、40px 长、8px 热区），但底色用
          muted-foreground：面板停在外壳的 sidebar 底色上，bg-border 在这里
          几乎看不见，看起来就像只在 hover 时才出现。 */}
      <span className="h-10 w-1 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-muted-foreground/65 group-active:bg-muted-foreground/80" />
    </div>
  )
}
