import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { dashboardApi } from '@/lib/dashboard-api'

export const DEBUG_FLOW_LIGHTS_KEY = 'debug_flow_lights'
export const DEBUG_NODE_INFO_KEY = 'debug_executor_node_info'

function DebugToggle({
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
      <div className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{description}</div>
    </div>
  )
}

export function DebugSettings() {
  const { t } = useTranslation('settings')
  const [flowLights, setFlowLights] = useState(false)
  const [nodeInfo, setNodeInfo] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        const find = (key: string) => settings.find((s) => s.key === key)?.value === 'true'
        setFlowLights(find(DEBUG_FLOW_LIGHTS_KEY))
        setNodeInfo(find(DEBUG_NODE_INFO_KEY))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = (key: string, next: boolean) => {
    if (key === DEBUG_FLOW_LIGHTS_KEY) setFlowLights(next)
    if (key === DEBUG_NODE_INFO_KEY) setNodeInfo(next)
    void dashboardApi.updateSetting(key, String(next)).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-none border border-border bg-card p-4">
        <DebugToggle
          title={t('debug.nodeInfoTitle')}
          description={t('debug.nodeInfoDescription')}
          checked={loaded && nodeInfo}
          onChange={(v) => handleToggle(DEBUG_NODE_INFO_KEY, v)}
        />
      </div>
      <div className="rounded-none border border-border bg-card p-4">
        <DebugToggle
          title={t('debug.flowLightsTitle')}
          description={t('debug.flowLightsDescription')}
          checked={loaded && flowLights}
          onChange={(v) => handleToggle(DEBUG_FLOW_LIGHTS_KEY, v)}
        />
      </div>
    </div>
  )
}