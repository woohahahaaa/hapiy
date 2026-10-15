import type { CSSProperties, ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/wooh/Sidebar'

interface AppShellProps {
  children: ReactNode
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
      {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border），
          fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
      <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
      <AppSidebar />
      <SidebarInset className="overflow-hidden">{children}</SidebarInset>
    </SidebarProvider>
  )
}
