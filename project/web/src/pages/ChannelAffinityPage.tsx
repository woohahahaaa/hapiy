import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

function RuleForm({ rule, onSave, onCancel }: {
  readonly rule: ChannelAffinityRule | null
  readonly onSave: (rule: ChannelAffinityRule) => void
  readonly onCancel: () => void
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

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={!form.name.trim() || form.keySources.length === 0} onClick={() => onSave(form)}>保存</Button>
      </div>
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
    const ok = await save({ enabled: setting.enabled, defaultTtlSeconds: setting.defaultTtlSeconds, rules })
    if (ok) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleDeleteRule = async (name: string) => {
    if (!setting) return
    await save({
      enabled: setting.enabled,
      defaultTtlSeconds: setting.defaultTtlSeconds,
      rules: setting.rules.filter((item) => item.name !== name),
    })
  }

  const current = setting ?? { enabled: false, defaultTtlSeconds: 1800, rules: [] }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="渠道亲和性" status={`${current.rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            请求按亲和字段（模型 + 会话 + endpoint）命中规则后，优先复用上次使用的渠道。
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={current.enabled}
                onCheckedChange={(enabled) => void save({ enabled, defaultTtlSeconds: current.defaultTtlSeconds, rules: current.rules })}
                disabled={isSaving}
              />
              启用渠道亲和
            </label>
            <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving || isLoading}>
              <AppIcon name="add" data-icon="inline-start" />添加规则
            </Button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            <span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
          </div>
        )}

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>规则名称</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>亲和字段</TableHead>
                <TableHead>TTL（秒）</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">正在加载规则...</TableCell></TableRow>}
              {!isLoading && current.rules.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无规则。添加一条规则开始配置。</TableCell></TableRow>}
              {current.rules.map((rule) => (
                <TableRow key={rule.name}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{rule.modelRegex.join(', ') || '全部'}</span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{rule.pathRegex.join(', ') || '不区分'}</span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{rule.keySources.map((source) => source.type === 'request_header' ? source.key : source.path).join(', ') || '-'}</span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{rule.ttlSeconds ?? current.defaultTtlSeconds}</span></TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(enabled) => void handleSaveRule({ ...rule, enabled })}
                      disabled={isSaving}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(rule); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
                      <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => void handleDeleteRule(rule.name)}><AppIcon name="delete" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle></DialogHeader>
          <RuleForm rule={editing} onSave={(rule) => void handleSaveRule(rule)} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
