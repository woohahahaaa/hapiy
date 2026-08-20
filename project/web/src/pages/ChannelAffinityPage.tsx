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
  type ChannelAffinitySettingInput,
  type ChannelAffinityRule,
  type ChannelAffinityKeySource,
} from '@/lib/dashboard-api'

function emptyRule(): ChannelAffinityRule {
  return {
    name: '',
    enabled: true,
    modelRegex: [],
    pathRegex: [],
    keySources: [],
    includeModelName: true,
    ttlSeconds: 1800,
  }
}

function RuleForm({ rule, onSave, onCancel, saving }: {
  readonly rule: ChannelAffinityRule | null
  readonly onSave: (rule: ChannelAffinityRule) => void | Promise<void>
  readonly onCancel: () => void
  readonly saving: boolean
}) {
  const [form, setForm] = useState<ChannelAffinityRule>(rule ?? emptyRule())
  const [modelInput, setModelInput] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [sourceType, setSourceType] = useState<ChannelAffinityKeySource['type']>('request_header')
  const [sourceKey, setSourceKey] = useState('')
  const [sourcePath, setSourcePath] = useState('')

  const addModel = () => {
    const trimmed = modelInput.trim()
    if (!trimmed) return
    setForm((current) => ({ ...current, modelRegex: [...current.modelRegex, trimmed] }))
    setModelInput('')
  }
  const addPath = () => {
    const trimmed = pathInput.trim()
    if (!trimmed) return
    setForm((current) => ({ ...current, pathRegex: [...current.pathRegex, trimmed] }))
    setPathInput('')
  }
  const addSource = () => {
    const isGjson = sourceType === 'gjson'
    const source: ChannelAffinityKeySource = isGjson
      ? { type: 'gjson', path: sourcePath.trim() }
      : { type: 'request_header', key: sourceKey.trim() }
    if (isGjson ? !sourcePath.trim() : !sourceKey.trim()) return
    setForm((current) => ({ ...current, keySources: [...current.keySources, source] }))
    setSourceKey('')
    setSourcePath('')
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
        <FieldLabel>模型匹配（正则，每行一条）</FieldLabel>
        <div className="flex gap-2">
          <Input value={modelInput} onChange={(event) => setModelInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} placeholder="如：deepseek.* 或 gpt-.*" />
          <Button type="button" variant="outline" onClick={addModel}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.modelRegex.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setForm((current) => ({ ...current, modelRegex: current.modelRegex.filter((m) => m !== item) }))}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel>Endpoint 匹配（正则，每行一条；留空 = 不区分）</FieldLabel>
        <div className="flex gap-2">
          <Input value={pathInput} onChange={(event) => setPathInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPath() } }} placeholder="如：/v1/chat/completions" />
          <Button type="button" variant="outline" onClick={addPath}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.pathRegex.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {item}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setForm((current) => ({ ...current, pathRegex: current.pathRegex.filter((p) => p !== item) }))}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel>亲和字段来源（从请求中读取会话标识，可添加多个，第一个有值的生效）</FieldLabel>
        <div className="flex gap-2">
          <Select value={sourceType} onValueChange={(value) => setSourceType(value as ChannelAffinityKeySource['type'])}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="request_header">请求头</SelectItem>
              <SelectItem value="gjson">请求体路径</SelectItem>
            </SelectContent>
          </Select>
          {sourceType === 'request_header'
            ? <Input value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} placeholder="如：X-Session-Id" />
            : <Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="如：session.id" />}
          <Button type="button" variant="outline" onClick={addSource}>添加</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {form.keySources.map((source, index) => (
            <span key={index} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {source.type === 'request_header' ? `Header: ${source.key}` : `Body: ${source.path}`}
              <button type="button" className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setForm((current) => ({ ...current, keySources: current.keySources.filter((_, i) => i !== index) }))}>×</button>
            </span>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="aff-ttl">缓存有效期（秒）</FieldLabel>
          <Input id="aff-ttl" type="number" min={1} value={form.ttlSeconds ?? 1800} onChange={(event) => setForm((current) => ({ ...current, ttlSeconds: Number(event.target.value) || 1800 }))} />
        </Field>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.includeModelName} onCheckedChange={(includeModelName) => setForm((current) => ({ ...current, includeModelName }))} />
            按模型区分缓存
          </label>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button
          disabled={saving || !form.name.trim() || form.keySources.length === 0}
          onClick={async () => { await onSave(form) }}
        >
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </FieldGroup>
  )
}

export function ChannelAffinityPage() {
  const [setting, setSetting] = useState<ChannelAffinitySetting | null>(null)
  const [editing, setEditing] = useState<ChannelAffinityRule | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(20)

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setSetting(await dashboardApi.getChannelAffinity())
    } catch (loadError) {
      setError(loadError instanceof DashboardApiError ? loadError.message : '加载渠道亲和性配置失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const save = async (next: ChannelAffinitySettingInput) => {
    setIsSaving(true)
    setError(null)
    try {
      const saved = await dashboardApi.saveChannelAffinity(next)
      setSetting(saved)
      return true
    } catch (saveError) {
      setError(saveError instanceof DashboardApiError ? saveError.message : '保存渠道亲和性配置失败')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveRule = async (rule: ChannelAffinityRule) => {
    if (!setting) return
    const exists = setting.rules.some((item) => item.name === rule.name)
    const rules = exists
      ? setting.rules.map((item) => (item.name === rule.name ? rule : item))
      : [...setting.rules, rule]
    const ok = await save({ enabled: true, defaultTtlSeconds: setting.defaultTtlSeconds, rules })
    if (ok) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleDeleteRule = async (name: string) => {
    if (!setting) return
    await save({
      enabled: true,
      defaultTtlSeconds: setting.defaultTtlSeconds,
      rules: setting.rules.filter((item) => item.name !== name),
    })
  }

  const current = setting ?? { enabled: false, defaultTtlSeconds: 1800, rules: [] }
  const total = current.rules.length
  const pagedRules = useMemo(
    () => current.rules.slice(offset, offset + limit),
    [current.rules, offset, limit],
  )

  const columns: ColumnDef<ChannelAffinityRule>[] = [
    {
      key: 'name',
      label: '规则名称',
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'modelRegex',
      label: '模型',
      defaultWidth: { kind: 'pixel', value: 200 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.modelRegex.join(', ') || '全部'}</span>,
    },
    {
      key: 'pathRegex',
      label: 'Endpoint',
      defaultWidth: { kind: 'pixel', value: 160 },
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.pathRegex.join(', ') || '不区分'}</span>,
    },
    {
      key: 'keySources',
      label: '亲和字段',
      defaultWidth: { kind: 'percent', value: 25 },
      accessor: (row) => {
        const joined = row.keySources
          .map((source) => source.type === 'request_header' ? source.key : source.path)
          .join(', ')
        return joined || null
      },
    },
    {
      key: 'ttlSeconds',
      label: 'TTL（秒）',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      render: (_, row) => <span className="text-xs text-muted-foreground">{row.ttlSeconds ?? current.defaultTtlSeconds}</span>,
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
    </div>
  )
}
