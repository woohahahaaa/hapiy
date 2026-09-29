import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { dashboardApi } from '@/lib/dashboard-api'

interface AuthGateProps {
  readonly children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const { t } = useTranslation('common')
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
        <AppIcon name="progress_activity" size={20} className="animate-spin" />
        <span className="ml-2 text-sm">{t('auth.checking')}</span>
      </div>
    )
  }

  return <>{children}</>
}