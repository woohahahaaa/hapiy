import { useState, type CSSProperties, type ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentDock, AgentDockProvider } from '@/components/wooh/AgentDock'
import { AppSidebar } from '@/components/wooh/Sidebar'
import { DialogHostProvider } from '@/components/wooh/dialog/host'

interface AppShellProps {
  children: ReactNode
}

// ShellBody lays the chat panel out to the left of the sidebar: panel,
// splitter, sidebar, page. When the panel pushes the sidebar below its
// expanded width the whole right side is removed (and AgentDock takes the
// full row); the expand button restores a 50/50 split. Persistence and
// sizing live in AgentDockProvider.
function ShellBody({ children }: AppShellProps) {
  // Dialogs portal into the management panel, so a modal (or a fullscreen
  // editor) is sized against the panel and leaves the agent chat visible.
  const [dialogHost, setDialogHost] = useState<HTMLElement | null>(null)
  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border），
          fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
      <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
      <AgentDock />
      {/* 右侧始终挂载：折叠时由面板铺满把侧边栏和页面推出视口，
          靠宽度过渡完成收放，不卸载、不闪。 */}
      <AppSidebar />
      <SidebarInset ref={setDialogHost} className="overflow-hidden">
        <DialogHostProvider host={dialogHost}>{children}</DialogHostProvider>
      </SidebarInset>
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
