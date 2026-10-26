import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { SecretValue } from '@/components/wooh/SecretValue'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { McpStatus } from '@/lib/dashboard-api'

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

// McpSection 管理 /mcp 端点：开关、访问 Key 和地址。Key 只在生成/重置后由
// 后端返回一次并立即展示，页面不缓存到本地存储。
function McpSection() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getMcpStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof DashboardApiError ? err.message : null)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const apply = (next: McpStatus) => {
    setStatus(next)
    setError(null)
  }

  const handleToggle = (next: boolean) => {
    setBusy(true)
    void dashboardApi
      .updateMcpStatus(next)
      .then(apply)
      .catch((err: unknown) => setError(err instanceof DashboardApiError ? err.message : null))
      .finally(() => setBusy(false))
  }

  const handleRotate = () => {
    setBusy(true)
    void dashboardApi
      .rotateMcpKey()
      .then(apply)
      .catch((err: unknown) => setError(err instanceof DashboardApiError ? err.message : null))
      .finally(() => setBusy(false))
  }

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => toast(t('other.mcpCopied')))
  }

  const endpoint = `${window.location.origin}/mcp`
  const enabled = loaded && status?.enabled === true

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <OtherToggle
        title={t('other.mcpTitle')}
        description={t('other.mcpDescription')}
        checked={enabled}
        onChange={handleToggle}
      />

      {error && <div className="mt-3 text-xs text-destructive">{error}</div>}

      {enabled && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-xs">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('other.mcpEndpoint')}</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono">{endpoint}</code>
              <Button size="sm" variant="outline" onClick={() => copy(endpoint)}>
                {t('other.mcpCopy')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('other.mcpKey')}</span>
            <div className="flex items-center gap-2">
              <span className="flex-1 rounded bg-muted px-2 py-1 font-mono">
                {status?.apiKey ? (
                  <SecretValue value={status.apiKey} />
                ) : (
                  <span className="text-muted-foreground">{t('other.mcpKeyEmpty')}</span>
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!status?.apiKey}
                onClick={() => status?.apiKey && copy(status.apiKey)}
              >
                {t('other.mcpCopy')}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={handleRotate}>
                {t('other.mcpRotate')}
              </Button>
            </div>
            <span className="text-muted-foreground">{t('other.mcpRotateHint')}</span>
          </div>

          <span className="text-muted-foreground">{t('other.mcpClients')}</span>
        </div>
      )}
    </div>
  )
}

export function OtherSettings() {
  const { t } = useTranslation('settings')
  const [agentEnabled, setAgentEnabled] = useState(false)
  const [searchUrl, setSearchUrl] = useState('')
  const [searchSaving, setSearchSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        setAgentEnabled(settings.find((s) => s.key === AGENT_ENABLED_SETTING_KEY)?.value === 'true')
        setSearchUrl(settings.find((s) => s.key === 'web_search_url')?.value ?? '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = (next: boolean) => {
    setAgentEnabled(next)
    void dashboardApi.updateSetting(AGENT_ENABLED_SETTING_KEY, String(next)).catch(() => {})
  }

  const saveSearchUrl = () => {
    setSearchSaving(true)
    void dashboardApi
      .updateSetting('web_search_url', searchUrl.trim())
      .then(() => toast(t('other.webSearchSaved')))
      .catch(() => toast(t('other.webSearchSaveFailed')))
      .finally(() => setSearchSaving(false))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <OtherToggle
          title={t('other.title')}
          description={t('other.toggleDescription')}
          checked={loaded && agentEnabled}
          onChange={handleToggle}
        />
      </div>
      <McpSection />
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium">{t('other.webSearchTitle')}</div>
        <div className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
          {t('other.webSearchDescription')}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={searchUrl}
            onChange={(event) => setSearchUrl(event.target.value)}
            placeholder={t('other.webSearchPlaceholder')}
          />
          <Button size="sm" onClick={saveSearchUrl} disabled={searchSaving}>
            {t('common:action.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
