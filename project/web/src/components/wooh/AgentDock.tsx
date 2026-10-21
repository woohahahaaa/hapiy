import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSidebar } from '@/components/ui/sidebar'
import { AgentPanel } from '@/components/wooh/AgentPanel'
import type { AgentChatMessage } from '@/components/wooh/AgentPanel'

// 对话面板宽度只存在本机浏览器里（每个浏览器各自一份），不进后端设置。
export const AGENT_DOCK_STORAGE_KEY = 'agent_dock_width'
// 分隔条宽度（px）。侧边菜单是 fixed 定位，左侧偏移量要把这段宽度算进去。
export const AGENT_DOCK_SPLITTER_WIDTH = 8
const DEFAULT_DOCK_WIDTH = 360
const KEYBOARD_STEP = 24

// 侧边栏尺寸与 AppShell 的 `--sidebar-width: calc(var(--spacing) * 64)`
// 和 ui/sidebar 的 SIDEBAR_WIDTH_ICON 对齐：
//   展开 = 16rem；收起（variant=inset）= 2.5rem 图标 + 1.5rem 内边距 = 4rem。
const SIDEBAR_EXPANDED_REM = 16
const SIDEBAR_COLLAPSED_REM = 4

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
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : DEFAULT_DOCK_WIDTH
  } catch {
    return DEFAULT_DOCK_WIDTH
  }
}

function clockNow(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

type AgentDockContextValue = {
  readonly width: number
  readonly maxWidth: number
  readonly dragging: boolean
  readonly messages: readonly AgentChatMessage[]
  readonly sending: boolean
  readonly setWidth: (next: number) => void
  readonly setDragging: (next: boolean) => void
  readonly openDock: () => void
  readonly send: (text: string) => void
}

const AgentDockContext = createContext<AgentDockContextValue | null>(null)

export function useAgentDock(): AgentDockContextValue {
  const value = useContext(AgentDockContext)
  if (!value) throw new Error('useAgentDock must be used inside AgentDockProvider')
  return value
}

// AgentDockProvider owns the width (persisted per browser), the drag state and
// the conversation. It also enforces the layout rule: as soon as the area to
// the right of the panel is narrower than the expanded sidebar, the sidebar
// collapses to icons.
export function AgentDockProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('agentPanel')
  const { setOpen } = useSidebar()
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
    if (width > 0) lastNonZero.current = width
  }, [width])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 右侧至少要留出「收起后的侧边栏」宽度，所以面板的上限由视口决定。
  const maxWidth = Math.max(0, viewportWidth - remToPx(SIDEBAR_COLLAPSED_REM))

  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(Math.round(next), maxWidth))
      setWidthState(clamped)
      try {
        window.localStorage.setItem(AGENT_DOCK_STORAGE_KEY, String(clamped))
      } catch {
        // 隐私模式下 localStorage 可能不可写，宽度仍按内存值生效。
      }
    },
    [maxWidth],
  )

  // 视口变窄时把已经超出的宽度收回来。
  useEffect(() => {
    if (width > maxWidth) setWidthState(maxWidth)
  }, [width, maxWidth])

  const occupied = width > 0 ? width + AGENT_DOCK_SPLITTER_WIDTH : 0
  const rightWidth = Math.max(0, viewportWidth - occupied)

  // 右侧整体窄于展开状态的侧边栏时，直接收起。只跟随宽度变化触发，
  // 用户手动展开不会被立刻打回，直到下一次拖动改变可用宽度。
  useEffect(() => {
    if (rightWidth > 0 && rightWidth < remToPx(SIDEBAR_EXPANDED_REM)) setOpen(false)
  }, [rightWidth, setOpen])

  const openDock = useCallback(() => {
    setWidth(Math.max(lastNonZero.current, Math.round(remToPx(12))))
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
    () => ({ width, maxWidth, dragging, messages, sending, setWidth, setDragging, openDock, send }),
    [width, maxWidth, dragging, messages, sending, setWidth, openDock, send],
  )

  return <AgentDockContext.Provider value={value}>{children}</AgentDockContext.Provider>
}

// AgentDock renders the panel itself. Mobile keeps the existing layout: the
// dock is desktop-only for now.
export function AgentDock() {
  const { t } = useTranslation('agentPanel')
  const { width, messages, sending, send } = useAgentDock()

  return (
    <div className="hidden min-h-0 shrink-0 p-2 pr-0 md:flex" style={{ width }}>
      <AgentPanel
        className="h-full"
        title="hapiy"
        subtitle={t('subtitle')}
        messages={messages}
        onSend={send}
        sending={sending}
      />
    </div>
  )
}

// AgentDockSplitter is the drag handle between the panel and the sidebar.
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
        setWidth(current.startWidth + (event.clientX - current.startX))
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
        setWidth(width + (event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP))
      }}
      className="group hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:flex"
    >
      <span className="h-10 w-px rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50 group-active:bg-muted-foreground/70" />
    </div>
  )
}
