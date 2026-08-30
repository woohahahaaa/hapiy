import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { toast } from '@/components/ui/toast'
import {
  dashboardApi,
  DashboardApiError,
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentModelInfoFieldPaths,
  type AgentProtocol,
  type AgentProtocolConditionOp,
  type AgentRecommendation,
  type AgentRecommendationType,
  type AgentTypeRule,
} from '@/lib/dashboard-api'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : fallback
}

const JSONC_SEED = `{
  // 通用部分：与请求协议 / SDK 无关的官方字段
  "common": [
    {
      "name": "timeout",
      "key": "options.timeout",
      "scope": "provider",
      "description": "请求超时（毫秒）。默认 300000，复杂任务建议拉长到 600000",
      "required": false,
      "recommended": 600000,
      "candidates": {
        "300000": "官方默认，常规任务够用",
        "600000": "复杂任务建议，流式响应更稳"
      }
    }
  ],
  // 请求协议（SDK）区分部分：每个 SDK 一个块
  "protocols": [
    {
      "name": "OpenAI 兼容",
      // 命中条件（provider 配置块里的字段），多个条件为“或”关系
      "conditions": [
        { "field": "options.baseURL", "op": "contains", "value": "/v1" }
      ],
      // 必填：根据 endpoint 来判断（模型 endpoint 以标签结尾归属本协议）
      "endpoint_tags": ["/v1/chat/completions"],
      "fields": [
        {
          "name": "extraBody",
          "key": "options.extraBody",
          "scope": "provider",
          "description": "仅 OpenAI 兼容协议自带附加请求体",
          "required": false,
          "recommended": null
        }
      ]
    }
  ]
}
`

// stripJsoncComments removes // and /* */ comments so JSON.parse can
// read JSONC documents; string contents are left alone.
function stripJsoncComments(s: string): string {
  const out: string[] = []
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      out.push(c)
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out.push(c)
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i)
      if (end < 0) return out.join('')
      i = end
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      if (end < 0) return out.join('')
      i = end + 1
      continue
    }
    out.push(c)
  }
  return out.join('')
}

// parseRuleConfigJsonc validates + parses the {common, protocols} JSONC
// doc. Throws on invalid JSON / wrong shape.
function parseRuleConfigJsonc(text: string): {
  readonly common: AgentRecommendation[]
  readonly protocols: AgentProtocol[]
} {
  const cleaned = stripJsoncComments(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('顶层必须是 { common, protocols } 对象')
  }
  const rec = parsed as Record<string, unknown>
  const common = Array.isArray(rec.common) ? (rec.common as unknown[]) : []
  const protocols = Array.isArray(rec.protocols) ? (rec.protocols as unknown[]) : []
  return {
    common: common.map((c) => normalizeAgentRecommendation(c)),
    protocols: protocols.map((p) => normalizeAgentProtocol(p)),
  }
}

// normalizeAgentRecommendation coerces a JSONC field entry into the
// structured shape, inferring the type from recommended when absent.
function normalizeAgentRecommendation(value: unknown): AgentRecommendation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('common 里每一项必须是对象')
  }
  const v = value as Record<string, unknown>
  const key = typeof v.key === 'string' ? v.key : ''
  if (!key.trim()) throw new Error('字段缺少 key（字段路径）')
  const scope = v.scope === 'model' ? 'model' : 'provider'
  const recommended = v.recommended ?? null
  const type = inferRecommendationType(recommended)
  const candidates = v.candidates && typeof v.candidates === 'object' && !Array.isArray(v.candidates)
    ? (v.candidates as Record<string, unknown>)
    : undefined
  const cand: Record<string, string> = {}
  if (candidates) {
    for (const k of Object.keys(candidates)) {
      const val = candidates[k]
      if (typeof val === 'string') cand[k] = val
    }
  }
  return {
    name: typeof v.name === 'string' ? v.name : undefined,
    scope,
    key,
    description: typeof v.description === 'string' ? v.description : '',
    type,
    recommended,
    candidates: Object.keys(cand).length > 0 ? cand : undefined,
    required: v.required === true,
  }
}

function normalizeAgentProtocol(value: unknown): AgentProtocol {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('protocols 里每一项必须是对象')
  }
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string' || !v.name.trim()) {
    throw new Error('协议块缺少 name')
  }
  const conditions = Array.isArray(v.conditions) ? v.conditions : []
  const tags = Array.isArray(v.endpoint_tags) ? v.endpoint_tags : []
  if (tags.length === 0) {
    throw new Error(`协议「${v.name}」缺少 endpoint_tags（根据 endpoint 来判断，必填）`)
  }
  const fields = Array.isArray(v.fields) ? v.fields : []
  return {
    name: v.name,
    conditions: conditions.map((c) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        throw new Error(`协议「${v.name}」的 conditions 项格式错误`)
      }
      const cv = c as Record<string, unknown>
      const op = cv.op
      const valid = ['equals', 'contains', 'not_contains', 'not_equals']
      return {
        field: typeof cv.field === 'string' ? cv.field : '',
        op: typeof op === 'string' && valid.includes(op) ? (op as AgentProtocolConditionOp) : 'contains',
        value: typeof cv.value === 'string' ? cv.value : '',
      }
    }),
    endpoint_tags: tags.filter((t): t is string => typeof t === 'string'),
    recommendations: fields.map((f) => normalizeAgentRecommendation(f)),
  }
}

function inferRecommendationType(recommended: unknown): AgentRecommendationType {
  if (recommended === null || recommended === undefined) return 'string'
  if (typeof recommended === 'number') return 'number'
  if (typeof recommended === 'boolean') return 'boolean'
  if (Array.isArray(recommended)) return 'array'
  if (typeof recommended === 'object') return 'object'
  return 'string'
}

// buildRuleConfigJsonc constructs the JSONC document from the parsed
// recommendations + protocols (used as a fallback before the column
// exists, e.g. legacy seed rows).
function buildRuleConfigJsonc(
  recs: readonly AgentRecommendation[],
  protocols: readonly AgentProtocol[],
): string {
  const common = recs.map((r) => ({
    ...r,
    type: inferRecommendationType(r.recommended),
  }))
  const doc = {
    common,
    protocols: protocols.map((p) => ({
      name: p.name,
      conditions: p.conditions,
      endpoint_tags: p.endpoint_tags,
      fields: p.recommendations,
    })),
  }
  if (common.length === 0 && protocols.length === 0) return JSONC_SEED
  return JSON.stringify(doc, null, 2)
}

// formatRuleConfigJsonc strips comments + whitespace then re-pretty
// prints so users can tidy their JSONC.
function formatRuleConfigJsonc(text: string): string {
  const { common, protocols } = parseRuleConfigJsonc(text)
  return buildRuleConfigJsonc(common, protocols)
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
  const [configJsonc, setConfigJsonc] = useState('')
  const [jsoncError, setJsoncError] = useState<string | null>(null)
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
      setConfigJsonc(
        editing?.config_jsonc && editing.config_jsonc.trim() !== ''
          ? editing.config_jsonc
          : buildRuleConfigJsonc(editing?.recommendations ?? [], editing?.protocols ?? []),
      )
      setJsoncError(null)
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
    // Validate + parse the JSONC doc up front so the client gives
    // immediate feedback; the backend re-validates on write.
    let common: AgentRecommendation[]
    let protocols: AgentProtocol[]
    try {
      const parsed = parseRuleConfigJsonc(configJsonc)
      common = parsed.common
      protocols = parsed.protocols
    } catch (err) {
      setError('JSONC 解析失败：' + (err instanceof Error ? err.message : String(err)))
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
          recommendations: common,
          protocols,
          model_info_fields: modelInfoFields,
          config_jsonc: configJsonc,
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
                <FieldLabel>字段推荐配置（JSONC）</FieldLabel>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      try {
                        setConfigJsonc(formatRuleConfigJsonc(configJsonc))
                        setJsoncError(null)
                      } catch (err) {
                        setJsoncError(err instanceof Error ? err.message : '格式化失败')
                      }
                    }}
                  >
                    <AppIcon name="content_copy" data-icon="inline-start" />
                    格式化
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    title="恢复为编辑前的 JSONC 文本"
                    onClick={() =>
                      setConfigJsonc(
                        editing?.config_jsonc && editing.config_jsonc.trim() !== ''
                          ? editing.config_jsonc
                          : buildRuleConfigJsonc(editing?.recommendations ?? [], editing?.protocols ?? []),
                      )
                    }
                  >
                    还原
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                用 JSONC 直接编辑：上方「common」是通用字段；下方「protocols」按请求协议（SDK）区分。支持 // 与 /* */ 注释。字段格式：
                name（字段名）/ key（路径）/ description（含义）/ scope（provider|model）/ required（必填）/
                recommended（推荐值，null=推荐不填）/ candidates（多候选值说明，可选，type 由 recommended 自动推断）
              </p>
              <Textarea
                value={configJsonc}
                onChange={(e) => {
                  setConfigJsonc(e.target.value)
                  try {
                    parseRuleConfigJsonc(e.target.value)
                    setJsoncError(null)
                  } catch (err) {
                    setJsoncError(err instanceof Error ? err.message : String(err))
                  }
                }}
                className={
                  'h-[360px] resize-y font-mono text-xs leading-relaxed ' +
                  (jsoncError ? 'border-destructive focus-visible:ring-destructive' : '')
                }
                spellCheck={false}
              />
              {jsoncError && (
                <p className="text-[11px] text-destructive">{jsoncError}</p>
              )}
            </Field>
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


function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  )
}
