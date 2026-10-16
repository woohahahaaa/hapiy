import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'

const BASE_URL_SUFFIX_KEY = 'base_url_suffix'
// 完整系统 BaseURL（如 https://hapiying.example.com:6060/proxy）。生成代理配置
// 与托管 provider「跟随系统」时都用它，不再依赖请求 Host，避免隧道/反代
// 把 Host 改成 localhost 导致生成的 JSON 地址跑偏。
const SYSTEM_BASE_URL_KEY = 'system_base_url'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

// 说明用的示例来源（完整地址 = 最终 BaseURL + /__来源 + Agent 自己的路径）。
const EXAMPLE_SOURCES = ['opencode', 'macOpenchamber'] as const

export function BaseUrlSettings() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [suffixValue, setSuffixValue] = useState('')
  const [origin, setOrigin] = useState(window.location.origin)
  const [sources, setSources] = useState<readonly string[]>([])
  const [sourcesFailed, setSourcesFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    dashboardApi.getSettings()
      .then((settings) => {
        const suffix = settings.find((s) => s.key === BASE_URL_SUFFIX_KEY)
        setSuffixValue(suffix?.value ?? '')
        // 已配置过 system_base_url 时，域名从设置回填（去尾缀），以便编辑；
        // 未配置则保持默认 = 当前网页域名。
        const sys = settings.find((s) => s.key === SYSTEM_BASE_URL_KEY)
        if (sys?.value) {
          const slash = sys.value.lastIndexOf('/')
          setOrigin(slash > 'https://'.length ? sys.value.slice(0, slash) : sys.value)
        } else {
          setOrigin(window.location.origin)
        }
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message = err instanceof DashboardApiError ? err.message : i18n.t('settings:errors.fetchSettingsFailed')
        setState({ kind: 'error', message })
      })
  }, [])

  // 只读列表：使用记录里实际出现过的来源标记。
  const loadSources = useCallback(() => {
    dashboardApi
      .listLogSources()
      .then((list) => {
        setSources(list.filter((s) => s.startsWith('__')))
        setSourcesFailed(false)
      })
      .catch(() => setSourcesFailed(true))
  }, [])

  useEffect(() => {
    load()
    loadSources()
  }, [load, loadSources])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    load()
    loadSources()
  }

  const originTrimmed = origin.replace(/\/+$/, '')
  const baseUrl = `${originTrimmed}/${suffixValue.trim() || 'proxy'}`

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast(t('common:action.copied'))
    } catch {
      toast.error(t('baseUrl.copyFailed'))
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      const effective = `${origin.trim().replace(/\/+$/, '')}/${suffixValue.trim() || 'proxy'}`
      await Promise.all([
        dashboardApi.updateSetting(BASE_URL_SUFFIX_KEY, suffixValue),
        dashboardApi.updateSetting(SYSTEM_BASE_URL_KEY, effective),
      ])
      toast(t('toast.saved'))
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : t('baseUrl.saveFailed')
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AppIcon name="link" size={16} /> {t('common:nav.baseUrl')}
            </CardTitle>
          <CardDescription>{t('baseUrl.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('loading')}
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
              </Button>
            </div>
          )}

          {state.kind === 'ready' && (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex max-w-4xl flex-wrap items-end gap-4">
                <label className="grid min-w-0 flex-1 gap-1.5 text-sm" htmlFor="base-url-origin">
                  {t('baseUrl.originLabel')}
                  <Input
                    id="base-url-origin"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    placeholder="https://hapiying.example.com:6060"
                    className="font-mono"
                  />
                </label>
                <label className="grid gap-1.5 text-sm" htmlFor="base-url-suffix">
                  {t('baseUrl.suffixLabel')}
                  <Input
                    id="base-url-suffix"
                    value={suffixValue}
                    onChange={(event) => setSuffixValue(event.target.value)}
                    disabled={saving}
                    placeholder="proxy"
                    className="w-40"
                  />
                </label>
              </div>
              <p className="max-w-4xl text-xs text-pretty text-muted-foreground">
                {t('baseUrl.originHint')}
              </p>
              <div className="grid max-w-4xl gap-1.5 text-sm">
                <span>{t('baseUrl.finalUrlLabel')}</span>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={baseUrl}
                    aria-label={t('baseUrl.finalUrlLabel')}
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyUrl(baseUrl)}
                    disabled={saving}
                  >
                    <AppIcon name="content_copy" size={14} /> {t('common:action.copy')}
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  {t('common:action.save')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {state.kind === 'ready' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AppIcon name="sell" size={16} /> {t('baseUrl.sourcesCardTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex max-w-4xl flex-col gap-6">
              <div className="grid gap-2">
                <p className="text-xl leading-snug text-balance sm:text-2xl">{t('baseUrl.sourceLead')}</p>
                <p className="text-sm text-pretty text-muted-foreground">{t('baseUrl.sourceSub')}</p>
              </div>

              <div className="grid gap-3">
                <div className="text-sm font-medium">{t('baseUrl.sourceFormulaLabel')}</div>
                <div className="flex flex-wrap items-center gap-2.5 text-xl sm:text-2xl">
                  <span className="min-w-0 rounded-xl border border-border bg-muted/40 px-3.5 py-2 font-mono break-all">
                    {baseUrl}
                  </span>
                  <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                    <span className="text-lg text-muted-foreground">+</span>
                    <span className="rounded-xl border border-primary/50 bg-primary/10 px-3.5 py-2 font-mono text-primary">
                      {t('baseUrl.sourceFormulaMarker')}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                    <span className="text-lg text-muted-foreground">+</span>
                    <span className="rounded-xl border border-border bg-muted/40 px-3.5 py-2">
                      {t('baseUrl.sourceFormulaPath')}
                    </span>
                  </span>
                </div>
              </div>

              <div className="grid gap-2">
                <div className="text-sm font-medium">{t('baseUrl.sourceExampleLabel')}</div>
                <div className="grid gap-1">
                  {EXAMPLE_SOURCES.map((name) => (
                    <code
                      key={name}
                      className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs break-all"
                    >
                      {baseUrl}/<span className="text-primary">{`__${name}`}</span>/v1/chat/completions
                    </code>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AppIcon name="history" size={16} /> {t('baseUrl.sourcesInUseLabel')}
              </CardTitle>
              <CardDescription>{t('baseUrl.sourcesInUseHint')}</CardDescription>
            </CardHeader>
            <CardContent className="max-w-4xl">
              {sourcesFailed ? (
                <p className="text-xs text-destructive">{t('baseUrl.sourcesInUseFailed')}</p>
              ) : sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('baseUrl.sourcesInUseEmpty')}</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span className="w-32 shrink-0">{t('baseUrl.sourcesInUseName')}</span>
                    <span className="min-w-0 flex-1">{t('baseUrl.sourcesInUseUrl')}</span>
                  </div>
                  {sources.map((source) => {
                    const fullUrl = `${baseUrl}/${source}`
                    return (
                      <div
                        key={source}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <span className="w-32 shrink-0 truncate font-mono text-xs">{source.replace(/^__/, '')}</span>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <code className="min-w-0 flex-1 truncate font-mono text-xs">{fullUrl}</code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyUrl(fullUrl)}
                            disabled={saving}
                          >
                            <AppIcon name="content_copy" size={14} /> {t('common:action.copy')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
