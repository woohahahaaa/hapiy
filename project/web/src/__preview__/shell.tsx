// 外壳预览：真实 AppSidebar + AgentDock + 内容区，用来量两边的头部中心线。
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import '@/index.css'
import '@/i18n/i18n'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentDock, AgentDockProvider } from '@/components/wooh/AgentDock'
import { AppSidebar } from '@/components/wooh/Sidebar'
import { ThemeProvider } from '@/components/wooh/theme-provider'

window.localStorage.setItem('agent_dock_width', '520')

const providerStyle = {
  '--sidebar-width': 'calc(var(--spacing) * 64)',
  '--header-height': 'calc(var(--spacing) * 12)',
} as React.CSSProperties

function Measure() {
  const [data, setData] = useState('')
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const center = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { y: Math.round(r.y), h: Math.round(r.height), c: Math.round(r.y + r.height / 2) }
      }
      const buttons = [...document.querySelectorAll('button')]
      const consoleButton = buttons.find((b) => b.textContent?.includes('管理面板')) ?? null
      const sidebarChat = buttons.find((b) => b.textContent?.includes('Agent面板')) ?? null
      setData(JSON.stringify({
        consoleButton: center(consoleButton),
        sidebarChat: center(sidebarChat),
        logo: center(document.querySelector('button[title^="hapiy v"]')),
        trigger: center(document.querySelector('[data-slot="sidebar-header"] [data-slot="sidebar-trigger"]')),
        sidebarHeader: center(document.querySelector('[data-slot="sidebar-header"]')),
      }))
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return <pre id="measure">{data}</pre>
}

function PreviewApp() {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <SidebarProvider style={providerStyle}>
          <AgentDockProvider>
            <div className="flex h-svh w-full overflow-hidden">
              <AgentDock />
              <AppSidebar />
              <SidebarInset />
            </div>
          </AgentDockProvider>
        </SidebarProvider>
      </ThemeProvider>
      <Measure />
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
)
