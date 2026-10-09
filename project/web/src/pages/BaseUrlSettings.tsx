import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'

const BASE_URL_SUFFIX_KEY = 'base_url_suffix'
// 完整系统 BaseURL（如 https://hapiying.hihy.me:6060/proxy）。生成代理配置
// 与托管 provider「跟随系统」时都用它，不再依赖请求 Host，避免隧道/反代
// 把 Host 改成 localhost 导致生成的 JSON 地址跑偏。
const SYSTEM_BASE_URL_KEY = 'system_base_url'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

const MAX_PATH_LEN = 32

function isValidPathName(name: string): boolean {
  return !name.includes('/') && !name.includes('__') && name.length <= MAX_PATH_LEN
}

export function BaseUrlSettings() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [suffixValue, setSuffixValue] = useState('')
  const [origin, setOrigin] = useState(window.location.origin)
  const [paths, setPaths] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([dashboardApi.getSettings(), dashboardApi.getBaseUrlPaths()])
      .then(([settings, savedPaths]) => {
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
        setPaths([...savedPaths])
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message = err instanceof DashboardApiError ? err.message : i18n.t('settings:errors.fetchSettingsFailed')
        setState({ kind: 'error', message })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    load()
  }

  const originTrimmed = origin.replace(/\/+$/, '')
  const baseUrl = `${originTrimmed}/${suffixValue.trim() || 'proxy'}`
  const fullUrlFor = (name: string) => `${baseUrl}/__${name}`

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast(t('common:action.copied'))
    } catch {
      toast.error(t('baseUrl.copyFailed'))
    }
  }

  const updatePath = (index: number, value: string) => {
    setPaths((current) => current.map((p, i) => (i === index ? value : p)))
  }

  const removePath = (index: number) => {
    setPaths((current) => current.filter((_, i) => i !== index))
  }

  const addPath = () => {
    setPaths((current) => [...current, ''])
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const invalid = paths.find((p) => p.trim() !== '' && !isValidPathName(p.trim()))
    if (invalid) {
      toast.error(t('baseUrl.invalidPathName', { name: invalid.trim(), max: MAX_PATH_LEN }))
      return
    }
    setSaving(true)
    try {
      const cleaned = paths.map((p) => p.trim()).filter((p) => p !== '')
      const effective = `${origin.trim().replace(/\/+$/, '')}/${suffixValue.trim() || 'proxy'}`
      await Promise.all([
        dashboardApi.updateSetting(BASE_URL_SUFFIX_KEY, suffixValue),
        dashboardApi.updateSetting(SYSTEM_BASE_URL_KEY, effective),
        dashboardApi.replaceBaseUrlPaths(cleaned),
      ])
      setPaths(cleaned)
      toast(t('toast.saved'))
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : t('baseUrl.saveFailed')
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
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
            <div className="flex flex-wrap items-end gap-4">
              <label className="grid gap-1.5 text-sm">
                {t('baseUrl.originLabel')}
                <Input
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="https://hapiying.hihy.me:6060"
                  className="w-96 font-mono"
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
              <div className="grid gap-1.5 text-sm">
                <span>{t('baseUrl.finalUrlLabel')}</span>
                <div className="flex items-center gap-2">
                  <code className="w-96 cursor-not-allowed truncate rounded-none border border-border-subtle bg-muted px-3 py-2 font-mono text-xs">
                    {baseUrl}
                  </code>
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
            </div>
            <p className="text-xs text-muted-foreground">
              {t('baseUrl.originHint')}
            </p>
            <div className="grid gap-1.5 text-sm">
              <span>{t('baseUrl.sourceMarkerLabel')}</span>
              <p className="text-xs text-muted-foreground">
                {t('baseUrl.sourceMarkerHintPrefix')}<code>{t('baseUrl.sourceMarkerInlineCode')}</code>{t('baseUrl.sourceMarkerHintSuffix')}
              </p>
              <div className="grid max-w-2xl gap-1.5">
              <div className="flex flex-col gap-2">
                {paths.map((p, index) => {
                  const name = p.trim()
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={p}
                        onChange={(event) => updatePath(index, event.target.value)}
                        disabled={saving}
                        placeholder={t('baseUrl.sourceNamePlaceholder')}
                        className="w-36 shrink-0"
                      />
                      <code className="flex-1 cursor-not-allowed truncate rounded-none border border-border-subtle bg-muted px-3 py-2 font-mono text-xs">
                        {name ? fullUrlFor(name) : `${baseUrl}/__…`}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyUrl(fullUrlFor(name))}
                        disabled={saving || !name}
                      >
                        <AppIcon name="content_copy" size={14} /> {t('common:action.copy')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePath(index)}
                        disabled={saving}
                        aria-label={t('baseUrl.removePathAria')}
                      >
                        <AppIcon name="delete" size={14} />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addPath}
                  disabled={saving}
                >
                  <AppIcon name="add" size={14} /> {t('baseUrl.addSource')}
                </Button>
              </div>
              </div>
            </div>
            <p className="max-w-2xl text-xs text-muted-foreground">
              {t('baseUrl.requestExamplePrefix')}<code>{`${baseUrl}/__${t('baseUrl.sourcePathSegment')}/v1/chat/completions`}</code>
            </p>
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
  )
}
