import type { ReactNode } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/Sidebar'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-background">
        {/* 视口四周内描边：与侧边栏/内容区分割线同色（border-border/80），
            fixed + inset 覆盖浏览器可视框，pointer-events-none 不挡交互 */}
        <div className="pointer-events-none fixed inset-0 z-[60] ring-1 ring-border/80 ring-inset" aria-hidden="true" />
        <AppSidebar />
        <main className="flex min-h-svh min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </SidebarProvider>
  )
}
