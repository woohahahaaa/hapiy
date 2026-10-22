import { createContext, useContext } from 'react'

// 对话面板宽度只存在本机浏览器里（每个浏览器各自一份），不进后端设置。
export const AGENT_DOCK_STORAGE_KEY = 'agent_dock_width'
// 分隔条宽度（px）。侧边菜单是 fixed 定位，左侧偏移量要把这段宽度算进去。
export const AGENT_DOCK_SPLITTER_WIDTH = 8

export type AgentDockContextValue = {
  readonly width: number
  readonly maxWidth: number
  readonly dragging: boolean
  readonly setWidth: (next: number) => void
  readonly setDragging: (next: boolean) => void
  readonly openDock: () => void
}

export const AgentDockContext = createContext<AgentDockContextValue | null>(null)

export function useAgentDock(): AgentDockContextValue {
  const value = useContext(AgentDockContext)
  if (!value) throw new Error('useAgentDock must be used inside AgentDockProvider')
  return value
}
