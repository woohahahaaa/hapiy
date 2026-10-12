import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { dashboardApi } from '@/lib/dashboard-api'

export const AGENT_ENABLED_SETTING_KEY = 'debug_agent_enabled'

function OtherToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{title}</div>
        <Switch
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={title}
          className="shrink-0"
        />
      </div>
      <div className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

export function OtherSettings() {
  const { t } = useTranslation('settings')
  const [agentEnabled, setAgentEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        setAgentEnabled(settings.find((s) => s.key === AGENT_ENABLED_SETTING_KEY)?.value === 'true')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = (next: boolean) => {
    setAgentEnabled(next)
    void dashboardApi.updateSetting(AGENT_ENABLED_SETTING_KEY, String(next)).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-none border border-border bg-card p-4">
        <OtherToggle
          title={t('other.title')}
          description={t('other.toggleDescription')}
          checked={loaded && agentEnabled}
          onChange={handleToggle}
        />
      </div>
    </div>
  )
}