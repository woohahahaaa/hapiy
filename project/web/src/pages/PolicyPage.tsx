import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { DataTable, type ColumnDef } from '@/components/data-table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { dashboardApi,
  type RewriteRule,
  type FailoverRule,
  type ResponseRewriteRule,
  type RuleType,
} from '@/lib/dashboard-api'
import { RewriteTestDialog } from '@/components/RewriteTestDialog'
import { RewriteRuleEditor, GjsonPathHelp, parseRule, isActionValid } from '@/components/rewrite-rule-editor'
import { RewriteResponseForm } from '@/components/response-rewrite-editor'
import { RecoverySettings } from '@/pages/RecoverySettings'
import { i18n } from '@/i18n/i18n'

const KNOWN_RULE_TYPES: readonly RuleType[] = [
  'rewrite',
  'failover',
  'rewrite-response',
]

function RewriteRulePreview({ script }: { script: string }) {
  const { t } = useTranslation('policy')
  const form = useMemo(() => parseRule(script), [script])
  const ruleCount = form.blocks.length
  const actionCount = form.blocks.reduce((sum, b) => sum + b.actions.filter(isActionValid).length, 0)

  if (ruleCount === 0 || actionCount === 0) {
    return <span className="text-xs">{t('preview.noAction')}</span>
  }

  return (
    <span className="text-xs">
      {t('preview.summary', { rules: ruleCount, actions: actionCount })}
    </span>
  )
}

export function PolicyPage() {
  const { t } = useTranslation('policy')
  const { type } = useParams<{ type: string }>()
  const activeTab = (type || 'rewrite') as RuleType

  if (type !== undefined && !KNOWN_RULE_TYPES.includes(activeTab)) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title={t('unknown.title')} />
        <div className="flex-1 p-6">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xs border border-border bg-card p-8 text-center">
            <AppIcon name="warning" size={32} className="text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('unknown.notExist')}</p>
              <p className="text-xs text-muted-foreground">
                {t('unknown.available', { types: KNOWN_RULE_TYPES.join('、') })}
              </p>
            </div>
            <Link to="/policy/rewrite" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              {t('unknown.back')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {activeTab === 'rewrite' && <RewritePage />}
      {activeTab === 'failover' && <FailoverPage />}
      {activeTab === 'rewrite-response' && <RewriteResponsePage />}
    </>
  )
}

// ── Shared hook: fetch + mutate with loading/error state ──

function useRulesApi<T>(type: RuleType) {
  const [rules, setRules] = useState<readonly T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [total, setTotal] = useState(0)

  const fetch = useCallback(async (specificOffset?: number, specificLimit?: number) => {
    const useOffset = specificOffset ?? offset
    const useLimit = specificLimit ?? limit
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listRules<T>(type, { limit: useLimit, offset: useOffset })
      setRules(result.rules)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('policy:errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [type, offset, limit])

  useEffect(() => { fetch() }, [fetch])

  const create = async (rule: Partial<T> & { readonly status: boolean }): Promise<T | null> => {
    setMutating(true)
    setError(null)
    try {
      const created = await dashboardApi.createRule<T>(type, rule)
      setRules((prev) => [...prev, created])
      return created
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('policy:errors.createFailed'))
      return null
    } finally {
      setMutating(false)
    }
  }

  const update = async (id: string, rule: Partial<T> & { readonly status: boolean }): Promise<T | null> => {
    setMutating(true)
    setError(null)
    try {
      const updated = await dashboardApi.updateRule<T>(type, id, rule)
      setRules((prev) => prev.map((r) => (r as { id: string }).id === id ? updated : r))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('policy:errors.updateFailed'))
      return null
    } finally {
      setMutating(false)
    }
  }

  const remove = async (id: string): Promise<boolean> => {
    setMutating(true)
    setError(null)
    try {
      await dashboardApi.deleteRule(type, id)
      setRules((prev) => prev.filter((r) => (r as { id: string }).id !== id))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('policy:errors.deleteFailed'))
      return false
    } finally {
      setMutating(false)
    }
  }

  return { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit }
}

// ── Empty / Error / Loading helpers ──


// ── Rewrite ──

function RewritePage() {
  const { t } = useTranslation('policy')
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<RewriteRule>('rewrite')
  const [editing, setEditing] = useState<RewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [deleting, setDeleting] = useState<RewriteRule | null>(null)

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: RewriteRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, script: rule.script, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, script: rule.script, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  const columns: ColumnDef<RewriteRule>[] = [
    { key: 'name', label: t('name'), defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'script',
      label: t('columns.preview'),
      defaultWidth: { kind: 'percent', value: 30 },
      render: (_, row) => <RewriteRulePreview script={row.script} />,
    },
    {
      key: 'id',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('rewrite.description')}
        status={t('statusCount', { count: total })}
      />
      <div className="p-6">
        <DataTable
          id="policy-rewrite"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText={t('rewrite.empty')}
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                {t('dialog.addRule')}
              </Button>
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={mutating}>
                <AppIcon name="play" data-icon="inline-start" />{t('common:action.test')}
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent width="md" scrollFooter>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialog.editRule') : t('dialog.addRule')}</DialogTitle>
          </DialogHeader>
          <RewriteForm rule={editing} onSave={handleSave} saving={mutating} />
        </DialogContent>
      </Dialog>

{testOpen && (
<RewriteTestDialog
        open={testOpen}
        onClose={() => { setTestOpen(false); }}
        rules={rules}
        type="rewrite"
        preselectedRuleId={null}
        showSelector={true}
        width="full"
        height="full"
      />
      )}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('dialog.deleteTitle')}
        description={t('dialog.deleteDescription', { name: deleting?.name ?? '' })}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}

function RewriteForm({ rule, onSave, saving }: { rule: RewriteRule | null; onSave: (r: RewriteRule) => void; saving: boolean }) {
  const { t } = useTranslation('policy')
  const [form, setForm] = useState<RewriteRule>(
    rule || { id: '', name: '', script: '[]', status: true }
  )

  const formKey = rule?.id ?? 'new'

  return (
    <DialogScrollBody footer={
      <>
        <div className="flex w-full items-center justify-between gap-2">
          <GjsonPathHelp />
          <div className="flex gap-2">
            <Button disabled={saving || !form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>{saving ? t('actions.saving') : t('common:action.save')}</Button>
          </div>
        </div>
      </>
    }>
      <FieldGroup>
      <Field>
        <FieldLabel htmlFor="rewrite-name">{t('name')}</FieldLabel>
        <Input id="rewrite-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('form.ruleName')} />
      </Field>
      <Field>
        <FieldLabel>{t('rewrite.rewriteRules')}</FieldLabel>
        <RewriteRuleEditor
          key={formKey}
          initialScript={form.script}
          onScriptChange={(next) => setForm((p) => ({ ...p, script: next }))}
        />
      </Field>
      </FieldGroup>
    </DialogScrollBody>
  )
}

// ── Failover ──

function FailoverPage() {
  const { t } = useTranslation('policy')
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<FailoverRule>('failover')
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<FailoverRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [deleting, setDeleting] = useState<FailoverRule | null>(null)

  const clearEditQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    const rule = rules.find((candidate) => candidate.id === editId)
    if (!rule) return
    setEditing(rule)
    setIsOpen(true)
  }, [rules, searchParams])


  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: FailoverRule) => {
    if (editing) {
      const result = await update(rule.id, rule)
      if (result) { setEditing(null); setIsOpen(false); clearEditQuery() }
    } else {
      const result = await create(rule)
      if (result) { setIsOpen(false) }
    }
  }

  const columns: ColumnDef<FailoverRule>[] = [
    { key: 'name', label: t('name'), defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    { key: 'dimension', label: t('failover.columns.dimension'), defaultWidth: { kind: 'pixel', value: 120 }, render: (_, row) => <span className="text-xs">{row.dimension ? failoverDimensionLabel(row.dimension) : '—'}</span> },
    {
      key: 'matchPatterns',
      label: t('failover.columns.trigger'),
      defaultWidth: { kind: 'percent', value: 25 },
      render: (_, row) => {
        const patterns = row.matchPatterns ?? []
        if (patterns.length === 0) return <span className="text-xs text-muted-foreground">{t('failover.notSet')}</span>
        const head = patterns.slice(0, 3).join('、')
        const more = patterns.length > 3 ? ` …+${patterns.length - 3}` : ''
        return <span className="text-xs" title={patterns.join('\n')}>{head}{more}</span>
      },
    },
    { key: 'ttfbSeconds', label: t('failover.columns.ttfb'), defaultWidth: { kind: 'pixel', value: 100 }, defaultAlign: 'right', render: (_, row) => <span className="text-xs">{row.ttfbSeconds > 0 ? `${row.ttfbSeconds}s` : t('failover.notEnabled')}</span> },
    {
      key: 'disableThreshold',
      label: t('failover.columns.threshold'),
      defaultWidth: { kind: 'pixel', value: 180 },
      render: (_, row) => {
        const threshold = row.disableThreshold >= 1 ? row.disableThreshold : 1
        const window = row.disableWindowMinutes ?? 0
        const winText = window === 0 ? t('failover.unlimitedWindow') : t('failover.windowMinutes', { count: window })
        return <span className="text-xs">{t('failover.thresholdValue', { count: threshold, window: winText })}</span>
      },
    },
    {
      key: 'id',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('failover.description')}
      />
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="failover" className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="mb-5 !h-[50px] w-full justify-start gap-6 border-b border-border-subtle p-0">
            <TabsTrigger value="failover" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('common:nav.failover')}</TabsTrigger>
            <TabsTrigger value="recovery" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('failover.recoveryTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="failover" className="flex min-h-0 flex-1 flex-col">
            <DataTable
              id="policy-failover"
              columns={columns}
              data={rules}
              total={total}
              loading={loading}
              error={error}
              offset={offset}
              limit={limit}
              onOffsetChange={setOffset}
              onLimitChange={setLimit}
              emptyText={t('failover.empty')}
              onRetry={() => void fetch()}
              actions={
                <div className="flex items-center gap-2">
                  <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                    <AppIcon name="add" data-icon="inline-start" />
                    {t('dialog.addRule')}
                  </Button>
                </div>
              }
            />
          </TabsContent>
          <TabsContent value="recovery" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <RecoverySettings />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) { setEditing(null); clearEditQuery() } }}>
          <DialogContent width="md" scrollFooter>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialog.editRule') : t('dialog.addRule')}</DialogTitle>
          </DialogHeader>
          <FailoverForm key={editing?.id ?? 'new'} rule={editing} onSave={handleSave} saving={mutating} />
        </DialogContent>
</Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('dialog.deleteTitle')}
        description={t('dialog.deleteDescription', { name: deleting?.name ?? '' })}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}

const FAILOVER_DIMENSIONS = [
  { value: 'base_url' },
  { value: 'key' },
  { value: 'provider' },
] as const

function failoverDimensionLabel(dimension: FailoverRule['dimension']): string {
  if (dimension === 'base_url') return i18n.t('policy:failover.dimensions.baseUrl')
  if (dimension === 'key') return i18n.t('policy:failover.dimensions.key')
  if (dimension === 'provider') return i18n.t('policy:failover.dimensions.provider')
  return i18n.t('policy:failover.dimensions.unselected')
}

function FailoverForm({ rule, onSave, saving }: { rule: FailoverRule | null; onSave: (r: FailoverRule) => void; saving: boolean }) {
  const { t } = useTranslation('policy')
  const initial: FailoverRule = rule ? {
    ...rule,
    disableThreshold: rule.disableThreshold >= 1 ? rule.disableThreshold : 1,
  } : {
    id: '',
    name: '',
    primaryProvider: '',
    fallbackProvider: '',
    condition: 'error',
    status: true,
    keywords: [],
    actions: [],
    dimension: 'base_url',
    autoDisable: true,
    matchPatterns: [],
    ttfbSeconds: 0,
    speedLimit: 0,
    disableThreshold: 1,
    disableWindowMinutes: 5,
  }
  const [form, setForm] = useState<FailoverRule>(initial)
  const [matchPatterns, setMatchPatterns] = useState(() => (rule?.matchPatterns ?? []).join('\n'))

  return (
    <DialogScrollBody footer={
      <>
        <Button
          disabled={saving || !form.name.trim() || !form.dimension}
          onClick={() =>
            onSave({
              ...form,
              name: form.name.trim(),
              matchPatterns: matchPatterns.split('\n').map((s) => s.trim()).filter(Boolean),
            })
          }
        >
          {saving ? t('actions.saving') : t('common:action.save')}
        </Button>
      </>
    }>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="failover-name">{t('name')}</FieldLabel>
        <Input id="failover-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('form.ruleName')} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="failover-dimension">{t('failover.form.dimension')}</FieldLabel>
          <div className="flex items-center gap-4">
            <Select value={form.dimension || 'base_url'} onValueChange={(value) => setForm((p) => ({ ...p, dimension: value as FailoverRule['dimension'] }))}>
              <SelectTrigger id="failover-dimension" className="w-full">
                <SelectValue placeholder={t('failover.form.selectDimension')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FAILOVER_DIMENSIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{failoverDimensionLabel(option.value)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t('failover.form.dimensionHint')}</p>
        </Field>

        <Field>
          <FieldLabel htmlFor="failover-auto-disable">{t('failover.form.autoDisable')}</FieldLabel>
          <div className="flex items-center gap-4">
            <Select value={form.autoDisable ? 'yes' : 'no'} onValueChange={(value) => setForm((p) => ({ ...p, autoDisable: value === 'yes' }))}>
              <SelectTrigger id="failover-auto-disable" className="w-full">
                <SelectValue placeholder={t('failover.form.autoDisablePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="yes">{t('failover.form.yes')}</SelectItem>
                  <SelectItem value="no">{t('failover.form.no')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('failover.form.autoDisableYesHint', { target: form.dimension === 'key' ? 'Key' : form.dimension === 'provider' ? t('failover.dimensions.provider') : 'BaseURL' })}
          </p>
          <p className="text-xs text-muted-foreground">{t('failover.form.autoDisableNoHint')}</p>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="failover-patterns">{t('failover.form.patternsLabel')}</FieldLabel>
        <Textarea id="failover-patterns" value={matchPatterns} onChange={(event) => setMatchPatterns(event.target.value)} placeholder={t('failover.form.patternsPlaceholder')} rows={4} />
        <p className="text-xs text-muted-foreground">{t('failover.form.patternsHint')}</p>
      </Field>

      <Field>
        <FieldLabel htmlFor="failover-speed">{t('failover.form.speedLabel')}</FieldLabel>
        <Input id="failover-speed" type="number" min={0} className="w-40" value={form.speedLimit} onChange={(event) => setForm((p) => ({ ...p, speedLimit: Math.max(0, Number(event.target.value) || 0) }))} placeholder="0" />
        <p className="text-xs text-muted-foreground">{t('failover.form.speedHint')}</p>
      </Field>

      <Field>
        <FieldLabel htmlFor="failover-ttfb">{t('failover.form.ttfbLabel')}</FieldLabel>
        <Input id="failover-ttfb" type="number" min={0} className="w-40" value={form.ttfbSeconds} onChange={(event) => setForm((p) => ({ ...p, ttfbSeconds: Math.max(0, Number(event.target.value) || 0) }))} placeholder="0" />
        <p className="text-xs text-muted-foreground">{t('failover.form.ttfbHint')}</p>
      </Field>

      <Field>
        <FieldLabel>{t('failover.form.thresholdLabel')}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('failover.form.thresholdEvery')}</span>
          <Input type="number" min={0} className="w-20" aria-label={t('failover.form.windowAria')} value={form.disableWindowMinutes} onChange={(event) => setForm((p) => ({ ...p, disableWindowMinutes: Math.max(0, Number(event.target.value) || 0) }))} />
          <span>{t('failover.form.thresholdWindowSuffix')}</span>
          <Input type="number" min={1} className="w-20" aria-label={t('failover.form.thresholdAria')} value={form.disableThreshold} onChange={(event) => setForm((p) => ({ ...p, disableThreshold: Math.max(1, Number(event.target.value) || 1) }))} />
          <span>{t('failover.form.thresholdTimesSuffix')}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t('failover.form.thresholdHint')}</p>
      </Field>

      </FieldGroup>
    </DialogScrollBody>
  )
}

// ── Response Rewrite ──

function RewriteResponsePage() {
  const { t } = useTranslation('policy')
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<ResponseRewriteRule>('rewrite-response')
  const [editing, setEditing] = useState<ResponseRewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [deleting, setDeleting] = useState<ResponseRewriteRule | null>(null)


  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: ResponseRewriteRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, script: rule.script, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, script: rule.script, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  const columns: ColumnDef<ResponseRewriteRule>[] = [
    { key: 'name', label: t('name'), defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'script',
      label: t('columns.preview'),
      defaultWidth: { kind: 'percent', value: 30 },
      render: (_, row) => <RewriteRulePreview script={row.script} />,
    },
    {
      key: 'id',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('response.description')}
        status={t('statusCount', { count: total })}
      />
      <div className="p-6">
        <DataTable
          id="policy-rewrite-response"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText={t('response.empty')}
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                {t('dialog.addRule')}
              </Button>
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={mutating}>
                <AppIcon name="play" data-icon="inline-start" />{t('common:action.test')}
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent width="md" scrollFooter>
          <DialogHeader>
            <DialogTitle>{editing ? t('dialog.editRule') : t('dialog.addRule')}</DialogTitle>
          </DialogHeader>
          <RewriteResponseForm rule={editing} onSave={handleSave} saving={mutating} />
        </DialogContent>
      </Dialog>

      {testOpen && (
        <RewriteTestDialog
          open={testOpen}
          onClose={() => { setTestOpen(false); }}
          rules={rules}
          type="rewrite-response"
          preselectedRuleId={null}
          showSelector={true}
          width="full"
          height="full"
        />
      )}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('dialog.deleteTitle')}
        description={t('dialog.deleteDescription', { name: deleting?.name ?? '' })}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}
