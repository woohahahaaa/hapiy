import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  dashboardApi,
  DashboardApiError,
  type ChannelAffinitySetting,
  type ChannelAffinityPayload,
  type ChannelAffinityRule,
  type ChannelAffinityFallback,
  type ChannelAffinityKeySource,
} from '@/lib/dashboard-api'

function emptyRule(): ChannelAffinityRule {
  return {
    name: '',
    enabled: true,
    sessionIdFields: [],
    userIdFields: [],
    modelFields: [],
    modelNames: [],
    ttlSeconds: 1800,
  }
}

type FieldListKey = 'sessionIdFields' | 'userIdFields' | 'modelFields' | 'modelNames'

function RuleForm({ rule, onSave, onCancel, saving }: {
  readonly rule: ChannelAffinityRule | null
  readonly onSave: (rule: ChannelAffinityRule) => void | Promise<void>
  readonly onCancel: () => void
  readonly saving: boolean
}) {
  const [form, setForm] = useState<ChannelAffinityRule>(rule ?? emptyRule())
  const [drafts, setDrafts] = useState<Record<FieldListKey, string>>({
    sessionIdFields: '',
    userIdFields: '',
    modelFields: '',
    modelNames: '',
  })

  const addField = (key: FieldListKey) => {
    const trimmed = drafts[key].trim()
    if (!trimmed) return
    setForm((current) => {
      if (current[key].includes(trimmed)) return current
      return { ...current, [key]: [...current[key], trimmed] }
    })
    setDrafts((current) => ({ ...current, [key]: '' }))
  }

  const removeField = (key: FieldListKey, value: string) => {
    setForm((current) => ({ ...current, [key]: current[key].filter((item) => item !== value) }))
  }

  return (
    <FieldGroup>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="aff-rule-name">规则名称</FieldLabel>
          <Input id="aff-rule-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：DeepSeek 会话亲和" />
        </Field>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
            启用
          </label>
        </div>
      </div>

      <Field>
        <FieldLabel>Session ID 字段（每行一个，先 header 后 body 路径）</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={drafts.sessionIdFields}
            onChange={(event) => setDrafts((current) => ({ ...current, sessionIdFields: event.target.value }))}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addField('sessionIdFields') } }}
            placeholder="如：X-Session-Id、session-id"
          />
          <Button type="button" variant="outline" onClick={() => addField('sessionIdFields')}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.sessionIdFields.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => removeField('sessionIdFields', item)}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel>User ID 字段（每行一个）</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={drafts.userIdFields}
            onChange={(event) => setDrafts((current) => ({ ...current, userIdFields: event.target.value }))}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addField('userIdFields') } }}
            placeholder="如：X-User-Id、user.id"
          />
          <Button type="button" variant="outline" onClick={() => addField('userIdFields')}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.userIdFields.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => removeField('userIdFields', item)}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel>Model 字段（每行一个，留空则用请求的 model 字段）</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={drafts.modelFields}
            onChange={(event) => setDrafts((current) => ({ ...current, modelFields: event.target.value }))}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addField('modelFields') } }}
            placeholder="如：model、llm_model"
          />
          <Button type="button" variant="outline" onClick={() => addField('modelFields')}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.modelFields.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => removeField('modelFields', item)}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel>适用模型名称（每行一个，留空匹配所有）</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={drafts.modelNames}
            onChange={(event) => setDrafts((current) => ({ ...current, modelNames: event.target.value }))}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addField('modelNames') } }}
            placeholder="如：gpt-4、claude-3-opus"
          />
          <Button type="button" variant="outline" onClick={() => addField('modelNames')}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.modelNames.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => removeField('modelNames', item)}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="aff-ttl">缓存有效期（秒）</FieldLabel>
        <Input id="aff-ttl" type="number" min={1} value={form.ttlSeconds ?? 1800} onChange={(event) => setForm((current) => ({ ...current, ttlSeconds: Number(event.target.value) || 1800 }))} />
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button
          disabled={saving || !form.name.trim() || form.sessionIdFields.length === 0}
          onClick={async () => { await onSave(form) }}
        >
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </FieldGroup>
  )
}

function FallbackForm({ fallback, onSave, onCancel, saving }: {
  readonly fallback: ChannelAffinityFallback
  readonly onSave: (next: ChannelAffinityFallback) => void | Promise<void>
  readonly onCancel: () => void
  readonly saving: boolean
}) {
  const [enabled, setEnabled] = useState(fallback.enabled)
  const [sessionInput, setSessionInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [sessionFields, setSessionFields] = useState<string[]>([...fallback.sessionIdFields])
  const [modelFields, setModelFields] = useState<string[]>([...fallback.modelFields])

  const addSession = () => {
    const trimmed = sessionInput.trim()
    if (!trimmed || sessionFields.includes(trimmed)) return
    setSessionFields((current) => [...current, trimmed])
    setSessionInput('')
  }
  const addModel = () => {
    const trimmed = modelInput.trim()
    if (!trimmed || modelFields.includes(trimmed)) return
    setModelFields((current) => [...current, trimmed])
    setModelInput('')
  }

  return (
    <FieldGroup>
      <Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          开启（关闭时不读取兜底字段，正常走亲和性规则 / 拓扑选择）
        </label>
      </Field>

      {enabled && (
        <>
          <Field>
            <FieldLabel>Session ID 字段（每行一个）</FieldLabel>
            <div className="flex gap-2">
              <Input
                value={sessionInput}
                onChange={(event) => setSessionInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSession() } }}
                placeholder="如：X-Session-Id、session-id"
              />
              <Button type="button" variant="outline" onClick={addSession}>添加</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {sessionFields.map((item) => (
                <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {item}
                  <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setSessionFields((current) => current.filter((m) => m !== item))}>×</button>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">从请求头（同名字段，大小写不敏感）或请求体（gjson 路径）中提取 session ID，第一个有值的生效。</p>
          </Field>

          <Field>
            <FieldLabel>模型名字段（每行一个）</FieldLabel>
            <div className="flex gap-2">
              <Input
                value={modelInput}
                onChange={(event) => setModelInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }}
                placeholder="如：model、llm_model"
              />
              <Button type="button" variant="outline" onClick={addModel}>添加</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {modelFields.map((item) => (
                <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {item}
                  <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setModelFields((current) => current.filter((m) => m !== item))}>×</button>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">留空时直接用请求的 model 字段。</p>
          </Field>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button
          disabled={saving}
          onClick={async () => {
            await onSave({
              enabled,
              sessionIdFields: sessionFields,
              modelFields,
            })
          }}
        >
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </FieldGroup>
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
  const [payload, setPayload] = useState<ChannelAffinityPayload | null>(null)
  const [editing, setEditing] = useState<ChannelAffinityRule | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isFallbackOpen, setIsFallbackOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(20)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setPayload(await dashboardApi.getChannelAffinity())
    } catch (loadError) {
      setError(loadError instanceof DashboardApiError ? loadError.message : '加载渠道亲和性配置失败')
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
      setError(saveError instanceof DashboardApiError ? saveError.message : '保存渠道亲和性配置失败')
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
      label: '规则名称',
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'sessionIdFields',
      label: 'Session 字段',
      defaultWidth: { kind: 'pixel', value: 180 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.sessionIdFields.join(', ') || '—'}</span>,
    },
    {
      key: 'userIdFields',
      label: 'User 字段',
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.userIdFields.join(', ') || '—'}</span>,
    },
    {
      key: 'modelFields',
      label: 'Model 字段',
      defaultWidth: { kind: 'pixel', value: 180 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.modelFields.join(', ') || '—'}</span>,
    },
    {
      key: 'modelNames',
      label: '适用模型',
      defaultWidth: { kind: 'percent', value: 25 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.modelNames.join(', ') || '全部'}</span>,
    },
    {
      key: 'ttlSeconds',
      label: 'TTL（秒）',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.ttlSeconds ?? setting.defaultTtlSeconds}</span>,
    },
    {
      key: 'enabled',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <span className={row.enabled ? 'text-success' : 'text-destructive'}>{row.enabled ? '启用' : '禁用'}</span>,
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 180 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void handleSaveRule({ ...row, enabled: !row.enabled })}>{row.enabled ? '禁用' : '启用'}</Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(row); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => void handleDeleteRule(row.name)}><AppIcon name="delete" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="渠道亲和性"
        description="请求按亲和字段（模型 + 会话 + endpoint）命中规则后，优先复用上次使用的渠道"
        status={`${total} 条规则`}
      />
      <div className="flex flex-wrap items-center gap-2 px-6 pt-2">
        <Button
          variant="outline"
          onClick={() => setIsFallbackOpen(true)}
          disabled={isSaving || isLoading}
        >
          兜底渠道亲和性匹配：{fallback.enabled ? '开启' : '关闭'}
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
          emptyText="暂无规则"
          onRetry={() => void load()}
          actions={
            <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving || isLoading}>
              <AppIcon name="add" data-icon="inline-start" />添加规则
            </Button>
          }
        />
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent width="md">
          <DialogHeader><DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle></DialogHeader>
          <RuleForm rule={editing} onSave={(rule) => void handleSaveRule(rule)} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} saving={isSaving} />
        </DialogContent>
      </Dialog>

      <Dialog open={isFallbackOpen} onOpenChange={setIsFallbackOpen}>
        <DialogContent width="md">
          <DialogHeader><DialogTitle>兜底渠道亲和性匹配</DialogTitle></DialogHeader>
          <FallbackForm fallback={fallback} onSave={(next) => void handleSaveFallback(next)} onCancel={() => setIsFallbackOpen(false)} saving={isSaving} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
