import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n/i18n'
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
  parseAgentModelInfoSpec,
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
import {
  EMPTY_MODEL_INFO_ROWS,
  buildModelInfoFieldsPayload,
  modelInfoRowsFromSpecs,
  type ModelInfoFieldRow,
} from '@/pages/agentRulesModelInfo'
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
    throw new Error(i18n.t('agentRules:errors.topMustBeObject'))
  }
  const rec = parsed as Record<string, unknown>
  const common = Array.isArray(rec.common) ? rec.common : []
  const protocols = Array.isArray(rec.protocols) ? rec.protocols : []
  return {
    common: recsFromUnknownArray(common),
    protocols: protocols.map((p) => normalizeAgentProtocol(p)),
  }
}

// coerceRecommendation coerces a JSON field entry into the structured
// shape without requiring key; the array parsers pair it with
// recsFromUnknownArray (blank rows dropped, remaining rows validated).
function coerceRecommendation(value: unknown): AgentRecommendation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(i18n.t('agentRules:errors.fieldItemMustBeObject'))
  }
  const v = value as Record<string, unknown>
  const key = typeof v.key === 'string' ? v.key : ''
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
    throw new Error(i18n.t('agentRules:errors.protocolItemMustBeObject'))
  }
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string' || !v.name.trim()) {
    throw new Error(i18n.t('agentRules:errors.protocolMissingName'))
  }
  const conditions = Array.isArray(v.conditions) ? v.conditions : []
  const tags = Array.isArray(v.endpoint_tags) ? v.endpoint_tags : []
  if (tags.length === 0) {
    throw new Error(i18n.t('agentRules:errors.protocolMissingTags', { name: v.name }))
  }
  const fields = Array.isArray(v.fields) ? v.fields : []
  return {
    name: v.name,
    conditions: conditions.map((c) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        throw new Error(i18n.t('agentRules:errors.protocolConditionInvalid', { name: v.name }))
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
    recommendations: recsFromUnknownArray(fields),
  }
}

// isEmptyRecommendation — 全空的推荐字段行（表格里新增却没填任何内容的
// 空行）。保存时静默丢弃这类行，不再报错。
function isEmptyRecommendation(r: AgentRecommendation): boolean {
  return r.key.trim() === ''
    && (r.recommended ?? null) === null
    && (!r.candidates || Object.keys(r.candidates).length === 0)
    && !r.required
    && r.action === undefined
    && r.op === undefined
    && (r.sep ?? '') === ''
    && (!r.values || r.values.length === 0)
    && (r.description ?? '') === ''
}

// recsFromUnknownArray coerces raw field entries into recommendations:
// blank rows are dropped, remaining rows must carry a key.
function recsFromUnknownArray(items: readonly unknown[]): AgentRecommendation[] {
  const out = items.map(coerceRecommendation).filter((r) => !isEmptyRecommendation(r))
  for (const r of out) {
    if (!r.key.trim()) throw new Error(i18n.t('agentRules:errors.fieldMissingKey'))
  }
  return out
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
// fields table (每个 endpoint 一个字段推荐表).
interface EndpointRuleEdit {
  readonly name: string
  readonly tagsText: string
  readonly conditions: readonly AgentProtocolCondition[]
  readonly fieldsJson: string
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
  if (!Array.isArray(parsed)) throw new Error(i18n.t('agentRules:errors.fieldsMustBeArray'))
  return recsFromUnknownArray(parsed)
}

function tagsTextToArray(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

// parseCommonArray parses the common config storage text into an array of
// recommendations. Throws on invalid JSON / non-array / bad rows; blank
// rows are dropped (isRecommendationRowEmpty).
function parseCommonArray(text: string): AgentRecommendation[] {
  const cleaned = stripJsoncComments(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error(i18n.t('agentRules:errors.commonMustBeArray'))
  return recsFromUnknownArray(parsed)
}

// isEmptyEndpointRule — 一张 Endpoint 卡片是否整行空白（名称 / 归纳范围 /
// 条件 / 字段全部为空）。保存时空白卡片直接丢弃。
function isEmptyEndpointRule(rule: EndpointRuleEdit): boolean {
  if (rule.name.trim() !== '' || rule.tagsText.trim() !== '' || rule.conditions.length > 0) return false
  try {
    return fieldsJsonToRecs(rule.fieldsJson).length === 0
  } catch {
    return false
  }
}

// ruleToProtocol converts an endpoint rule card into an AgentProtocol,
// returning an error string when the card is incomplete.
function ruleToProtocol(rule: EndpointRuleEdit, index: number): AgentProtocol | string {
  const name = rule.name.trim()
  if (!name) return i18n.t('agentRules:errors.endpointRuleMissingName', { n: index + 1 })
  const tags = tagsTextToArray(rule.tagsText)
  if (tags.length === 0) return i18n.t('agentRules:errors.endpointRuleTagsEmpty', { name })
  let recommendations: AgentRecommendation[]
  try {
    recommendations = fieldsJsonToRecs(rule.fieldsJson)
  } catch (err) {
    return i18n.t('agentRules:errors.endpointRuleFieldsParseFailed', { name }) + (err instanceof Error ? err.message : String(err))
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
  const { t } = useTranslation('agentRules')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('common:nav.agent')}
        description={t('page.description')}
      />
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <AgentTypeRulesTab />
      </div>
    </div>
  )
}

function AgentTypeRulesTab() {
  const { t, i18n } = useTranslation('agentRules')
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
      setError(toErrorMessage(err, t('errors.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [t, i18n.language])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDelete = async (row: AgentTypeRule) => {
    setMutating(true)
    setConfirmDelete(null)
    try {
      await dashboardApi.deleteAgentTypeRule(row.id)
      toast(t('toast.deleted'))
      void fetch()
    } catch (err) {
      toast.error(toErrorMessage(err, t('errors.deleteFailed')))
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<AgentTypeRule>[] = useMemo(() => [
    {
      key: 'name',
      label: t('columns.name'),
      defaultWidth: { kind: 'percent', value: 50 },
      accessor: (row) => row.name,
    },
    {
      key: 'createdAt',
      label: t('columns.createdAt'),
      defaultWidth: { kind: 'pixel', value: 180 },
      slot: {
        line1: (row) => formatDate(row.created_at),
        line2: (row) => formatTime(row.created_at),
      },
    },
    {
      key: 'actions',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 90 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title={t('common:action.edit')}
            onClick={() => setEditingRule(row)}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={mutating}
            title={t('common:action.delete')}
            onClick={() => setConfirmDelete(row)}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ], [mutating, t])

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
        emptyText={t('list.empty')}
        onRetry={() => void fetch()}
        actions={
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <AppIcon name="add" data-icon="inline-start" />
            {t('list.add')}
          </Button>
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
        title={t('dialog.deleteTitle')}
        description={t('dialog.deleteDescription', { name: confirmDelete?.name ?? '' })}
        busy={mutating}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete)
        }}
      />
    </>
  )
}

// ── 添加 / 编辑规则 ──

// 模型信息字段的行状态与 payload 组装在 agentRulesModelInfo.ts（含
// variantShape 往返，避免编辑一次规则就丢掉 V2 的数组形状）。

// ── 整弹窗 JSON 编辑模式 ──────────────────────────────────────────────

// RuleDialogDoc — 「切换到 JSON 编辑模式」里展示 / 编辑的整份弹窗 JSON。
// 形状与后端 API 一致，方便对照；common 里协议块的私有字段仍叫 fields。
type RuleDialogDoc = {
  readonly name: string
  readonly os_paths: { readonly windows: string; readonly mac: string }
  readonly json_paths: {
    readonly provider: string
    readonly model: string
    readonly models_container: AgentModelsContainer
  }
  readonly model_info_fields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue>
  readonly common: readonly AgentRecommendation[]
  readonly protocols: readonly AgentProtocol[]
}

// buildDialogDoc 从当前表格态构造整份 JSON 文档（宽松：不校验必填项，
// 半填的行原样带出，校验留到保存 / 切回表格时做）。
function buildDialogDoc(state: {
  name: string
  windowsPath: string
  macPath: string
  providerPath: string
  modelPath: string
  modelsContainer: AgentModelsContainer
  modelInfoRows: Record<ModelInfoFieldKey, ModelInfoFieldRow>
  common: readonly AgentRecommendation[]
  protocols: readonly AgentProtocol[]
}): RuleDialogDoc {
  const { fields } = buildModelInfoFieldsPayload(state.modelInfoRows)
  return {
    name: state.name,
    os_paths: { windows: state.windowsPath, mac: state.macPath },
    json_paths: {
      provider: state.providerPath,
      model: state.modelPath,
      models_container: state.modelsContainer,
    },
    model_info_fields: fields,
    common: state.common,
    protocols: state.protocols,
  }
}

// reindentJson 把 JSON.stringify(x, null, 2) 产出的文本整体右移 extraIndent，
// 用于把子对象嵌进外层对象时保持缩进正确（首行不缩）。
function reindentJson(json: string, extraIndent: string): string {
  return json.split('\n').map((line, i) => (i === 0 ? line : extraIndent + line)).join('\n')
}

// buildDialogDocJsonc 把整份文档序列化成带说明注释的 JSONC：顶部一段总览，
// 每个顶层区块前一行短注释，方便把这份文档交给其他 Agent 时能读懂结构。
// parseDialogDoc 会先剥掉 // 注释再解析，因此注释不影响校验 / 保存。
function buildDialogDocJsonc(doc: RuleDialogDoc): string {
  const header = [
    '// ───────────────────────────────────────────────────────────────',
    '// 接管规则 JSONC（支持 // 注释；交给别的 Agent 处理时请先读这段说明）',
    '//',
    '// name                    规则名称（唯一，对应一个 Agent 软件类型，如 opencode）',
    '// os_paths                该软件的配置文件默认路径',
    '//   windows              Windows 路径（支持 %USERPROFILE%、%APPDATA% 等环境变量）',
    '//   mac                  macOS 路径（支持 ~、$HOME）',
    '// json_paths              在配置文件里定位 provider / model 的 gjson 路径',
    '//   provider             供应商列表路径',
    '//   model                model 路径（用 {provider_id} 占位当前供应商键名）',
    '//   models_container     object=以模型名做键（opencode）；array=数组每项带 id（openclaw）',
    '// model_info_fields       模型信息字段在各 agent 配置里的写入方式（每项 string 或 {path, op, sep, values, action}）',
    '//   path                写入位置（gjson 路径）',
    '//   op                  raw(原样，默认)/bool(非空→true)/first(取第一个)/join(拼接)',
    '//   sep                 join 的分隔符（默认逗号）',
    '//   values              允许值白名单（如 openclaw input 只允许 text/image/video/audio）',
    '//   action              set(填，默认)/skip(不填)/delete(删除字段)',
    '// common                  公共配置：与请求协议 / SDK 无关的字段推荐值（数组，行说明见下）',
    '// protocols               Endpoint 规则：按请求协议 / SDK 区分（数组）',
    '//   每个协议块：',
    '//     name              规则名称（必填）',
    '//     conditions        命中条件（OR 关系；field + op + value）',
    '//     endpoint_tags     归纳范围关键词（必填；任一关键词命中 endpoint 即应用本规则，顺序即优先级）',
    '//     fields            该 endpoint 的字段推荐表（数组，行说明见下）',
    '//',
    '// 字段推荐表每行（common / protocols[].fields 通用）：',
    '//   key           字段路径（必填）',
    '//   scope         provider | model（字段落在供应商还是模型配置）',
    '//   action        set(推荐填)/skip(推荐不填)/delete(删除字段)',
    '//   recommended   推荐值（null = 推荐不填）',
    '//   op/sep/values 值写法（同 model_info_fields）',
    '//   required      是否必填',
    '//   description   说明',
    '// ───────────────────────────────────────────────────────────────',
  ].join('\n')
  const p = (json: string): string => reindentJson(json, '  ')
  return [
    header,
    '{',
    '  // 规则名称（对应一个 Agent 软件类型，唯一）',
    `  "name": ${JSON.stringify(doc.name, null, 2)},`,
    '  // 配置文件默认路径：windows 支持 %USERPROFILE% 等环境变量；mac 支持 ~ / $HOME',
    `  "os_paths": ${p(JSON.stringify(doc.os_paths, null, 2))},`,
    '  // provider/model 的 gjson 路径；models_container: object=模型名做键 / array=数组每项带 id',
    `  "json_paths": ${p(JSON.stringify(doc.json_paths, null, 2))},`,
    '  // 模型信息字段写入方式：path=写入位置；op=raw/bool/first/join；sep=join 分隔符；values=允许值白名单；action=填/不填/删除',
    `  "model_info_fields": ${p(JSON.stringify(doc.model_info_fields, null, 2))},`,
    '  // 公共配置（common）：与请求协议 / SDK 无关的字段推荐值，数组',
    `  "common": ${p(JSON.stringify(doc.common, null, 2))},`,
    '  // Endpoint 规则（protocols）：按请求协议 / SDK 区分；每块含 name / conditions / endpoint_tags / fields',
    `  "protocols": ${p(JSON.stringify(doc.protocols, null, 2))}`,
    '}',
  ].join('\n')
}

// parseDialogDoc 校验整份弹窗 JSON：合法则还原为结构化数据，否则抛错
// （不合法就无法还原成表格，保存 / 切回表格都会被阻止）。
function parseDialogDoc(text: string): RuleDialogDoc {
  const cleaned = stripJsoncComments(text)
  const parsed: unknown = JSON.parse(cleaned)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(i18n.t('agentRules:errors.topMustBeJsonObject'))
  }
  const v = parsed as Record<string, unknown>
  const name = typeof v.name === 'string' ? v.name : ''
  if (!name.trim()) throw new Error(i18n.t('agentRules:errors.dialogNameRequired'))
  const osRaw = v.os_paths && typeof v.os_paths === 'object' && !Array.isArray(v.os_paths)
    ? (v.os_paths as Record<string, unknown>)
    : {}
  const jpRaw = v.json_paths && typeof v.json_paths === 'object' && !Array.isArray(v.json_paths)
    ? (v.json_paths as Record<string, unknown>)
    : {}
  const container = jpRaw.models_container
  const mifRaw = v.model_info_fields
  if (mifRaw !== undefined && (typeof mifRaw !== 'object' || mifRaw === null || Array.isArray(mifRaw))) {
    throw new Error(i18n.t('agentRules:errors.modelInfoFieldsMustBeObject'))
  }
  const mif: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue> = {
    max_context: '',
    max_output_token: '',
    input_types: '',
    thinking_levels: '',
    reasoning_effort: '',
  }
  if (mifRaw && typeof mifRaw === 'object' && !Array.isArray(mifRaw)) {
    const rec = mifRaw as Record<string, unknown>
    for (const key of MODEL_INFO_FIELD_KEYS) {
      if (!(key in rec)) continue
      const raw = rec[key]
      // 对象写法（值+写法）必须带非空 path；否则与表格模式不一致——
      // 表格里只填 op/sep/允许值而不填路径会报「请先填写路径」。
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const spec = raw as Record<string, unknown>
        if (typeof spec.path !== 'string' || spec.path.trim() === '') {
          throw new Error(i18n.t('agentRules:errors.modelInfoPathRequiredAt', { key, label: i18n.t('agentRules:modelInfoFields.' + MODEL_INFO_FIELD_LABELS[key]) }))
        }
      }
      mif[key] = parseAgentModelInfoSpec(raw)
    }
  }
  let common: readonly AgentRecommendation[] = []
  if (v.common !== undefined && v.common !== null) {
    if (!Array.isArray(v.common)) throw new Error(i18n.t('agentRules:errors.commonMustBeJsonArray'))
    common = recsFromUnknownArray(v.common)
  }
  let protocols: readonly AgentProtocol[] = []
  if (v.protocols !== undefined && v.protocols !== null) {
    if (!Array.isArray(v.protocols)) throw new Error(i18n.t('agentRules:errors.protocolsMustBeJsonArray'))
    protocols = v.protocols.map((p) => normalizeAgentProtocol(p))
  }
  return {
    name,
    os_paths: {
      windows: typeof osRaw.windows === 'string' ? osRaw.windows : '',
      mac: typeof osRaw.mac === 'string' ? osRaw.mac : '',
    },
    json_paths: {
      provider: typeof jpRaw.provider === 'string' ? jpRaw.provider : '',
      model: typeof jpRaw.model === 'string' ? jpRaw.model : '',
      models_container: container === 'array' || container === 'object' ? container : '',
    },
    model_info_fields: mif,
    common,
    protocols,
  }
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
  const { t } = useTranslation('agentRules')
  const [name, setName] = useState('')
  const [windowsPath, setWindowsPath] = useState('')
  const [macPath, setMacPath] = useState('')
  const [providerPath, setProviderPath] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [modelsContainer, setModelsContainer] = useState<AgentModelsContainer>('')
  // 结构化的字段推荐编辑器：公共配置一个 JSON（common），每个 endpoint
  // 一套独立规则（名称 / 归纳范围关键词 / 字段推荐值表）。
  const [commonText, setCommonText] = useState('[]')
  const [endpointRules, setEndpointRules] = useState<readonly EndpointRuleEdit[]>([])
  const [modelInfoRows, setModelInfoRows] = useState<Record<ModelInfoFieldKey, ModelInfoFieldRow>>(EMPTY_MODEL_INFO_ROWS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 整弹窗 JSON 编辑模式：true 时弹窗正文是一个大 Textarea，可编辑整份
  // 规则 JSON（含名称 / 路径 / 模型信息 / common / protocols）；保存或切回
  // 表格前都会校验，JSON 不合法则阻止。
  const [jsonMode, setJsonMode] = useState(false)
  const [docText, setDocText] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
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
        setError(t('errors.parseExistingFailed') + (err instanceof Error ? err.message : String(err)))
        common = editing?.recommendations ?? []
        protocols = editing?.protocols ?? []
      }
      fillFromParts(common, protocols, editing?.model_info_fields)
      setError(null)
      setJsonMode(false)
      setDocText('')
      setDocError(null)
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
      toast(t('toast.templateApplied'))
    } catch (err) {
      setError(toErrorMessage(err, t('errors.loadTemplateFailed')))
    } finally {
      setTemplateLoading(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    // JSON 编辑模式：整份 doc 是唯一数据源。校验合法才允许保存，
    // 同时把结果同步回表格态，保证切回表格时内容一致。
    if (jsonMode) {
      let doc: RuleDialogDoc
      try {
        doc = parseDialogDoc(docText)
      } catch (err) {
        setDocError(err instanceof Error ? err.message : String(err))
        return
      }
      // 模型信息字段的「值+写法」半填行校验：与表格模式走同一个函数，
      // 保证两条编辑路径的校验完全一致。
      const { fields: modelInfoFields, error: mifError } = buildModelInfoFieldsPayload(modelInfoRowsFromSpecs(doc.model_info_fields))
      if (mifError) {
        setDocError(mifError)
        return
      }
      applyDocToState(doc)
      await persistRule({
        name: doc.name.trim(),
        windowsPath: doc.os_paths.windows,
        macPath: doc.os_paths.mac,
        providerPath: doc.json_paths.provider,
        modelPath: doc.json_paths.model,
        modelsContainer: doc.json_paths.models_container,
        modelInfoFields,
        common: doc.common,
        protocols: doc.protocols,
        // 用户编辑后的 JSONC 原样落库（保留用户自己写的注释）。
        configJsonc: docText,
      })
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('errors.nameRequired'))
      return
    }
    // 公共配置 JSON 必须可解析成数组（整行空白的行会被静默丢弃）。
    let common: AgentRecommendation[]
    try {
      common = parseCommonArray(commonText)
    } catch (err) {
      setError(t('errors.commonParseFailed') + (err instanceof Error ? err.message : String(err)))
      return
    }
    // 整张卡片全空（名称 / 归纳范围 / 条件 / 字段都没填）的 endpoint 规则
    // 静默丢弃；只填了一半的仍按下方校验报错（序号沿用原始卡片序号）。
    const protocols: AgentProtocol[] = []
    for (let i = 0; i < endpointRules.length; i++) {
      const rule = endpointRules[i]
      if (isEmptyEndpointRule(rule)) continue
      const converted = ruleToProtocol(rule, i)
      if (typeof converted === 'string') {
        setError(converted)
        return
      }
      protocols.push(converted)
    }
    // 表格模式保存：生成整份带注释的 JSONC（名称 / 路径 / 模型信息 /
    // common / protocols），与 JSON 编辑模式看到的是同一份文档。
    const fullDoc = buildDialogDoc({
      name: trimmed,
      windowsPath,
      macPath,
      providerPath,
      modelPath,
      modelsContainer,
      modelInfoRows,
      common,
      protocols,
    })
    const configJsonc = buildDialogDocJsonc(fullDoc)
    const { fields: modelInfoFields, error: mifError } = buildModelInfoFieldsPayload(modelInfoRows)
    if (mifError) {
      setError(mifError)
      return
    }
    await persistRule({
      name: trimmed,
      windowsPath,
      macPath,
      providerPath,
      modelPath,
      modelsContainer,
      modelInfoFields,
      common,
      protocols,
      configJsonc,
    })
  }

  // persistRule 发送保存请求（更新 / 新建共用）。
  const persistRule = async (p: {
    name: string
    windowsPath: string
    macPath: string
    providerPath: string
    modelPath: string
    modelsContainer: AgentModelsContainer
    modelInfoFields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue>
    common: readonly AgentRecommendation[]
    protocols: readonly AgentProtocol[]
    configJsonc: string
  }) => {
    setSaving(true)
    setError(null)
    setDocError(null)
    try {
      if (editing) {
        await dashboardApi.updateAgentTypeRule(editing.id, {
          name: p.name,
          windows: p.windowsPath.trim(),
          mac: p.macPath.trim(),
          provider_path: p.providerPath.trim(),
          model_path: p.modelPath.trim(),
          models_container: p.modelsContainer,
          recommendations: p.common,
          protocols: [...p.protocols],
          model_info_fields: p.modelInfoFields,
          config_jsonc: p.configJsonc,
        })
      } else {
        await dashboardApi.createAgentTypeRule(p.name, {
          windows: p.windowsPath.trim(),
          mac: p.macPath.trim(),
          provider_path: p.providerPath.trim(),
          model_path: p.modelPath.trim(),
          models_container: p.modelsContainer,
          recommendations: p.common,
          protocols: [...p.protocols],
          model_info_fields: p.modelInfoFields,
          config_jsonc: p.configJsonc,
        })
      }
      toast(t(editing ? 'toast.updated' : 'toast.added'))
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(toErrorMessage(err, editing ? t('errors.updateFailed') : t('errors.addFailed')))
    } finally {
      setSaving(false)
    }
  }

  // applyDocToState 把校验过的整份 JSON 写回表格态（切回表格 / JSON 模式
  // 下保存共用，保证两种视图内容一致）。
  const applyDocToState = (doc: RuleDialogDoc) => {
    setName(doc.name)
    setWindowsPath(doc.os_paths.windows)
    setMacPath(doc.os_paths.mac)
    setProviderPath(doc.json_paths.provider)
    setModelPath(doc.json_paths.model)
    setModelsContainer(doc.json_paths.models_container)
    setModelInfoRows(modelInfoRowsFromSpecs(doc.model_info_fields))
    setCommonText(JSON.stringify(doc.common, null, 2))
    setEndpointRules(doc.protocols.map((p) => ({
      name: p.name,
      tagsText: p.endpoint_tags.join(', '),
      conditions: [...p.conditions],
      fieldsJson: JSON.stringify(p.recommendations ?? [], null, 2),
    })))
  }

  // toggleJsonMode 切换表格 / 整弹窗 JSON 两种编辑视图。切回表格要求
  // JSON 合法（能还原成表格），否则留在 JSON 模式并提示错误。
  const toggleJsonMode = () => {
    if (jsonMode) {
      try {
        const doc = parseDialogDoc(docText)
        applyDocToState(doc)
        setDocError(null)
        setError(null)
        setJsonMode(false)
      } catch (err) {
        setDocError(t('errors.jsonToTableFailed') + (err instanceof Error ? err.message : String(err)))
      }
      return
    }
    const doc = buildDialogDoc({
      name,
      windowsPath,
      macPath,
      providerPath,
      modelPath,
      modelsContainer,
      modelInfoRows,
      common: parseCommonArray(commonText),
      protocols: endpointRules.map((r) => {
        let recs: AgentRecommendation[] = []
        try {
          recs = fieldsJsonToRecs(r.fieldsJson)
        } catch {
          recs = []
        }
        return {
          name: r.name.trim(),
          conditions: [...r.conditions],
          endpoint_tags: tagsTextToArray(r.tagsText),
          recommendations: recs,
        }
      }),
    })
    setDocText(buildDialogDocJsonc(doc))
    setDocError(null)
    setError(null)
    setJsonMode(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="xl" scrollFooter>
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button
              variant="outline"
              className="mr-auto"
              onClick={toggleJsonMode}
              disabled={saving}
              title={jsonMode ? t('actions.jsonModeBackTitle') : t('actions.jsonModeForwardTitle')}
            >
              {jsonMode ? t('actions.switchBackToTable') : t('actions.switchToJsonMode')}
            </Button>
            {editing?.has_template && !jsonMode && (
              <Button
                variant="outline"
                onClick={() => setConfirmTemplate(true)}
                disabled={saving || templateLoading}
                title={t('actions.templateResetTitle')}
              >
                <AppIcon name="auto_fix_high" data-icon="inline-start" />
                {t('actions.useDefaultTemplate')}
              </Button>
            )}
            <Button onClick={() => void handleSave()} disabled={saving || (!jsonMode && name.trim() === '')}>
              {saving ? t('actions.saving') : t('common:action.save')}
            </Button>
          </>
        }>
          {jsonMode ? (
            <Field>
              <p className="text-xs text-muted-foreground">
                {t('jsonMode.hint')}
              </p>
              <Textarea
                value={docText}
                onChange={(e) => {
                  setDocText(e.target.value)
                  setDocError(null)
                }}
                className="h-[440px] resize-y font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              {docError && (
                <p className="text-[11px] text-destructive">{docError}</p>
              )}
            </Field>
          ) : (
          <FieldGroup>
          <Field>
            <FieldLabel>{t('form.nameLabel')}</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.namePlaceholder')} />
          </Field>

          <Group label={t('form.defaultPathsGroup')}>
            <Field>
              <FieldLabel>{t('form.windowsPathLabel')}</FieldLabel>
              <Input
                value={windowsPath}
                onChange={(e) => setWindowsPath(e.target.value)}
                placeholder={t('form.windowsPathPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('form.windowsPathHint')}</p>
            </Field>
            <Field>
              <FieldLabel>{t('form.macPathLabel')}</FieldLabel>
              <Input
                value={macPath}
                onChange={(e) => setMacPath(e.target.value)}
                placeholder={t('form.macPathPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('form.macPathHint')}</p>
            </Field>
          </Group>

          <Group label={t('form.jsonPathsGroup')}>
            <Field>
              <FieldLabel>{t('form.providerPathLabel')}</FieldLabel>
              <Input
                value={providerPath}
                onChange={(e) => setProviderPath(e.target.value)}
                placeholder={t('form.providerPathPlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel>{t('form.modelPathLabel')}</FieldLabel>
              <Input
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                placeholder={t('form.modelPathPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('form.modelPathHint')}
              </p>
            </Field>
            <Field>
              <FieldLabel>{t('form.modelsContainerLabel')}</FieldLabel>
              <Select
                value={modelsContainer || 'object'}
                onValueChange={(v) => setModelsContainer(v === 'object' ? '' : 'array')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('form.modelsContainerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="array">{t('form.containerArray')}</SelectItem>
                  <SelectItem value="object">{t('form.containerObject')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('form.modelsContainerHint')}
              </p>
            </Field>

            <ModelInfoFieldsEditor value={modelInfoRows} onChange={setModelInfoRows} />

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>{t('form.commonLabel')}</FieldLabel>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('form.commonHint')}
              </p>
              {(() => {
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
                    <p className="pb-1 text-[11px] text-destructive">
                      {t('errors.commonInvalid', { message: err instanceof Error ? err.message : String(err) })}
                    </p>
                  )
                }
              })()}
            </Field>

            <EndpointRulesEditor value={endpointRules} onChange={setEndpointRules} />
          </Group>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{error}</div>
            </div>
          )}
        </FieldGroup>
          )}
        </DialogScrollBody>
      </DialogContent>

      <Dialog open={confirmTemplate} onOpenChange={(o) => !o && setConfirmTemplate(false)}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('dialog.templateConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="default" onClick={() => void applyDefaultTemplate()} disabled={templateLoading}>
                {templateLoading ? t('common:state.loading') : t('dialog.confirmApply')}
              </Button>
            </>
          }>
            <p className="text-xs text-muted-foreground">
              <span className="break-all">{t('dialog.templateApplyFor', { name: editing?.name ?? '' })}</span>
              {t('dialog.templateApplyDetail')}
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

const REC_ACTIONS = ['set', 'skip', 'delete'] as const

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
  const { t } = useTranslation('agentRules')
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
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="w-[16%] px-2 py-1.5 text-left font-medium">{t('recTable.path')}</th>
            {showScope ? <th className="w-[8%] px-2 py-1.5 text-left font-medium">{t('recTable.scope')}</th> : null}
            <th className="w-[9%] px-2 py-1.5 text-left font-medium">{t('recTable.action')}</th>
            <th className="w-[13%] px-2 py-1.5 text-left font-medium">{t('recTable.recommended')}</th>
            <th className="w-[7%] px-2 py-1.5 text-left font-medium">op</th>
            <th className="w-[7%] px-2 py-1.5 text-left font-medium">sep</th>
            <th className="w-[16%] px-2 py-1.5 text-left font-medium">{t('recTable.allowedValues')}</th>
            <th className="w-[6%] px-2 py-1.5 text-left font-medium">{t('recTable.required')}</th>
            <th className="w-[13%] px-2 py-1.5 pl-0 text-left font-medium">{t('recTable.description')}</th>
            <th className="w-[5%] px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {recs.length === 0 ? (
            <tr>
              <td colSpan={showScope ? 10 : 9} className="px-2 py-2 text-muted-foreground">
                {t('recTable.empty')}
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
                          {t('recAction.' + a)}
                          {a === 'set' ? t('recAction.setSuffix') : a === 'skip' ? t('recAction.skipSuffix') : t('recAction.deleteSuffix')}
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
                    placeholder={t('recTable.valuesPlaceholder')}
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
                    placeholder={t('recTable.descriptionPlaceholder')}
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
                      {t('common:action.delete')}
                    </Button>
                  </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-end border-t border-border bg-muted/40 px-2 py-1">
        <Button type="button" variant="outline" size="xs" onClick={addRow}>
          {t('recTable.addRow')}
        </Button>
      </div>
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
  const { t } = useTranslation('agentRules')
  const update = (key: ModelInfoFieldKey, patch: Partial<ModelInfoFieldRow>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } })
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{t('modelInfoEditor.title')}</FieldLabel>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('modelInfoEditor.hint')}
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-[8.5rem] px-2 py-1.5 text-left font-medium">{t('modelInfoEditor.columns.modelInfo')}</th>
              <th className="w-40 px-2 py-1.5 text-left font-medium">{t('recTable.path')}</th>
              <th className="w-[5rem] px-2 py-1.5 text-left font-medium">{t('modelInfoEditor.columns.op')}</th>
              <th className="w-[6rem] px-2 py-1.5 text-left font-medium">{t('modelInfoEditor.columns.variantShape')}</th>
              <th className="w-[3.5rem] px-2 py-1.5 text-left font-medium">sep</th>
              <th className="px-2 py-1.5 text-left font-medium">{t('recTable.allowedValues')}</th>
              <th className="w-[5.5rem] px-2 py-1.5 text-left font-medium">{t('recTable.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MODEL_INFO_FIELD_KEYS.map((key) => (
              <tr key={key}>
                <td className="px-2 py-1.5">{t('modelInfoFields.' + MODEL_INFO_FIELD_LABELS[key])}</td>
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
                  {/* variant_shape：仅 op=variants 时有效。对象=旧版 map（V1），
                      数组=opencode V2（[{id,settings}]）。丢掉会写出 V1 形状，
                      被 opencode V2 判为 malformed 整块跳过。 */}
                  <Select
                    value={value[key].variantShape === 'array' ? 'array' : 'legacy'}
                    onValueChange={(v) => update(key, { variantShape: v === 'array' ? 'array' : '' })}
                    disabled={value[key].op !== 'variants'}
                  >
                    <SelectTrigger className="h-6 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="legacy">{t('modelInfoEditor.variantShape.legacy')}</SelectItem>
                      <SelectItem value="array">{t('modelInfoEditor.variantShape.array')}</SelectItem>
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
                    placeholder={t('recTable.valuesPlaceholder')}
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
                          {t('recAction.' + a)}
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
// 私有配置字段推荐表（该 endpoint 的字段推荐值）。整张卡片全空的卡片在
// 保存时自动丢弃。
function EndpointRulesEditor({
  value,
  onChange,
}: {
  value: readonly EndpointRuleEdit[]
  onChange: (v: readonly EndpointRuleEdit[]) => void
}) {
  const { t } = useTranslation('agentRules')
  const update = (index: number, patch: (rule: EndpointRuleEdit) => EndpointRuleEdit) => {
    onChange(value.map((rule, i) => (i === index ? patch(rule) : rule)))
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{t('endpointRules.title')}</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onChange([...value, emptyEndpointRule()])}
        >
          {t('endpointRules.add')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('endpointRules.hint')}
      </p>

      {value.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t('endpointRules.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((rule, ruleIndex) => {
            return (
              <div key={ruleIndex} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('endpointRules.index', { n: ruleIndex + 1 })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => onChange(value.filter((_, i) => i !== ruleIndex))}
                  >
                    {t('common:action.delete')}
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-2 items-start gap-3">
                  <Field>
                    <FieldLabel>{t('endpointRules.nameLabel')}</FieldLabel>
                    <Input
                      value={rule.name}
                      onChange={(e) => update(ruleIndex, (r) => ({ ...r, name: e.target.value }))}
                      placeholder={t('endpointRules.namePlaceholder')}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('endpointRules.tagsLabel')}</FieldLabel>
                    <Input
                      value={rule.tagsText}
                      onChange={(e) => update(ruleIndex, (r) => ({ ...r, tagsText: e.target.value }))}
                      placeholder={t('endpointRules.tagsPlaceholder')}
                      className="font-mono"
                    />
                  </Field>
                </div>

                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel>{t('endpointRules.privateLabel')}</FieldLabel>
                  </div>
                  {(() => {
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
                        <p className="pb-1 text-[11px] text-destructive">
                          {t('errors.privateInvalid', { message: err instanceof Error ? err.message : String(err) })}
                        </p>
                      )
                    }
                  })()}
                </Field>
              </div>
            )
          })}
        </div>
      )}
    </Field>
  )
}
