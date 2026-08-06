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
        <AppSidebar />
        <main className="flex min-h-svh min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </SidebarProvider>
  )
}
