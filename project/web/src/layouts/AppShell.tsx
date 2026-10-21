import type { CSSProperties, ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentDock, AgentDockProvider, AgentDockSplitter, useAgentDock } from '@/components/wooh/AgentDock'
import { AppSidebar } from '@/components/wooh/Sidebar'

interface AppShellProps {
  children: ReactNode
}

// ShellBody lays the chat panel out to the left of the sidebar. The sidebar
// itself is fixed-positioned by ui/sidebar, so AppSidebar receives the panel
// width through context and offsets itself by the same amount.
function ShellBody({ children }: AppShellProps) {
  const { width, dragging } = useAgentDock()

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border），
          fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
      <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
      {width > 0 && <AgentDock />}
      {/* 拖到 0 的那一下仍然保留分隔条，否则指针捕获会随面板卸载而丢失。 */}
      {(width > 0 || dragging) && <AgentDockSplitter />}
      <div className="flex min-h-0 min-w-0 flex-1">
        <AppSidebar />
        <SidebarInset className="overflow-hidden">{children}</SidebarInset>
      </div>
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
