// 侧边栏对齐预览：展开态和折叠态各渲染一份真实 AppSidebar，用来量图标中心线。
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import '@/index.css'
import '@/i18n/i18n'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AgentDockProvider } from '@/components/wooh/AgentDock'
import { AppSidebar } from '@/components/wooh/Sidebar'
import { ThemeProvider } from '@/components/wooh/theme-provider'

const providerStyle = {
  '--sidebar-width': 'calc(var(--spacing) * 64)',
  '--header-height': 'calc(var(--spacing) * 12)',
} as React.CSSProperties

function Panel({ open, label }: { open: boolean; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      {/* transform 让 fixed 的侧边栏相对这个盒子定位，两份才能并排。 */}
      <div className="relative h-[680px] w-72 overflow-hidden bg-sidebar" style={{ transform: 'translateZ(0)' }}>
        <MemoryRouter>
          <ThemeProvider>
            <SidebarProvider defaultOpen={open} style={providerStyle}>
              <AgentDockProvider>
                <AppSidebar />
              </AgentDockProvider>
            </SidebarProvider>
          </ThemeProvider>
        </MemoryRouter>
      </div>
    </div>
  )
}

function PreviewApp() {
  return (
    <div className="min-h-screen bg-neutral-100 p-8 text-foreground dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-lg font-semibold">Sidebar 对齐预览</h1>
        <div className="flex gap-10">
          <Panel open label="展开" />
          <Panel open={false} label="折叠" />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
