// 侧边栏对齐预览：?collapsed=1 渲染折叠态，否则展开态。用真实 AppSidebar。
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

function PreviewApp() {
  const collapsed = new URLSearchParams(window.location.search).get('collapsed') === '1'
  return (
    <MemoryRouter>
      <ThemeProvider>
        <SidebarProvider defaultOpen={!collapsed} style={providerStyle}>
          <AgentDockProvider>
            <AppSidebar />
          </AgentDockProvider>
        </SidebarProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
