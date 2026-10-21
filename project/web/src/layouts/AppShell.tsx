import type { CSSProperties, ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentDock, AgentDockProvider, AgentDockSplitter } from '@/components/wooh/AgentDock'
import { useAgentDock } from '@/components/wooh/agent-dock-context'
import { AppSidebar } from '@/components/wooh/Sidebar'

interface AppShellProps {
  children: ReactNode
}

// ShellBody lays the chat panel out to the right of the content: sidebar,
// page, splitter, panel. Persistence and sizing live in AgentDockProvider.
function ShellBody({ children }: AppShellProps) {
  const { width, dragging } = useAgentDock()

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border），
          fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
      <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
      <AppSidebar />
      <SidebarInset className="overflow-hidden">{children}</SidebarInset>
      {/* 拖到 0 的那一下仍然保留分隔条，否则指针捕获会随面板卸载而丢失。 */}
      {(width > 0 || dragging) && <AgentDockSplitter />}
      {width > 0 && <AgentDock />}
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 64)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AgentDockProvider>
        <ShellBody>{children}</ShellBody>
      </AgentDockProvider>
    </SidebarProvider>
  )
}
