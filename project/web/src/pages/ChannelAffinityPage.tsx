import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Dialog, DialogContent, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { i18n } from '@/i18n/i18n'
import {
  dashboardApi,
  DashboardApiError,
  type ChannelAffinitySetting,
  type ChannelAffinityPayload,
  type ChannelAffinityRule,
  type ChannelAffinityFallback,
} from '@/lib/dashboard-api'

function emptyRule(): ChannelAffinityRule {
  return {
    name: '',
    enabled: true,
    sessionIdFields: [],
    modelFields: [],
    ttlSeconds: 1800,
  }
}

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

function RuleForm({ rule, onSave, saving }: {
  readonly rule: ChannelAffinityRule | null
  readonly onSave: (rule: ChannelAffinityRule) => void | Promise<void>
  readonly saving: boolean
}) {
  const { t } = useTranslation('settings')
  const [form, setForm] = useState<ChannelAffinityRule>(rule ?? emptyRule())

  // Keep raw textarea text (newlines included) so Enter works live; cleanup
  // (trim/dedup) happens only when saving.
  const [sessionText, setSessionText] = useState(rule?.sessionIdFields.join('\n') ?? '')
  const [modelText, setModelText] = useState(rule?.modelFields.join('\n') ?? '')

  const handleSave = async () => {
    await onSave({
      ...form,
      sessionIdFields: parseList(sessionText),
      modelFields: parseList(modelText),
    })
  }

  return (
    <DialogScrollBody footer={
      <>
        <Button
          disabled={saving || !form.name.trim() || parseList(sessionText).length === 0}
          onClick={() => void handleSave()}
        >
          {saving ? t('savingEllipsis') : t('common:action.save')}
        </Button>
      </>
    }>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="aff-rule-name">{t('affinity.ruleName')}</FieldLabel>
        <Input id="aff-rule-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('affinity.ruleNamePlaceholder')} />
      </Field>

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
        <FieldLabel htmlFor="aff-ttl">{t('affinity.ttlLabel')}</FieldLabel>
        <Input id="aff-ttl" type="number" min={1} value={form.ttlSeconds ?? 1800} onChange={(event) => setForm((current) => ({ ...current, ttlSeconds: Number(event.target.value) || 1800 }))} />
      </Field>

    </FieldGroup>
    </DialogScrollBody>
  )
}

function FallbackForm({ fallback, onSave, saving }: {
  readonly fallback: ChannelAffinityFallback
  readonly onSave: (next: ChannelAffinityFallback) => void | Promise<void>
  readonly saving: boolean
}) {
  const { t } = useTranslation('settings')
  const [enabled, setEnabled] = useState(fallback.enabled)
  // Keep raw textarea text (newlines included) so Enter works live; cleanup
  // happens only when saving.
  const [sessionText, setSessionText] = useState(fallback.sessionIdFields.join('\n') ?? '')
  const [modelText, setModelText] = useState(fallback.modelFields.join('\n') ?? '')

  return (
    <DialogScrollBody footer={
      <>
        <Button
          disabled={saving}
          onClick={async () => {
            await onSave({
              enabled,
              sessionIdFields: parseList(sessionText),
              modelFields: parseList(modelText),
            })
          }}
        >
          {saving ? t('savingEllipsis') : t('common:action.save')}
        </Button>
      </>
    }>
    <FieldGroup>
      <Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          {t('affinity.fallbackEnabled')}
        </label>
      </Field>

      {enabled && (
        <>
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
        </>
      )}

    </FieldGroup>
    </DialogScrollBody>
  )
}

const EMPTY_FALLBACK: ChannelAffinityFallback = {
  enabled: false,
  sessionIdFields: [],
  modelFields: [],
}

function emptySetting(): ChannelAffinitySetting {
  return { enabled: false, defaultTtlSeconds: 1800, rules: [] }
}

export function ChannelAffinityPage() {
  const { t } = useTranslation('settings')
  const [payload, setPayload] = useState<ChannelAffinityPayload | null>(null)
  const [editing, setEditing] = useState<ChannelAffinityRule | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isFallbackOpen, setIsFallbackOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setPayload(await dashboardApi.getChannelAffinity())
    } catch (loadError) {
      setError(loadError instanceof DashboardApiError ? loadError.message : i18n.t('settings:affinity.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const save = async (next: ChannelAffinityPayload) => {
    setIsSaving(true)
    setError(null)
    try {
      const saved = await dashboardApi.saveChannelAffinity(next)
      setPayload(saved)
      return true
    } catch (saveError) {
      setError(saveError instanceof DashboardApiError ? saveError.message : i18n.t('settings:affinity.saveFailed'))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveRule = async (rule: ChannelAffinityRule) => {
    if (!payload) return
    const exists = payload.setting.rules.some((item) => item.name === rule.name)
    const rules = exists
      ? payload.setting.rules.map((item) => (item.name === rule.name ? rule : item))
      : [...payload.setting.rules, rule]
    const ok = await save({ ...payload, setting: { ...payload.setting, enabled: true, rules } })
    if (ok) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleDeleteRule = async (name: string) => {
    if (!payload) return
    await save({
      ...payload,
      setting: {
        ...payload.setting,
        enabled: true,
        rules: payload.setting.rules.filter((item) => item.name !== name),
      },
    })
  }

  const handleSaveFallback = async (next: ChannelAffinityFallback) => {
    if (!payload) return
    const ok = await save({ ...payload, fallback: next })
    if (ok) setIsFallbackOpen(false)
  }

  const setting = payload?.setting ?? emptySetting()
  const fallback = payload?.fallback ?? EMPTY_FALLBACK
  const total = setting.rules.length
  const pagedRules = useMemo(
    () => setting.rules.slice(offset, offset + limit),
    [setting.rules, offset, limit],
  )

  const columns: ColumnDef<ChannelAffinityRule>[] = [
    {
      key: 'name',
      label: t('affinity.ruleName'),
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'sessionIdFields',
      label: t('affinity.colSessionFields'),
      defaultWidth: { kind: 'pixel', value: 200 },
      render: (_, row) => <span className="text-xs">{row.sessionIdFields.join(', ') || '—'}</span>,
    },
    {
      key: 'modelFields',
      label: t('affinity.colModelFields'),
      defaultWidth: { kind: 'pixel', value: 200 },
      render: (_, row) => <span className="text-xs">{row.modelFields.join(', ') || '—'}</span>,
    },
    {
      key: 'ttlSeconds',
      label: t('affinity.colTtl'),
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      render: (_, row) => <span className="text-xs">{row.ttlSeconds ?? setting.defaultTtlSeconds}</span>,
    },
    {
      key: 'enabled',
      label: t('table.status'),
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <span className={row.enabled ? 'text-success' : 'text-destructive'}>{row.enabled ? t('common:action.enable') : t('common:action.disable')}</span>,
    },
    {
      key: 'actions',
      label: t('table.actions'),
      defaultWidth: { kind: 'pixel', value: 180 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void handleSaveRule({ ...row, enabled: !row.enabled })}>{row.enabled ? t('common:action.disable') : t('common:action.enable')}</Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(row); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => setDeleting(row.name)}><AppIcon name="delete" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('affinity.pageDescription')}
        status={t('affinity.status', { count: total })}
      />
      <div className="flex flex-wrap items-center gap-2 px-6 pt-2">
        <Button
          variant="outline"
          onClick={() => setIsFallbackOpen(true)}
          disabled={isSaving || isLoading}
          className={
            fallback.enabled
              ? 'border-primary text-primary ring-1 ring-primary/40 hover:bg-primary/5'
              : ''
          }
        >
          {t('affinity.fallbackButton', { state: fallback.enabled ? t('affinity.stateOn') : t('affinity.stateOff') })}
        </Button>
      </div>
      <div className="p-6">
        <DataTable
          id="channel-affinity"
          columns={columns}
          data={pagedRules}
          total={total}
          loading={isLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText={t('affinity.empty')}
          onRetry={() => void load()}
          actions={
            <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving || isLoading}>
              <AppIcon name="add" data-icon="inline-start" />{t('affinity.addRule')}
            </Button>
          }
        />
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent width="md" scrollFooter>
          <DialogHeader><DialogTitle>{editing ? t('affinity.editRule') : t('affinity.addRule')}</DialogTitle></DialogHeader>
          <RuleForm rule={editing} onSave={(rule) => void handleSaveRule(rule)} saving={isSaving} />
        </DialogContent>
      </Dialog>

      <Dialog open={isFallbackOpen} onOpenChange={setIsFallbackOpen}>
        <DialogContent width="md" scrollFooter>
          <DialogHeader><DialogTitle>{t('affinity.fallbackTitle')}</DialogTitle></DialogHeader>
          <FallbackForm fallback={fallback} onSave={(next) => void handleSaveFallback(next)} saving={isSaving} />
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('affinity.confirmDeleteTitle')}
        description={t('affinity.confirmDeleteDescription', { name: deleting ?? '' })}
        busy={isSaving}
        onConfirm={() => {
          if (deleting) {
            const name = deleting
            setDeleting(null)
            void handleDeleteRule(name)
          }
        }}
      />
    </div>
  )
}
