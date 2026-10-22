import type { CSSProperties, ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentDock, AgentDockProvider } from '@/components/wooh/AgentDock'
import { AppSidebar } from '@/components/wooh/Sidebar'

interface AppShellProps {
  children: ReactNode
}

// ShellBody lays the chat panel out to the left of the sidebar: panel,
// splitter, sidebar, page. Persistence and sizing live in AgentDockProvider.
function ShellBody({ children }: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border），
          fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
      <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
      <AgentDock />
      <AppSidebar />
      <SidebarInset className="overflow-hidden">{children}</SidebarInset>
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
