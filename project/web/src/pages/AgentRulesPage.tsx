import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
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
  AGENT_MODEL_INFO_FIELD_OPS,
  type AgentModelInfoFieldOp,
  type AgentModelsContainer,
  type AgentModelInfoFieldSpecValue,
  type AgentModelInfoFieldPaths,
  type AgentProtocol,
  type AgentProtocolCondition,
  type AgentProtocolConditionOp,
  type AgentRecommendation,
  type AgentTypeRule,
  type ModelInfoFieldKey,
} from '@/lib/dashboard-api'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : fallback
}

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
// structured shape.
function normalizeAgentRecommendation(value: unknown): AgentRecommendation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('common 里每一项必须是对象')
  }
  const v = value as Record<string, unknown>
  const key = typeof v.key === 'string' ? v.key : ''
  if (!key.trim()) throw new Error('字段缺少 key（字段路径）')
  const scope = v.scope === 'model' ? 'model' : 'provider'
  const recommended = v.recommended ?? null
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
    action: v.action === 'skip' || v.action === 'delete' ? v.action : undefined,
    recommended,
    candidates: Object.keys(cand).length > 0 ? cand : undefined,
    required: v.required === true,
    op: AGENT_MODEL_INFO_FIELD_OPS.includes(v.op as never) ? (v.op as (typeof AGENT_MODEL_INFO_FIELD_OPS)[number]) : undefined,
    sep: typeof v.sep === 'string' && v.sep !== '' ? v.sep : undefined,
    values: Array.isArray(v.values) ? v.values.filter((x): x is string => typeof x === 'string') : undefined,
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

// buildRuleConfigJsonc constructs the JSONC document from the parsed
// recommendations + protocols. Rules with neither yet (e.g. 刚创建的
// 空规则) serialize to an empty {common, protocols} doc instead of any
// prefilled sample, so unrelated agents never inherit fake recommendations.
function buildRuleConfigJsonc(
  recs: readonly AgentRecommendation[],
  protocols: readonly AgentProtocol[],
): string {
  const doc = {
    common: recs,
    protocols: protocols.map((p) => ({
      name: p.name,
      conditions: p.conditions,
      endpoint_tags: p.endpoint_tags,
      fields: p.recommendations,
    })),
  }
  return JSON.stringify(doc, null, 2)
}

// ── rule editor structured state ──────────────────────────────────────

// EndpointRuleEdit ─ one {protocol} card in the rule editor: a rule name,
// the endpoint keywords it inducts (归纳范围), and the endpoint's private
// fields JSON block (每个 endpoint 一个 JSON 块).
interface EndpointRuleEdit {
  readonly name: string
  readonly tagsText: string
  readonly conditions: readonly AgentProtocolCondition[]
  readonly fieldsJson: string
  readonly showJson?: boolean
}

// emptyEndpointRule is the starting card shape for a newly added endpoint rule.
function emptyEndpointRule(): EndpointRuleEdit {
  return {
    name: '',
    tagsText: '',
    conditions: [],
    fieldsJson: '[]',
  }
}

// fieldsJsonToRecs parses an endpoint's private fields JSON block array.
// Throws when the JSON is invalid or not an array.
function fieldsJsonToRecs(text: string): AgentRecommendation[] {
  const cleaned = stripJsoncComments(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('字段必须写成 JSON 数组，每项一个推荐字段对象')
  return parsed.map(normalizeAgentRecommendation)
}

function tagsTextToArray(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

// parseCommonArray parses the common JSON editor text into an array of
// recommendations. Throws on invalid JSON / non-array / bad rows.
function parseCommonArray(text: string): AgentRecommendation[] {
  const cleaned = stripJsoncComments(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('公共配置必须是 JSON 数组')
  return parsed.map(normalizeAgentRecommendation)
}

// ruleToProtocol converts an endpoint rule card into an AgentProtocol,
// returning an error string when the card is incomplete.
function ruleToProtocol(rule: EndpointRuleEdit, index: number): AgentProtocol | string {
  const name = rule.name.trim()
  if (!name) return `Endpoint 规则 #${index + 1}：缺少规则名称`
  const tags = tagsTextToArray(rule.tagsText)
  if (tags.length === 0) return `Endpoint 规则「${name}」：归纳范围为空（endpoint_tags 必填）`
  let recommendations: AgentRecommendation[]
  try {
    recommendations = fieldsJsonToRecs(rule.fieldsJson)
  } catch (err) {
    return `Endpoint 规则「${name}」的字段 JSON 解析失败：` + (err instanceof Error ? err.message : String(err))
  }
  return {
    name,
    conditions: [...rule.conditions],
    endpoint_tags: tags,
    recommendations,
  }
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

// ModelInfoFieldRow — 模型信息字段的结构化编辑状态：不再用 JSON 文本，
// 而是拆成 路径 / 写法(op) / sep / 允许值 / 操作 五列（与下方推荐字段表格
// 同一套「值 + 写法」规则）。
type ModelInfoFieldRow = {
  path: string
  action: 'set' | 'skip' | 'delete'
  op: AgentModelInfoFieldOp
  sep: string
  valuesText: string
}

const EMPTY_MODEL_INFO_ROW: ModelInfoFieldRow = {
  path: '',
  action: 'set',
  op: 'raw',
  sep: '',
  valuesText: '',
}

// modelInfoRowsFromSpecs 把持久化的字段值（纯路径字符串或「值&写法」对象）
// 归一为编辑器行。
function modelInfoRowsFromSpecs(
  mif: AgentModelInfoFieldPaths | undefined,
): Record<ModelInfoFieldKey, ModelInfoFieldRow> {
  const rows: Record<ModelInfoFieldKey, ModelInfoFieldRow> = {
    max_context: { ...EMPTY_MODEL_INFO_ROW },
    max_output_token: { ...EMPTY_MODEL_INFO_ROW },
    input_types: { ...EMPTY_MODEL_INFO_ROW },
    thinking_levels: { ...EMPTY_MODEL_INFO_ROW },
    reasoning_effort: { ...EMPTY_MODEL_INFO_ROW },
  }
  for (const key of MODEL_INFO_FIELD_KEYS) {
    const v = mif?.[key]
    if (typeof v === 'string') {
      if (v.trim() !== '') rows[key].path = v.trim()
      continue
    }
    if (v && typeof v.path === 'string') {
      rows[key].path = v.path.trim()
      rows[key].action = v.action ?? 'set'
      rows[key].op = v.op ?? 'raw'
      rows[key].sep = v.sep ?? ''
      rows[key].valuesText = (v.values ?? []).join(', ')
    }
  }
  return rows
}

// buildModelInfoFieldsPayload 把编辑器行组装回 API payload。空路径的行：
// 只填了写法（op/sep/允许值/操作）等内容时报错，否则跳过（不写该字段）。
function buildModelInfoFieldsPayload(
  rows: Record<ModelInfoFieldKey, ModelInfoFieldRow>,
): { fields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue>; error: string | null } {
  const fields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue> = {
    max_context: '',
    max_output_token: '',
    input_types: '',
    thinking_levels: '',
    reasoning_effort: '',
  }
  for (const key of MODEL_INFO_FIELD_KEYS) {
    const row = rows[key]
    const path = row.path.trim()
    if (path === '') {
      const hasOther = row.op !== 'raw' || row.action !== 'set' || row.sep.trim() !== '' || row.valuesText.trim() !== ''
      if (hasOther) {
        return { fields, error: `「${MODEL_INFO_FIELD_LABELS[key]}」请先填写路径` }
      }
      continue
    }
    const spec: { path: string; action?: 'set' | 'skip' | 'delete'; op?: AgentModelInfoFieldOp; sep?: string; values?: string[] } = { path }
    if (row.action !== 'set') spec.action = row.action
    if (row.op !== 'raw') spec.op = row.op
    if (row.sep.trim() !== '') spec.sep = row.sep.trim()
    const values = row.valuesText.split(',').map((s) => s.trim()).filter((s) => s !== '')
    if (values.length > 0) spec.values = values
    fields[key] = spec
  }
  return { fields, error: null }
}

const EMPTY_MODEL_INFO_ROWS: Record<ModelInfoFieldKey, ModelInfoFieldRow> = {
  max_context: { ...EMPTY_MODEL_INFO_ROW },
  max_output_token: { ...EMPTY_MODEL_INFO_ROW },
  input_types: { ...EMPTY_MODEL_INFO_ROW },
  thinking_levels: { ...EMPTY_MODEL_INFO_ROW },
  reasoning_effort: { ...EMPTY_MODEL_INFO_ROW },
}

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
  const [modelsContainer, setModelsContainer] = useState<AgentModelsContainer>('')
  // 结构化的字段推荐编辑器：公共配置一个 JSON（common），每个 endpoint
  // 一套独立规则（名称 / 归纳范围关键词 / 字段推荐值表）。
  const [commonText, setCommonText] = useState('[]')
  const [commonError, setCommonError] = useState<string | null>(null)
  const [showCommonJson, setShowCommonJson] = useState(false)
  const [endpointRules, setEndpointRules] = useState<readonly EndpointRuleEdit[]>([])
  const [modelInfoRows, setModelInfoRows] = useState<Record<ModelInfoFieldKey, ModelInfoFieldRow>>(EMPTY_MODEL_INFO_ROWS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 「使用默认推荐模版」二次确认框。
  const [confirmTemplate, setConfirmTemplate] = useState(false)
  const [templateLoading, setTemplateLoading] = useState(false)

  // fillFromParts fills the recommendation editors from parsed common /
  // protocols / model-info texts — shared by the open effect and the
  // 「使用默认推荐模版」 flow.
  const fillFromParts = useCallback((
    common: readonly AgentRecommendation[],
    protocols: readonly AgentProtocol[],
    mif: AgentModelInfoFieldPaths | undefined,
  ) => {
    setCommonText(JSON.stringify(common, null, 2))
    setCommonError(null)
    setEndpointRules(protocols.map((p) => ({
      name: p.name,
      tagsText: p.endpoint_tags.join(', '),
      conditions: p.conditions ?? [],
      fieldsJson: JSON.stringify(p.recommendations ?? [], null, 2),
    })))
    setModelInfoRows(modelInfoRowsFromSpecs(mif))
  }, [])

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setWindowsPath(editing?.os_paths.windows ?? '')
      setMacPath(editing?.os_paths.mac ?? '')
      setProviderPath(editing?.json_paths.provider ?? '')
      setModelPath(editing?.json_paths.model ?? '')
      setModelsContainer(editing?.json_paths.models_container ?? '')
      // 从既有规则拆出 common 与 protocols：优先用 config_jsonc 原文，
      // 缺失时用结构化字段兜底。
      let common: readonly AgentRecommendation[]
      let protocols: readonly AgentProtocol[]
      try {
        const parsed = parseRuleConfigJsonc(
          editing?.config_jsonc && editing.config_jsonc.trim() !== ''
            ? editing.config_jsonc
            : buildRuleConfigJsonc(editing?.recommendations ?? [], editing?.protocols ?? []),
        )
        common = parsed.common
        protocols = parsed.protocols
      } catch (err) {
        setError('解析既有配置失败：' + (err instanceof Error ? err.message : String(err)))
        common = editing?.recommendations ?? []
        protocols = editing?.protocols ?? []
      }
      fillFromParts(common, protocols, editing?.model_info_fields)
      setError(null)
      setConfirmTemplate(false)
      setTemplateLoading(false)
      setSaving(false)
    }
  }, [open, editing, fillFromParts])

  // applyDefaultTemplate loads the same-named default recommendation
  // template (config/agent-templates/<name>.json) and fills the whole
  // dialog: paths + the four model-info fields + common JSON + every
  // endpoint rule card.
  const applyDefaultTemplate = async () => {
    const ruleName = editing?.name.trim()
    if (!ruleName) return
    setTemplateLoading(true)
    try {
      const tmpl = await dashboardApi.getAgentTypeRuleTemplate(ruleName)
      setWindowsPath(tmpl.os_paths.windows ?? '')
      setMacPath(tmpl.os_paths.mac ?? '')
      setProviderPath(tmpl.json_paths.provider ?? '')
      setModelPath(tmpl.json_paths.model ?? '')
      setModelsContainer(tmpl.json_paths.models_container ?? '')
      fillFromParts(tmpl.recommendations, tmpl.protocols, tmpl.model_info_fields)
      setError(null)
      setConfirmTemplate(false)
      toast('已应用默认推荐模版，检查后保存即可生效')
    } catch (err) {
      setError(toErrorMessage(err, '加载默认推荐模版失败'))
    } finally {
      setTemplateLoading(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写名称')
      return
    }
    // 公共配置 JSON 必须可解析成数组。
    let common: AgentRecommendation[]
    try {
      common = parseCommonArray(commonText)
    } catch (err) {
      setError('公共配置 JSON 解析失败：' + (err instanceof Error ? err.message : String(err)))
      return
    }
    // 每个 endpoint 规则的名称 / 归纳范围 / 字段推荐表校验。
    const protocols: AgentProtocol[] = []
    for (let i = 0; i < endpointRules.length; i++) {
      const converted = ruleToProtocol(endpointRules[i], i)
      if (typeof converted === 'string') {
        setError(converted)
        return
      }
      protocols.push(converted)
    }
    // 组装回 config_jsonc，保持与结构化编辑同步。
    const configJsonc = buildRuleConfigJsonc(common, protocols)
    const { fields: modelInfoFields, error: mifError } = buildModelInfoFieldsPayload(modelInfoRows)
    if (mifError) {
      setError(mifError)
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
          models_container: modelsContainer,
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
      <DialogContent width="xl" scrollFooter>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            {editing?.has_template && (
              <Button
                variant="outline"
                className="mr-auto"
                onClick={() => setConfirmTemplate(true)}
                disabled={saving || templateLoading}
                title="将该规则的全部字段（路径 / 模型信息字段 / 公共配置 / 各 Endpoint 规则）重置为系统默认推荐模版"
              >
                <AppIcon name="auto_fix_high" data-icon="inline-start" />
                使用默认推荐模版
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
            <Button onClick={() => void handleSave()} disabled={saving || name.trim() === ''}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </>
        }>
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

          <Group label="供应商与模型推荐配置表">
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
            <Field>
              <FieldLabel>模型列表容器格式（models_container）</FieldLabel>
              <Select
                value={modelsContainer || 'object'}
                onValueChange={(v) => setModelsContainer(v === 'object' ? '' : 'array')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择格式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="array">数组 [{'{"id": ...}'}]（openclaw）</SelectItem>
                  <SelectItem value="object">对象 map {'{"模型id": {...}}'}（opencode）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                决定托管同步时 models 写进配置文件的样子。数组每项带 id；对象以模型名做键。选错会导致 agent 启动校验失败
              </p>
            </Field>

            <ModelInfoFieldsEditor value={modelInfoRows} onChange={setModelInfoRows} />

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>公共配置（common）</FieldLabel>
              </div>
              <p className="text-xs text-muted-foreground">
                与请求协议 / SDK 无关的字段推荐值。每行一个字段：路径 / 落在（provider|model）/ 推荐操作（填 / 不填 / 删除）/
                推荐值 / 值写法（op / sep / 允许值白名单）/ 必填 / 说明。与页面里其余配置用同一套「值 + 写法」规则。
              </p>
              <div className="flex items-center justify-end py-1">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2"
                  onClick={() => setShowCommonJson((v) => !v)}
                >
                  {showCommonJson ? '收起 JSON' : '编辑 JSON'}
                </button>
              </div>
              {showCommonJson ? (
                <>
                  <Textarea
                    value={commonText}
                    onChange={(e) => {
                      setCommonText(e.target.value)
                      try {
                        parseCommonArray(e.target.value)
                        setCommonError(null)
                      } catch (err) {
                        setCommonError(err instanceof Error ? err.message : String(err))
                      }
                    }}
                    className={
                      'h-[180px] resize-y font-mono text-xs leading-relaxed ' +
                      (commonError ? 'border-destructive focus-visible:ring-destructive' : '')
                    }
                    spellCheck={false}
                  />
                  {commonError && (
                    <p className="text-[11px] text-destructive">{commonError}</p>
                  )}
                </>
              ) : (
                (() => {
                  try {
                    const commonRecs = parseCommonArray(commonText)
                    return (
                      <RecommendationTable
                        showScope
                        recs={commonRecs}
                        onChange={(next) => setCommonText(JSON.stringify(next, null, 2))}
                      />
                    )
                  } catch (err) {
                    return (
                      <>
                        <p className="pb-1 text-[11px] text-destructive">
                          当前公共配置不是合法 JSON：{(err instanceof Error ? err.message : String(err))}，
                          请在「编辑 JSON」里修正
                        </p>
                        <Textarea
                          value={commonText}
                          onChange={(e) => setCommonText(e.target.value)}
                          className="h-[120px] resize-y font-mono text-xs leading-relaxed border-destructive"
                          spellCheck={false}
                        />
                      </>
                    )
                  }
                })()
              )}
            </Field>

            <EndpointRulesEditor value={endpointRules} onChange={setEndpointRules} />
          </Group>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
        </DialogScrollBody>
      </DialogContent>

      <Dialog open={confirmTemplate} onOpenChange={(o) => !o && setConfirmTemplate(false)}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>使用默认推荐模版</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={() => setConfirmTemplate(false)} disabled={templateLoading}>取消</Button>
              <Button variant="default" onClick={() => void applyDefaultTemplate()} disabled={templateLoading}>
                {templateLoading ? '加载中…' : '确认应用'}
              </Button>
            </>
          }>
            <p className="text-xs text-muted-foreground">
              <span className="break-all">将为规则「{editing?.name ?? ''}」应用系统的默认推荐模版：</span>
              默认路径、provider/model gjson 路径、模型信息字段、公共配置（common）与各 Endpoint
              规则的字段推荐会全部替换为默认值。确认？
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

const REC_ACTIONS = ['set', 'skip', 'delete'] as const
const REC_ACTION_LABEL: Record<string, string> = {
  set: '填',
  skip: '不填',
  delete: '删除',
}

// RecommendationTable — 结构化字段推荐编辑器，同时用于公共配置与每个
// endpoint 的私有配置。每行一个推荐字段：路径 / 推荐操作 / 推荐值 /
// 值写法（op/sep/values 白名单）/ 必填 / 说明。与非结构化 JSON 文本
// 双向同步由调用方负责。
function RecommendationTable({
  recs,
  onChange,
  showScope = false,
}: {
  recs: readonly AgentRecommendation[]
  onChange: (recs: AgentRecommendation[]) => void
  showScope?: boolean
}) {
  const update = (index: number, patch: (r: AgentRecommendation) => AgentRecommendation) => {
    onChange(recs.map((r, i) => (i === index ? patch(r) : r)))
  }
  const addRow = () => {
    onChange([...recs, { scope: 'model', key: '', description: '', recommended: null, required: false }])
  }
  const valueToText = (v: unknown): string => {
    if (v === undefined || v === null) return ''
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  }
  const textToValue = (text: string, fallback: unknown): unknown => {
    const t = text.trim()
    if (t === '') return fallback
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-end border-b border-border bg-muted/40 px-2 py-1">
        <Button type="button" variant="outline" size="xs" onClick={addRow}>
          添加字段
        </Button>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="w-[16%] px-2 py-1.5 text-left font-medium">路径</th>
            {showScope ? <th className="w-[8%] px-2 py-1.5 text-left font-medium">作用范围</th> : null}
            <th className="w-[9%] px-2 py-1.5 text-left font-medium">操作</th>
            <th className="w-[13%] px-2 py-1.5 text-left font-medium">推荐值</th>
            <th className="w-[7%] px-2 py-1.5 text-left font-medium">op</th>
            <th className="w-[7%] px-2 py-1.5 text-left font-medium">sep</th>
            <th className="w-[16%] px-2 py-1.5 text-left font-medium">允许值</th>
            <th className="w-[6%] px-2 py-1.5 text-left font-medium">必填</th>
            <th className="w-[13%] px-2 py-1.5 pl-0 text-left font-medium">说明</th>
            <th className="w-[5%] px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recs.length === 0 ? (
            <tr>
              <td colSpan={showScope ? 10 : 9} className="px-2 py-2 text-muted-foreground">
                暂无字段；点击「添加字段」开始。
              </td>
            </tr>
          ) : (
            recs.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-1">
                  <Input
                    value={r.key}
                    onChange={(e) => update(i, (x) => ({ ...x, key: e.target.value }))}
                    className="h-6 text-xs font-mono"
                    placeholder="options.baseURL"
                  />
                </td>
                {showScope ? (
                  <td className="px-2 py-1">
                    <Select value={r.scope} onValueChange={(v) => update(i, (x) => ({ ...x, scope: v as 'provider' | 'model' }))}>
                      <SelectTrigger className="h-6 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="provider">provider</SelectItem>
                        <SelectItem value="model">model</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                ) : null}
                <td className="px-2 py-1">
                  <Select
                    value={r.action ?? 'set'}
                    onValueChange={(v) => update(i, (x) => ({ ...x, action: v === 'set' ? undefined : (v as 'skip' | 'delete') }))}
                  >
                    <SelectTrigger className="h-6 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REC_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {REC_ACTION_LABEL[a]}
                          {a === 'set' ? '（推荐填）' : a === 'skip' ? '（推荐不填）' : '（删除字段）'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={valueToText(r.recommended)}
                    onChange={(e) => {
                      const v = textToValue(e.target.value, null)
                      if (v === null && e.target.value.trim() === '') {
                        update(i, (x) => ({ ...x, recommended: null }))
                      } else {
                        update(i, (x) => ({ ...x, recommended: v }))
                      }
                    }}
                    className="h-6 text-xs font-mono"
                    placeholder="null"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={r.op ?? 'raw'}
                    onValueChange={(v) => update(i, (x) => ({ ...x, op: v === 'raw' ? undefined : (v as 'bool' | 'first' | 'join') }))}
                  >
                    <SelectTrigger className="h-6 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="raw">raw</SelectItem>
                      <SelectItem value="bool">bool</SelectItem>
                      <SelectItem value="first">first</SelectItem>
                      <SelectItem value="join">join</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={r.sep ?? ''}
                    onChange={(e) => update(i, (x) => ({ ...x, sep: e.target.value || undefined }))}
                    className="h-6 text-xs font-mono"
                    placeholder=","
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={(r.values ?? []).join(', ')}
                    onChange={(e) =>
                      update(i, (x) => ({
                        ...x,
                        values: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }))
                    }
                    className="h-6 text-xs font-mono"
                    placeholder="text, image, video（逗号分隔）"
                  />
                </td>
                <td className="px-2 py-1">
                   <div className="flex h-6 items-center">
                     <Checkbox
                       checked={r.required}
                       onCheckedChange={(c) => update(i, (x) => ({ ...x, required: c === true }))}
                     />
                   </div>
                 </td>
                 <td className="px-2 py-1">
                  <Input
                    value={r.description}
                    onChange={(e) => update(i, (x) => ({ ...x, description: e.target.value }))}
                    className="h-6 text-xs font-mono"
                    placeholder="说明"
                  />
                 </td>
                  <td className="px-2 py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-destructive"
                      onClick={() => onChange(recs.filter((_, j) => j !== i))}
                    >
                      删除
                    </Button>
                  </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function ModelInfoFieldsEditor({
  value,
  onChange,
}: {
  value: Record<ModelInfoFieldKey, ModelInfoFieldRow>
  onChange: (v: Record<ModelInfoFieldKey, ModelInfoFieldRow>) => void
}) {
  const update = (key: ModelInfoFieldKey, patch: Partial<ModelInfoFieldRow>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } })
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>模型通用信息</FieldLabel>
      </div>
      <p className="text-xs text-muted-foreground">
        模型信息字段在各 agent 配置里的写入方式；「同步模型信息」与托管生成按此写回。每行一个字段：
        路径为写入位置，写法（op）可选 raw（原样，默认）/ bool（非空→true，空→false）/ first（取第一个元素）/
        join（数组拼接，可填 sep，默认逗号）；操作可选 填（默认）/ 不填 / 删除字段；允许值为白名单（如 openclaw input
        只允许 text/image/video/audio），逗号分隔。
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-[8.5rem] px-2 py-1.5 text-left font-medium">模型信息</th>
              <th className="w-40 px-2 py-1.5 text-left font-medium">路径</th>
              <th className="w-[5rem] px-2 py-1.5 text-left font-medium">写法</th>
              <th className="w-[3.5rem] px-2 py-1.5 text-left font-medium">sep</th>
              <th className="px-2 py-1.5 text-left font-medium">允许值</th>
              <th className="w-[5.5rem] px-2 py-1.5 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MODEL_INFO_FIELD_KEYS.map((key) => (
              <tr key={key}>
                <td className="px-2 py-1.5">{MODEL_INFO_FIELD_LABELS[key]}</td>
                <td className="px-2 py-1">
                  <Input
                    value={value[key].path}
                    onChange={(e) => update(key, { path: e.target.value })}
                    placeholder="reasoning"
                    className="h-6 text-xs font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select value={value[key].op} onValueChange={(v) => update(key, { op: v as AgentModelInfoFieldOp })}>
                    <SelectTrigger className="h-6 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_MODEL_INFO_FIELD_OPS.map((op) => (
                        <SelectItem key={op} value={op}>
                          {op}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={value[key].sep}
                    onChange={(e) => update(key, { sep: e.target.value })}
                    placeholder=","
                    className="h-6 text-xs font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={value[key].valuesText}
                    onChange={(e) => update(key, { valuesText: e.target.value })}
                    placeholder="text, image, video（逗号分隔）"
                    className="h-6 text-xs font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={value[key].action}
                    onValueChange={(v) => update(key, { action: v as 'set' | 'skip' | 'delete' })}
                  >
                    <SelectTrigger className="h-6 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REC_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {REC_ACTION_LABEL[a]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

// EndpointRulesEditor ─ 动态的 endpoint 规则列表：手动点「添加」才出现一张
// 卡片；每张卡片 = 规则名称 + 归纳范围（endpoint 关键词，逗号分隔）+
// 私有配置 JSON 块（该 endpoint 的字段推荐值，一个 endpoint 一个 JSON 块）。
function EndpointRulesEditor({
  value,
  onChange,
}: {
  value: readonly EndpointRuleEdit[]
  onChange: (v: readonly EndpointRuleEdit[]) => void
}) {
  const update = (index: number, patch: (rule: EndpointRuleEdit) => EndpointRuleEdit) => {
    onChange(value.map((rule, i) => (i === index ? patch(rule) : rule)))
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>Endpoint 规则（按 SDK 区分，一个规则一张卡片）</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onChange([...value, emptyEndpointRule()])}
        >
          添加 Endpoint 规则
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        每个 endpoint 一条规则：归纳范围填 endpoint 关键词（如
        completions / responses / chat/message，逗号分隔），任一关键词命中该
        endpoint 的子串即应用本规则，顺序即优先级。私有配置用「值 + 写法」表格：
        每行一个推荐字段（路径 / 落在 / 推荐操作 / 推荐值 / op / sep / 允许值白名单），
        scope（provider|model）/ required（必填）/ recommended（推荐值，null=推荐不填）
        —— 如 NPM 用哪个 SDK 就填 key=npm、推荐值={'{"@ai-sdk/openai-compatible"'}+、必填勾上。
      </p>

      {value.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          尚未添加任何 Endpoint 规则；点击右上「添加 Endpoint 规则」新建。
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((rule, ruleIndex) => {
            let fieldsError: string | null = null
            try {
              fieldsJsonToRecs(rule.fieldsJson)
            } catch (err) {
              fieldsError = err instanceof Error ? err.message : String(err)
            }
            return (
              <div key={ruleIndex} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Endpoint 规则 {ruleIndex + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => onChange(value.filter((_, i) => i !== ruleIndex))}
                  >
                    删除
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-2 items-start gap-3">
                  <Field>
                    <FieldLabel>规则名称</FieldLabel>
                    <Input
                      value={rule.name}
                      onChange={(e) => update(ruleIndex, (r) => ({ ...r, name: e.target.value }))}
                      placeholder="例如：OpenAI 兼容 Chat Completions"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>归纳范围（endpoint 关键词，逗号分隔）</FieldLabel>
                    <Input
                      value={rule.tagsText}
                      onChange={(e) => update(ruleIndex, (r) => ({ ...r, tagsText: e.target.value }))}
                      placeholder="例如：completions, /v1/chat, responses, chat/message"
                      className="font-mono"
                    />
                  </Field>
                </div>

                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel>私有配置（该 endpoint 的字段推荐表）</FieldLabel>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2"
                      onClick={() => update(ruleIndex, (r) => ({ ...r, showJson: !r.showJson }))}
                    >
                      {rule.showJson ? '收起 JSON' : '编辑 JSON'}
                    </button>
                  </div>
                  {rule.showJson ? (
                    <>
                      <Textarea
                        value={rule.fieldsJson}
                        onChange={(e) => update(ruleIndex, (r) => ({ ...r, fieldsJson: e.target.value }))}
                        className={
                          'h-[140px] resize-y font-mono text-xs leading-relaxed ' +
                          (fieldsError ? 'border-destructive focus-visible:ring-destructive' : '')
                        }
                        spellCheck={false}
                      />
                      {fieldsError && (
                        <p className="text-[11px] text-destructive">{fieldsError}</p>
                      )}
                    </>
                  ) : (
                    (() => {
                      try {
                        const recs = fieldsJsonToRecs(rule.fieldsJson)
                        return (
                          <RecommendationTable
                            showScope
                            recs={recs}
                            onChange={(next) => update(ruleIndex, (r) => ({ ...r, fieldsJson: JSON.stringify(next, null, 2) }))}
                          />
                        )
                      } catch (err) {
                        return (
                          <>
                            <p className="pb-1 text-[11px] text-destructive">
                              当前私有配置不是合法 JSON：{(err instanceof Error ? err.message : String(err))}，
                              请在「编辑 JSON」里修正
                            </p>
                            <Textarea
                              value={rule.fieldsJson}
                              onChange={(e) => update(ruleIndex, (r) => ({ ...r, fieldsJson: e.target.value }))}
                              className="h-[120px] resize-y font-mono text-xs leading-relaxed border-destructive"
                              spellCheck={false}
                            />
                          </>
                        )
                      }
                    })()
                  )}
                </Field>
              </div>
            )
          })}
        </div>
      )}
    </Field>
  )
}
