import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: React.ReactNode
}

const mobileQuery = '(max-width: 1024px)'

export function AppShell({ children }: AppShellProps) {
  const [expanded, setExpanded] = useState(() => !window.matchMedia(mobileQuery).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileQuery)
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setExpanded(false)
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      <main
        className={cn(
          'min-h-screen transition-all duration-300',
          expanded ? 'lg:ml-64' : 'lg:ml-16'
        )}
      >
        {children}
      </main>
    </div>
  )
}
