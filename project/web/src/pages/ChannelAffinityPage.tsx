import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError, type ChannelAffinitySetting } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'

const DEFAULT_TTL_SECONDS = 1800

// Keep raw textarea text (newlines included) so Enter works live; cleanup
// (trim/dedup) happens only when saving.
const parseList = (text: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

export function ChannelAffinityPage() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [enabled, setEnabled] = useState(false)
  const [sessionText, setSessionText] = useState('')
  const [modelText, setModelText] = useState('')
  const [ttlText, setTtlText] = useState(String(DEFAULT_TTL_SECONDS))
  const [saving, setSaving] = useState(false)

  const apply = useCallback((setting: ChannelAffinitySetting) => {
    setEnabled(setting.enabled)
    setSessionText(setting.sessionIdFields.join('\n'))
    setModelText(setting.modelFields.join('\n'))
    setTtlText(String(setting.ttlSeconds))
  }, [])

  const load = useCallback(() => {
    setState({ kind: 'loading' })
    dashboardApi
      .getChannelAffinity()
      .then((setting) => {
        apply(setting)
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        setState({
          kind: 'error',
          message: err instanceof DashboardApiError ? err.message : i18n.t('settings:affinity.loadFailed'),
        })
      })
  }, [apply])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    const sessionIdFields = parseList(sessionText)
    if (enabled && sessionIdFields.length === 0) {
      toast.error(t('affinity.sessionRequired'))
      return
    }
    setSaving(true)
    try {
      const saved = await dashboardApi.saveChannelAffinity({
        enabled,
        sessionIdFields,
        modelFields: parseList(modelText),
        ttlSeconds: Math.max(1, Number(ttlText) || DEFAULT_TTL_SECONDS),
      })
      apply(saved)
      toast(t('toast.saved'))
    } catch (err) {
      toast.error(err instanceof DashboardApiError ? err.message : i18n.t('settings:affinity.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader description={t('affinity.pageDescription')} />
      <div className="flex-1 overflow-auto p-6">
        <Card>
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
              <div className="flex flex-col gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                    {t('affinity.enableLabel')}
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">{t('affinity.enableHint')}</p>
                </div>

                <FieldGroup>
                  <Field>
                    <FieldLabel>{t('affinity.sessionFieldsLabel')}</FieldLabel>
                    <Textarea
                      rows={3}
                      value={sessionText}
                      onChange={(event) => setSessionText(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('affinity.sessionFieldsHint')}</p>
                    <p className="text-xs text-muted-foreground">{t('affinity.sessionFieldsCommon')}</p>
                  </Field>

                  <Field>
                    <FieldLabel>{t('affinity.modelFieldsLabel')}</FieldLabel>
                    <Textarea
                      rows={3}
                      value={modelText}
                      onChange={(event) => setModelText(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('affinity.modelFieldsHint')}</p>
                    <p className="text-xs text-muted-foreground">{t('affinity.modelFieldsCommon')}</p>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="affinity-ttl">{t('affinity.ttlLabel')}</FieldLabel>
                    <Input
                      id="affinity-ttl"
                      type="number"
                      min={1}
                      className="w-40"
                      value={ttlText}
                      onChange={(event) => setTtlText(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t('affinity.ttlHint')}</p>
                  </Field>
                </FieldGroup>

                <div>
                  <Button disabled={saving} onClick={() => void handleSave()}>
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
