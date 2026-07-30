import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { dashboardApi } from '@/lib/dashboard-api'

interface LocationState {
  from?: string
}

interface AuthGateProps {
  readonly children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = useState<'checking' | 'ok'>('checking')

  useEffect(() => {
    let cancelled = false
    dashboardApi
      .currentUser()
      .then(() => {
        if (!cancelled) setState('ok')
      })
      .catch(() => {
        if (cancelled) return
        const from = location.pathname + location.search
        navigate('/login', { replace: true, state: { from } })
      })
    return () => {
      cancelled = true
    }
  }, [navigate, location.pathname, location.search])

  if (state === 'checking') {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="ml-2 text-sm">验证登录态…</span>
      </div>
    )
  }

  return <>{children}</>
}