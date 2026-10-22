import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AgentChat } from '@/components/wooh/AgentChat'
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

// 侧边栏尺寸与 AppShell 的 `--sidebar-width: calc(var(--spacing) * 64)`
// 和 ui/sidebar 的 SIDEBAR_WIDTH_ICON 对齐：
//   展开 = 16rem；收起（variant=inset）= 2.5rem 图标 + 1.5rem 内边距 = 4rem。
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

// AgentDockProvider owns the width (persisted per browser), the drag state and
// the conversation. The panel sits on the right edge, so the width only eats
// into the content area — the sidebar keeps its place.
export function AgentDockProvider({ children }: { children: ReactNode }) {
  const [width, setWidthState] = useState<number>(readStoredWidth)
  const [dragging, setDragging] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 面板最宽可以铺满整行（此时右侧整体被折叠）。
  const maxWidth = Math.max(0, viewportWidth - AGENT_DOCK_SPLITTER_WIDTH)
  const expandedPx = remToPx(SIDEBAR_EXPANDED_REM)

  const setWidth = useCallback(
    (next: number) => {
      const limited = Math.max(0, Math.min(Math.round(next), maxWidth))
      // 小于最小宽度视为要关掉，而不是留一条窄缝。
      let clamped = limited > 0 && limited < MIN_DOCK_WIDTH ? 0 : limited
      // 右侧剩下的宽度已经放不下展开的侧边栏：整块折叠，面板铺满。
      if (clamped > 0 && maxWidth - clamped < expandedPx) clamped = maxWidth
      setWidthState(clamped)
      try {
        window.localStorage.setItem(AGENT_DOCK_STORAGE_KEY, String(clamped))
      } catch {
        // 隐私模式下 localStorage 可能不可写，宽度仍按内存值生效。
      }
    },
    [maxWidth, expandedPx],
  )

  // 视口变窄时按可用上限显示，但不改写用户存下来的宽度：窗口再变宽时
  // 面板会回到原来的宽度。
  const visibleWidth = Math.max(0, Math.min(width, maxWidth))

  const rightCollapsed = visibleWidth > 0 && maxWidth - visibleWidth < expandedPx

  // 展开左边或右边时统一按 50/50，且给右侧至少留出展开侧边栏的宽度。
  const openHalf = useCallback(() => {
    const half = Math.round((viewportWidth - AGENT_DOCK_SPLITTER_WIDTH) / 2)
    setWidth(Math.max(MIN_DOCK_WIDTH, Math.min(half, maxWidth - expandedPx)))
  }, [setWidth, viewportWidth, maxWidth, expandedPx])

  const openDock = openHalf
  const expandRight = openHalf


  const value = useMemo<AgentDockContextValue>(
    () => ({
      width: visibleWidth,
      maxWidth,
      dragging,
      setWidth,
      setDragging,
      openDock,
      rightCollapsed,
      expandRight,
    }),
    [visibleWidth, maxWidth, dragging, setWidth, setDragging, openDock, rightCollapsed, expandRight],
  )

  return <AgentDockContext.Provider value={value}>{children}</AgentDockContext.Provider>
}

// AgentDock renders the panel itself. Mobile keeps the existing layout: the
// dock is desktop-only for now.
export function AgentDock() {
  const { width, dragging } = useAgentDock()

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
      <div className="min-h-0 min-w-0 p-2 pr-0" style={{ width }}>
        <AgentChat className="h-full w-full" />
      </div>
      {(width > 0 || dragging) && <AgentDockSplitter />}
    </div>
  )
}

// AgentDockSplitter is the drag handle on the panel's right edge.
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
        // 面板在左侧：指针往右拖变大。
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
      className="group hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:flex"
    >
      {/* 与转发规则页的分隔条同规格（4px 粗、40px 长、8px 热区），但底色用
          muted-foreground：面板停在外壳的 sidebar 底色上，bg-border 在这里
          几乎看不见，看起来就像只在 hover 时才出现。 */}
      <span className="h-10 w-1 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-muted-foreground/65 group-active:bg-muted-foreground/80" />
    </div>
  )
}
