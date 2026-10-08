import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'
import { DEFAULT_TOKEN_USAGE_FIELDS, parseTokenUsageFields, type TokenUsageFields } from '@/lib/token-usage-fields'

const TOKEN_USAGE_FIELDS_KEY = 'token_usage_fields'

const FIELD_GROUPS: readonly { key: keyof TokenUsageFields; labelKey: string; hintKey: string }[] = [
  { key: 'prompt_tokens', labelKey: 'tokenUsage.promptLabel', hintKey: 'tokenUsage.promptHint' },
  { key: 'cache_write_tokens', labelKey: 'tokenUsage.cacheWriteLabel', hintKey: 'tokenUsage.cacheWriteHint' },
  { key: 'cache_read_tokens', labelKey: 'tokenUsage.cacheReadLabel', hintKey: 'tokenUsage.cacheReadHint' },
  { key: 'completion_tokens', labelKey: 'tokenUsage.completionLabel', hintKey: 'tokenUsage.completionHint' },
]

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

function settingsValue(settings: readonly { key: string; value: string }[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? ''
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : i18n.t('settings:errors.operationFailed')
}

export function TokenUsageSettingsPage() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [draft, setDraft] = useState<TokenUsageFields>(DEFAULT_TOKEN_USAGE_FIELDS)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setDraft(parseTokenUsageFields(settingsValue(settings, TOKEN_USAGE_FIELDS_KEY)))
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        setState({ kind: 'error', message: err instanceof DashboardApiError ? err.message : i18n.t('settings:errors.fetchSettingsFailed') })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const updateGroup = (group: keyof TokenUsageFields, paths: readonly string[]) => {
    setDraft((prev) => ({ ...prev, [group]: paths }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await dashboardApi.updateSetting(TOKEN_USAGE_FIELDS_KEY, JSON.stringify(draft))
      toast(t('toast.saved'))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('tokenUsage.pageDescription')}
      />
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AppIcon name="key" size={16} /> {t('tokenUsage.cardTitle')}
            </CardTitle>
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
                <Button variant="outline" size="sm" onClick={load}>
                  <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
                </Button>
              </div>
            )}

            {state.kind === 'ready' && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4">
                  {FIELD_GROUPS.map((group) => {
                    const paths = draft[group.key]
                    return (
                      <div key={group.key} className="flex flex-col gap-2">
                        <div>
                          <div className="text-sm font-medium">{t(group.labelKey)}</div>
                          <div className="text-xs text-muted-foreground">{t(group.hintKey)}</div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {paths.map((path, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input
                                value={path}
                                onChange={(e) => {
                                  const next = [...paths]
                                  next[i] = e.target.value
                                  updateGroup(group.key, next)
                                }}
                                placeholder={t('tokenUsage.pathPlaceholder')}
                                className="font-mono text-xs"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => updateGroup(group.key, paths.filter((_, idx) => idx !== i))}
                                title={t('tokenUsage.removePathTitle')}
                              >
                                <AppIcon name="delete" size={14} />
                              </Button>
                            </div>
                          ))}
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateGroup(group.key, [...paths, ''])}
                            >
                              {t('tokenUsage.addPath')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  {t('tokenUsage.footnote')}
                </p>

                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_TOKEN_USAGE_FIELDS)}>
                    {t('restoreDefaults')}
                  </Button>
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    {t('common:action.save')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
