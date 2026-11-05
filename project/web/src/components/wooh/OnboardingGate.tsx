import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AppIcon } from '@/components/wooh/AppIcon'
import { dashboardApi } from '@/lib/dashboard-api'
import { shouldShowOnboarding } from '@/lib/onboarding'

// 进入控制台前检查一次：没有供应商、也没有手动跳过时，强制先走首次引导。
// 检查失败时放行，避免后端暂时不可用把整个控制台挡在外面。
export function OnboardingGate({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      dashboardApi.listProviders({ limit: 1, offset: 0 }),
      dashboardApi.getSettings(),
    ])
      .then(([providers, settings]) => {
        if (cancelled) return
        if (shouldShowOnboarding(providers.total, settings)) {
          navigate('/onboarding', { replace: true })
          return
        }
        setChecking(false)
      })
      .catch(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <AppIcon name="progress_activity" size={20} className="animate-spin" />
        <span className="ml-2 text-sm">{t('checking')}</span>
      </div>
    )
  }

  return <>{children}</>
}
