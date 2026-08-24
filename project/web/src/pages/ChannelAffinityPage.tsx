import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
    modelFields: [],
    ttlSeconds: 1800,
  }
}

type FieldListKey = 'sessionIdFields' | 'modelFields'

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

function RuleForm({ rule, onSave, onCancel, saving }: {
  readonly rule: ChannelAffinityRule | null
  readonly onSave: (rule: ChannelAffinityRule) => void | Promise<void>
  readonly onCancel: () => void
  readonly saving: boolean
}) {
  const [form, setForm] = useState<ChannelAffinityRule>(rule ?? emptyRule())

  const updateList = (key: FieldListKey, text: string) => {
    setForm((current) => ({ ...current, [key]: parseList(text) }))
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="aff-rule-name">规则名称</FieldLabel>
        <Input id="aff-rule-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="如：DeepSeek 会话亲和" />
      </Field>

      <Field>
        <FieldLabel>Session ID 请求头（每行一个，大小写不敏感）</FieldLabel>
        <Textarea
          rows={3}
          value={form.sessionIdFields.join('\n')}
          onChange={(event) => updateList('sessionIdFields', event.target.value)}
        />
        <p className="text-xs text-muted-foreground">只在请求头里查找（不读 body），第一个有值的生效。</p>
        <p className="text-xs text-muted-foreground">常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Session-Id</p>
      </Field>

      <Field>
        <FieldLabel>Model 字段（gjson 路径，每行一个）</FieldLabel>
        <Textarea
          rows={3}
          value={form.modelFields.join('\n')}
          onChange={(event) => updateList('modelFields', event.target.value)}
        />
        <p className="text-xs text-muted-foreground">在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。</p>
        <p className="text-xs text-muted-foreground">常见路径：model</p>
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
  const [enabled, setEnabled] = useState(true)
  const [sessionFields, setSessionFields] = useState<string[]>(() => {
    const seeded = fallback.sessionIdFields.length > 0 ? fallback.sessionIdFields : ['X-Session-Id']
    return Array.from(new Set(seeded))
  })
  const [modelFields, setModelFields] = useState<string[]>(() => {
    const seeded = fallback.modelFields.length > 0 ? fallback.modelFields : ['model']
    return Array.from(new Set(seeded))
  })

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
            <FieldLabel>Session ID 请求头（每行一个，大小写不敏感）</FieldLabel>
            <Textarea
              rows={3}
              value={sessionFields.join('\n')}
              onChange={(event) => setSessionFields(Array.from(new Set(event.target.value.split('\n').map((s) => s.trim()).filter(Boolean))))}
            />
            <p className="text-xs text-muted-foreground">只在请求头里查找（不读 body），第一个有值的生效。</p>
            <p className="text-xs text-muted-foreground">常见字段名：X-Session-Id、X-Conversation-Id、x-litellm-session-id、X-Request-Id、X-Client-Session-Id、X-Claude-Code-Session-Id</p>
          </Field>

          <Field>
            <FieldLabel>Model 字段（gjson 路径，每行一个）</FieldLabel>
            <Textarea
              rows={3}
              value={modelFields.join('\n')}
              onChange={(event) => setModelFields(Array.from(new Set(event.target.value.split('\n').map((s) => s.trim()).filter(Boolean))))}
            />
            <p className="text-xs text-muted-foreground">在请求体里按 gjson 路径查找模型名；留空时直接用请求的 model 字段（OpenAI 标准）。</p>
            <p className="text-xs text-muted-foreground">常见路径：model</p>
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
              modelFields: modelFields,
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
      defaultWidth: { kind: 'pixel', value: 200 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.sessionIdFields.join(', ') || '—'}</span>,
    },
    {
      key: 'modelFields',
      label: 'Model 字段',
      defaultWidth: { kind: 'pixel', value: 200 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.modelFields.join(', ') || '—'}</span>,
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
          className={
            fallback.enabled
              ? 'border-primary text-primary ring-1 ring-primary/40 hover:bg-primary/5'
              : ''
          }
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
