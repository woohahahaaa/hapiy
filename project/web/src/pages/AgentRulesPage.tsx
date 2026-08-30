import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { toast } from '@/components/ui/toast'
import {
  dashboardApi,
  DashboardApiError,
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentModelInfoFieldPaths,
  type AgentProtocol,
  type AgentProtocolCondition,
  type AgentProtocolConditionOp,
  type AgentRecommendation,
  type AgentRecommendationScope,
  type AgentRecommendationType,
  type AgentTypeRule,
} from '@/lib/dashboard-api'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'

const RECOMMENDATION_SCOPES: readonly AgentRecommendationScope[] = ['provider', 'model']
const RECOMMENDATION_TYPES: readonly AgentRecommendationType[] = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
]

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : fallback
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function AgentRulesPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="接管Agent" />
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <AgentTypeRulesTab />
      </div>
    </div>
  )
}

function AgentTypeRulesTab() {
  const [rules, setRules] = useState<readonly AgentTypeRule[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [addOpen, setAddOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AgentTypeRule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AgentTypeRule | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listAgentTypeRules()
      setRules(result.rules)
      setTotal(result.total)
    } catch (err) {
      setError(toErrorMessage(err, '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDelete = async (row: AgentTypeRule) => {
    setMutating(true)
    setConfirmDelete(null)
    try {
      await dashboardApi.deleteAgentTypeRule(row.id)
      toast('已删除')
      void fetch()
    } catch (err) {
      toast.error(toErrorMessage(err, '删除失败'))
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<AgentTypeRule>[] = useMemo(() => [
    {
      key: 'name',
      label: '名称',
      defaultWidth: { kind: 'percent', value: 50 },
      accessor: (row) => row.name,
    },
    {
      key: 'createdAt',
      label: '创建时间',
      defaultWidth: { kind: 'pixel', value: 180 },
      slot: {
        line1: (row) => formatDate(row.created_at),
        line2: (row) => formatTime(row.created_at),
      },
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 90 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="编辑"
            onClick={() => setEditingRule(row)}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title="删除"
            onClick={() => setConfirmDelete(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ], [mutating])

  return (
    <>
      <DataTable
        id="agent-type-rules"
        columns={columns}
        data={rules}
        total={total}
        loading={loading}
        error={error}
        offset={offset}
        limit={limit}
        onOffsetChange={setOffset}
        onLimitChange={setLimit}
        emptyText="暂无规则，点击「添加规则」创建第一条"
        onRetry={() => void fetch()}
        actions={
          <div className="flex flex-col items-start gap-1">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <AppIcon name="add" data-icon="inline-start" />
              添加接管规则
            </Button>
            <p className="max-w-md text-xs whitespace-normal text-muted-foreground">
              会在里面配置某个Agent在不同系统上的默认配置文件位置、配置文件修改以及配置文件解析方法等，一般为系统默认，用户无需自己手动添加。
            </p>
          </div>
        }
      />

      <RuleDialog
        open={addOpen || editingRule !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false)
            setEditingRule(null)
          }
        }}
        onCreated={() => void fetch()}
        editing={editingRule}
      />

      <ConfirmDeleteDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="确认删除"
        description={`将删除规则「${confirmDelete?.name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete)
        }}
      />
    </>
  )
}

// ── 添加 / 编辑规则 ──

function RuleDialog({
  open,
  onOpenChange,
  onCreated,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  editing: AgentTypeRule | null
}) {
  const [name, setName] = useState('')
  const [windowsPath, setWindowsPath] = useState('')
  const [macPath, setMacPath] = useState('')
  const [providerPath, setProviderPath] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [recommendations, setRecommendations] = useState<AgentRecommendation[]>([])
  const [protocols, setProtocols] = useState<AgentProtocol[]>([])
  const [modelInfoFields, setModelInfoFields] = useState<AgentModelInfoFieldPaths>({
    max_context: '',
    max_output_token: '',
    input_types: '',
    thinking_levels: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setWindowsPath(editing?.os_paths.windows ?? '')
      setMacPath(editing?.os_paths.mac ?? '')
      setProviderPath(editing?.json_paths.provider ?? '')
      setModelPath(editing?.json_paths.model ?? '')
      setRecommendations((editing?.recommendations ?? []).map((r) => ({ ...r })))
      setProtocols((editing?.protocols ?? []).map((p) => ({
        name: p.name,
        conditions: p.conditions.map((c) => ({ ...c })),
        endpoint_tags: [...p.endpoint_tags],
        recommendations: p.recommendations.map((r) => ({ ...r })),
      })))
      setModelInfoFields({ ...(editing?.model_info_fields ?? {
        max_context: '',
        max_output_token: '',
        input_types: '',
        thinking_levels: '',
      }) })
      setError(null)
      setSaving(false)
    }
  }, [open, editing])

  const handleSave = async () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写名称')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await dashboardApi.updateAgentTypeRule(editing.id, {
          name: trimmed,
          windows: windowsPath.trim(),
          mac: macPath.trim(),
          provider_path: providerPath.trim(),
          model_path: modelPath.trim(),
          recommendations,
          protocols,
          model_info_fields: modelInfoFields,
        })
      } else {
        await dashboardApi.createAgentTypeRule(trimmed)
      }
      toast(editing ? '已更新' : '已添加')
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(toErrorMessage(err, editing ? '更新失败' : '添加失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>名称</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：opencode" />
          </Field>

          <Group label="Agent软件配置文件默认路径">
            <Field>
              <FieldLabel>Windows 默认路径</FieldLabel>
              <Input
                value={windowsPath}
                onChange={(e) => setWindowsPath(e.target.value)}
                placeholder="例如：%USERPROFILE%\.config\opencode\opencode.json"
              />
              <p className="text-xs text-muted-foreground">支持 %APPDATA%、%USERPROFILE% 等环境变量</p>
            </Field>
            <Field>
              <FieldLabel>Mac 默认路径</FieldLabel>
              <Input
                value={macPath}
                onChange={(e) => setMacPath(e.target.value)}
                placeholder="例如：~/.config/opencode/opencode.json"
              />
              <p className="text-xs text-muted-foreground">支持 ~ 和 $HOME</p>
            </Field>
          </Group>

          <Group label="provider json路径与操作方法">
            <Field>
              <FieldLabel>provider gjson 路径</FieldLabel>
              <Input
                value={providerPath}
                onChange={(e) => setProviderPath(e.target.value)}
                placeholder="例如：provider"
              />
            </Field>
            <Field>
              <FieldLabel>model gjson 路径</FieldLabel>
              <Input
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                placeholder="例如：provider.{provider_id}.models"
              />
              <p className="text-xs text-muted-foreground">
                完整 gjson 路径，model 里用 {'{provider_id}'} 占位当前 provider 键名
              </p>
            </Field>

            <ModelInfoFieldsEditor value={modelInfoFields} onChange={setModelInfoFields} />

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>推荐配置</FieldLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setRecommendations((prev) => [
                      ...prev,
                      { scope: 'provider', key: '', description: '', type: 'string', recommended: null, required: false },
                    ])
                  }
                >
                  <AppIcon name="add" data-icon="inline-start" />
                  添加行
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                列出官方支持的字段、类型与推荐值；下方会在「管理模型」里与实际配置对比，缺/错/多会有行内标记，可一键套用推荐值
              </p>
              <RecommendationTable rows={recommendations} onChange={setRecommendations} />
            </Field>

            <ProtocolsEditor protocols={protocols} onChange={setProtocols} />
          </Group>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving || name.trim() === ''}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModelInfoFieldsEditor({
  value,
  onChange,
}: {
  value: AgentModelInfoFieldPaths
  onChange: (v: AgentModelInfoFieldPaths) => void
}) {
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>通用模型信息字段</FieldLabel>
      </div>
      <p className="text-xs text-muted-foreground">
        四个统一的模型信息字段在各 agent 配置里的写入路径；「同步模型信息」时按此映射写回
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-[40%] px-2 py-1.5 text-left font-medium">模型信息</th>
              <th className="px-2 py-1.5 text-left font-medium">字段名（gjson 路径）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MODEL_INFO_FIELD_KEYS.map((key) => (
              <tr key={key}>
                <td className="px-2 py-1.5">{MODEL_INFO_FIELD_LABELS[key]}</td>
                <td className="px-2 py-1.5">
                  <Input
                    value={value[key]}
                    onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                    placeholder="例如：limit.context"
                    className="h-7 text-xs font-mono"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Field>
  )
}

const PROTOCOL_CONDITION_OPS: readonly { value: AgentProtocolConditionOp; label: string }[] = [
  { value: 'equals', label: '等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'not_equals', label: '不等于' },
]

function ProtocolsEditor({
  protocols,
  onChange,
}: {
  protocols: AgentProtocol[]
  onChange: (protocols: AgentProtocol[]) => void
}) {
  const update = (idx: number, patch: Partial<AgentProtocol>) => {
    onChange(protocols.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }
  const remove = (idx: number) => {
    onChange(protocols.filter((_, i) => i !== idx))
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>请求协议区分部分（SDK）</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() =>
            onChange([
              ...protocols,
              { name: '', conditions: [{ field: '', op: 'contains', value: '' }], endpoint_tags: [], recommendations: [] },
            ])
          }
        >
          <AppIcon name="add" data-icon="inline-start" />
          添加协议
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        不同请求协议（SDK）的字段不同：这里的推荐只在协议命中时生效。每个协议可配多条判断条件（或关系）以及固定的「根据 endpoint 来判断」标签（必填）
      </p>
      {protocols.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          暂无请求协议，点上方「添加协议」开始
        </div>
      ) : (
        <div className="space-y-3">
          {protocols.map((p, idx) => (
            <div key={idx} className="rounded-md border border-border bg-muted/10">
              <div className="flex items-center gap-2 border-b border-border p-2">
                <Input
                  value={p.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="协议名称（例如：OpenAI SDK / OpenAI 兼容）"
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="删除该协议"
                  onClick={() => remove(idx)}
                >
                  <AppIcon name="delete" size={14} />
                </Button>
              </div>
              <div className="space-y-2 p-2">
                <ConditionRows
                  conditions={p.conditions}
                  onChange={(conditions) => update(idx, { conditions })}
                />
                <EndpointTagsInput
                  tags={p.endpoint_tags}
                  onChange={(endpoint_tags) => update(idx, { endpoint_tags })}
                />
                <div className="rounded-md border border-border bg-background p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">该协议的推荐配置</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        update(idx, {
                          recommendations: [
                            ...p.recommendations,
                            { scope: 'provider', key: '', description: '', type: 'string', recommended: null, required: false },
                          ],
                        })
                      }
                    >
                      <AppIcon name="add" data-icon="inline-start" />
                      添加行
                    </Button>
                  </div>
                  <RecommendationTable
                    rows={p.recommendations}
                    onChange={(recommendations) => update(idx, { recommendations })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Field>
  )
}

function ConditionRows({
  conditions,
  onChange,
}: {
  conditions: readonly AgentProtocolCondition[]
  onChange: (conditions: AgentProtocolCondition[]) => void
}) {
  const update = (idx: number, patch: Partial<AgentProtocolCondition>) => {
    onChange(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">判断条件（多条件为“或”关系）</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onChange([...conditions, { field: '', op: 'contains', value: '' }])}
        >
          <AppIcon name="add" data-icon="inline-start" />
          添加条件
        </Button>
      </div>
      {conditions.map((c, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Input
            value={c.field}
            onChange={(e) => update(idx, { field: e.target.value })}
            placeholder="provider 配置字段，例如 options.baseURL"
            className="h-7 flex-1 text-xs font-mono"
          />
          <Select
            value={c.op}
            onValueChange={(v) => update(idx, { op: v as AgentProtocolConditionOp })}
          >
            <SelectTrigger className="h-7 w-[92px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOL_CONDITION_OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={c.value}
            onChange={(e) => update(idx, { value: e.target.value })}
            placeholder="值"
            className="h-7 flex-1 text-xs font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(conditions.filter((_, i) => i !== idx))}
          >
            <AppIcon name="close" size={12} />
          </Button>
        </div>
      ))}
    </div>
  )
}

// EndpointTagsInput is the fixed "根据 endpoint 来判断" field. Typing a
// value and pressing space commits it as a tag; enter also commits.
// Tags are matched against model endpoints by suffix-contains during
// managed-provider sync (the SDK auto-selection hook).
function EndpointTagsInput({
  tags,
  onChange,
}: {
  tags: readonly string[]
  onChange: (tags: readonly string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const t = draft.trim()
    if (t === '') return
    if (!tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-destructive">
          根据 endpoint 来判断
          <span className="ml-1 text-muted-foreground">（必填，输入后按空格/回车变成标签）</span>
        </span>
      </div>
      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="group inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
          >
            {t}
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              <AppIcon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
          placeholder={tags.length === 0 ? '例如：/completions，末尾匹配模型的 endpoint' : ''}
          className="w-40 min-w-[110px] flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

function RecommendationTable({
  rows,
  onChange,
}: {
  rows: readonly AgentRecommendation[]
  onChange: (rows: AgentRecommendation[]) => void
}) {
  const update = (idx: number, patch: Partial<AgentRecommendation>) => {
    onChange(rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }
  const remove = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx))
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        暂无推荐配置，点上方「添加行」开始
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="w-[26%] px-2 py-1.5 text-left font-medium">字段名</th>
            <th className="w-[80px] px-2 py-1.5 text-left font-medium">作用域</th>
            <th className="w-[100px] px-2 py-1.5 text-left font-medium">类型</th>
            <th className="px-2 py-1.5 text-left font-medium">含义</th>
            <th className="w-[22%] px-2 py-1.5 text-left font-medium">推荐值</th>
            <th className="w-[60px] px-2 py-1.5 text-center font-medium">必填</th>
            <th className="w-[36px] px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, idx) => (
            <tr key={idx} className="align-top">
              <td className="px-2 py-1.5">
                <Input
                  value={row.key}
                  onChange={(e) => update(idx, { key: e.target.value })}
                  placeholder="例如：options.timeout"
                  className="h-7 text-xs font-mono"
                />
              </td>
              <td className="px-2 py-1.5">
                <Select
                  value={row.scope}
                  onValueChange={(v) => update(idx, { scope: v as AgentRecommendationScope })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECOMMENDATION_SCOPES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-2 py-1.5">
                <Select
                  value={row.type}
                  onValueChange={(v) => update(idx, { type: v as AgentRecommendationType })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECOMMENDATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-2 py-1.5">
                <Input
                  value={row.description}
                  onChange={(e) => update(idx, { description: e.target.value })}
                  placeholder="字段含义"
                  className="h-7 text-xs"
                />
              </td>
              <td className="px-2 py-1.5">
                <RecommendationValueInput row={row} onChange={(v) => update(idx, { recommended: v })} />
              </td>
              <td className="px-2 py-1.5 text-center">
                <Switch
                  checked={row.required}
                  onCheckedChange={(v) => update(idx, { required: v })}
                />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="删除"
                  onClick={() => remove(idx)}
                >
                  <AppIcon name="delete" size={14} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecommendationValueInput({
  row,
  onChange,
}: {
  row: AgentRecommendation
  onChange: (value: unknown) => void
}) {
  const raw = row.recommended
  const empty = raw === null || raw === undefined

  if (row.type === 'boolean') {
    const v = raw === true
    return (
      <Select
        value={empty ? '__empty__' : v ? 'true' : 'false'}
        onValueChange={(val) => {
          if (val === '__empty__') onChange(null)
          else onChange(val === 'true')
        }}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="（不填）" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">（不填）</SelectItem>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  if (row.type === 'number') {
    const display = empty ? '' : String(raw)
    return (
      <Input
        type="number"
        value={display}
        onChange={(e) => {
          const t = e.target.value.trim()
          if (t === '') onChange(null)
          else onChange(Number(t))
        }}
        placeholder="（不填）"
        className="h-7 text-xs font-mono"
      />
    )
  }

  if (row.type === 'object' || row.type === 'array') {
    const display = empty ? '' : JSON.stringify(raw)
    return (
      <Input
        value={display}
        onChange={(e) => {
          const t = e.target.value.trim()
          if (t === '') {
            onChange(null)
            return
          }
          try {
            onChange(JSON.parse(t))
          } catch {
            onChange(t)
          }
        }}
        placeholder='例如 {"type":"enabled"}'
        className="h-7 text-xs font-mono"
      />
    )
  }

  const display = empty ? '' : String(raw)
  return (
    <Input
      value={display}
      onChange={(e) => {
        const t = e.target.value
        if (t === '') onChange(null)
        else onChange(t)
      }}
      placeholder="（不填）"
      className="h-7 text-xs"
    />
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  )
}
