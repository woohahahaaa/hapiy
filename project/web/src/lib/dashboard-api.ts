import { parseTopologyDocument } from './topology-document'
import type { Workflow } from './topology-document'
import type { SlotEntry } from '@/components/node/slot/items'
export { parseTopologyDocument } from './topology-document'
export type { Workflow } from './topology-document'
export type TopologyDocument = Workflow[]

export type TopologyVersionSummary = {
  readonly id: string
  readonly createdAt: string
  readonly workflowTotal: number
  readonly workflowActive: number
  readonly nodeCount: number
}

export type TopologyCurrentVersion = {
  readonly archived: boolean
  readonly workflowTotal: number
  readonly workflowActive: number
  readonly nodeCount: number
  readonly updatedAt: string
}

export type TopologyVersionList = {
  readonly current: TopologyCurrentVersion | null
  readonly versions: readonly TopologyVersionSummary[]
}

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

type JsonRecord = Record<string, unknown>

export type ProviderEndpoint = {
  readonly pathSuffix: string
}

// ModelPrices are per-model explicit prices in units of per 1M tokens. Each
// amount is a string that must start with a "$" or "¥" currency symbol; the
// symbol also determines the billing currency for this model (overriding the
// global billing currency). null/absent on ProviderModel.prices means the
// rate-multiplier mode is in effect.
export type ModelPrices = {
  readonly input: string
  readonly cacheWrite: string
  readonly cacheRead: string
  readonly output: string
}

// ModelReferencePrices are the READ-ONLY price snapshot captured from
// models.dev when a model uses 模型价格参考供应商 mode. Amounts are USD per
// 1M tokens (numeric); billing applies the multiplier and the global
// currency/exchange rules. Only the multiplier is editable by the user.
export type ModelReferencePrices = {
  readonly input: number
  readonly cacheWrite: number
  readonly cacheRead: number
  readonly output: number
}

// ProviderModel pricing modes:
//   - prices present        → 单独设置价格
//   - referenceProvider set → 模型价格参考供应商 (referencePrices snapshot is
//                             read-only; rate is the editable multiplier)
//   - neither               → legacy rate mode without a source (bill rate
//                             against the global 模型信息 fallback, stage 3
//                             removes this branch)
export type ProviderModel = {
  readonly model: string
  readonly endpoints: readonly string[]
  readonly rate: string
  readonly ratePriceConfigId: string | null
  readonly referenceProvider: string | null
  readonly referencePrices: ModelReferencePrices | null
  readonly referenceAt: string | null
  readonly prices: ModelPrices | null
}

export type Provider = {
  readonly id: string
  readonly name: string
  readonly baseUrls: readonly string[]
  readonly keys: readonly string[]
  // keyNotes maps a key string to its optional remark; purely informational.
  readonly keyNotes: Readonly<Record<string, string>>
  readonly endpoints: readonly ProviderEndpoint[]
  readonly models: readonly ProviderModel[]
  readonly status: boolean
  readonly autoDisabled: boolean
  readonly workflowEnabled: boolean
}

export type ProviderInput = Omit<Provider, 'id'>

export type ProviderDisableStatus = {
  readonly providerId: string
  readonly provider: boolean
  readonly baseUrls: Readonly<Record<string, boolean>>
  readonly keys: Readonly<Record<string, boolean>>
}

export type ProviderDisableDimension = 'provider' | 'base_url' | 'key'

export type DisabledRecordDimension = 'key' | 'base_url' | 'provider'

export type DisabledRecord = {
  readonly id: string
  readonly providerId: string
  readonly dimension: DisabledRecordDimension
  readonly value: string
  readonly requestHeaders: string
  readonly requestBody: string
  readonly errorMessage: string
  readonly ruleId: string
  readonly ruleName: string
  readonly disabledAt: string
  readonly lastRetryAt: string | null
  readonly retryCount: number
  readonly resolvedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type ProviderListParams = {
  readonly limit: number
  readonly offset: number
}

export type Token = {
  readonly id: string
  readonly name: string
  readonly key: string
  readonly historyKeys: readonly string[]
  readonly quota: number | null
  readonly usedQuota: number
  readonly status: boolean
}

export type TokenInput = {
  readonly name: string
  readonly quota: number | null
  readonly status: boolean
  readonly key?: string
  readonly historyKeys?: readonly string[]
  readonly usedQuota?: number
}

export type TokenListParams = {
  readonly limit: number
  readonly offset: number
}

export type TokenListResult = {
  readonly tokens: readonly Token[]
  readonly total: number
}

export type UsageLog = {
  readonly id: string
  readonly requestId: string
  readonly createdAt: string
  readonly userId: string
  readonly tokenName: string
  readonly providerName: string
  readonly modelName: string
  readonly source: string
  readonly promptTokens: number
  readonly completionTokens: number
  readonly promptCacheMissTokens: number
  readonly promptCacheHitTokens: number
  readonly isStream: boolean
  readonly quota: number
  readonly currency: 'USD' | 'CNY' | ''
  readonly useTime: number
  readonly connectMs: number
  readonly firstByteMs: number
  readonly requestRewriteMs: number
  readonly responseRewriteMs: number
  readonly streamRewriteMs: number
  readonly queueWaitMs: number
  readonly status: 'success' | 'failed' | ''
  readonly errorMessage: string
  // eventDetail is populated for event rows with the matched rule / action explanation; empty for request rows and pre-existing data.
  readonly eventDetail: string
  readonly upstreamUrl: string
  readonly providerKey: string
  readonly affinityReuse: '' | 'none' | 'partial' | 'full' | 'new'
  readonly affinityReuseParts: readonly string[]
}

export type LogListParams = {
	readonly model?: string
	readonly provider?: string
	readonly type?: string
	readonly status?: string
	readonly token?: string
	readonly source?: string
	readonly requestId?: string
	readonly from?: string
	readonly to?: string
	readonly limit: number
	readonly offset: number
}

export type LogTypeFilter = '' | 'request' | 'channel_disabled' | 'channel_recovered_auto' | 'channel_recovered_manual' | 'system_admin'

// Sentinel passed to the logs/capture list+clear APIs for the "未标注来源"
// filter option (rows whose source is empty). Backend maps it to source = ''.
export const LOG_SOURCE_UNMARKED = '__unmarked__'

export type StatsRange = 'all' | '30d' | '7d' | '1d'

export type ModelStat = {
  readonly model: string
  readonly count: number
  readonly tokens: number
}

export type LogStats = {
  readonly totalRequests: number
  readonly successCount: number
  readonly failedCount: number
  readonly totalTokens: number
  readonly averageLatency: number
  readonly totalCost: number
  readonly cacheHitRate: number
  readonly throughput: number
  readonly models: readonly ModelStat[]
}

export type ActiveRequest = {
  readonly requestId: string
  readonly model: string
  readonly tokenName: string
  readonly userId: string
  readonly provider: string
  readonly providerId: string
  readonly source: string
  readonly stream: boolean
  readonly startTime: string
  readonly elapsedMs: number
  readonly firstByteMs: number | null
  readonly endTime: string | null
  readonly outcome: string
  readonly stage: string
  readonly chunkCount: number
  readonly bytesReceived: number
  readonly pathNodeIds: readonly string[]
  readonly affinityReuse: string
}

export type ActiveRequestConfig = {
  readonly retentionMinutes: number
}

export type LogListResult = {
  readonly logs: readonly UsageLog[]
  readonly total: number
}

export type LogCaptureType = 'request' | 'response' | 'system'

export type LogCaptureFile = {
  readonly id: string
  readonly name: string
  readonly prefix: string
  readonly source: string
  readonly type: LogCaptureType
  readonly size: number
  readonly created_at: string
}

export type LogCaptureListParams = {
	readonly prefix?: string
	readonly type?: string // 逗号分隔
	readonly from?: string // ISO 日期
	readonly to?: string // ISO 日期
	readonly headerKey?: string
	readonly headerValue?: string
	readonly token?: string
	readonly provider?: string
	readonly model?: string
	readonly source?: string
	readonly limit: number
	readonly offset: number
}

export type LogCaptureListResult = {
  readonly files: readonly LogCaptureFile[]
  readonly total: number
}

export type LogCaptureStageRow = {
  readonly headers: Record<string, string> | null
  readonly body: unknown
  readonly status: number
  readonly error: string
  readonly created_at: string
}

export type LogCaptureRequestNode = {
  readonly before?: LogCaptureStageRow
  readonly after?: LogCaptureStageRow
  readonly modified: boolean
}

export type LogCaptureResponseNode = {
  readonly before?: LogCaptureStageRow
  readonly after?: LogCaptureStageRow
  readonly status: number
  readonly modified: boolean
}

export type LogCapturePairSummary = {
  readonly request_id: string
  readonly type_label: string // 后端计算: "请求" | "响应" | "请求+响应" | "请求+响应×N"，可拼接 "+报错" / "+不完整" — 不校验枚举
  readonly prefix: string
  readonly source: string
  readonly provider_id: string
  readonly provider_name: string
  readonly model_name: string
  readonly token_name: string
  readonly created_at: string
  readonly has_request: boolean
  readonly has_response: boolean
  readonly response_count: number
  readonly has_rewrite: boolean
  readonly is_stream: boolean
  readonly has_error: boolean
  readonly is_incomplete: boolean
}

export type LogCapturePairFull = {
  readonly request_id: string
  readonly prefix: string
  readonly source: string
  readonly provider_id: string
  readonly created_at: string
  readonly request?: LogCaptureRequestNode
  readonly responses: readonly LogCaptureResponseNode[]
  readonly error: string
  readonly timing?: LogCaptureTiming
  readonly is_stream: boolean
}

export type LogCaptureTiming = {
  readonly connectMs: number // -1 = N/A
  readonly firstByteMs: number
  readonly requestRewriteMs: number
  readonly responseRewriteMs: number
  readonly streamRewriteMs: number
  readonly queueWaitMs: number
}

export type LogCapturePairListResult = {
  readonly pairs: readonly LogCapturePairSummary[]
  readonly total: number
}

export type LogCaptureMergedBody = {
  readonly value: unknown
  readonly content_type: string
  readonly raw: string
  readonly merged: boolean
}

export type DateRange = {
  readonly from?: string
  readonly to?: string
}

export type SystemSetting = {
  readonly key: string
  readonly value: string
}

// PriceRule — 一条转发计费倍率规则（请求改写/倍率编辑器用），与已退休的
// 模型信息价格表无关。
export type PriceRule = {
  readonly pattern: string
  readonly multiplier: number
}

export type FetchedModel = {
  readonly id: string
  readonly name: string
}

export type CurrentUser = {
  readonly id: string
  readonly username: string
  readonly role: string
}

// ── Flat topology (canvas node/wire model) ──
export type FlatNodeKind = 'requestEntry' | 'provider' | 'slot' | 'switch'

export type ProviderStrategy = 'sequential' | 'random' | 'roundRobin'

/** 条件开关节点的单条判断条件（与请求改写的叶子条件同形）。 */
export type SwitchCondition = {
  readonly path: string
  readonly op: string
  readonly value: string
  readonly invert: boolean
  readonly scope: string
}

/** 条件组：AND/OR 组合节点，可嵌套（与请求改写的条件组同形）。 */
export type SwitchConditionGroup = {
  readonly logic: 'AND' | 'OR'
  readonly children: readonly SwitchConditionNode[]
}

export type SwitchConditionNode = SwitchCondition | SwitchConditionGroup

/** 筛选维度二选一：按供应商或按模型。 */
export type SwitchFilterMode = 'provider' | 'model'

/** 条件开关节点配置：筛选维度 + 命中列表 + 请求头/请求体条件（全部命中才走「是」）。 */
export type SwitchNodeConfig = {
  readonly mode?: SwitchFilterMode
  readonly providers?: readonly string[]
  readonly models?: readonly string[]
  readonly conditionLogic?: 'AND' | 'OR'
  readonly conditions: readonly SwitchConditionNode[]
}

export type FlatNode = {
  readonly id: string
  readonly kind: FlatNodeKind
  readonly name?: string
  readonly providerId?: string
  readonly slotType?: string
  readonly enabled: boolean
  readonly weight?: number
  readonly emergency?: boolean
  readonly entries?: readonly SlotEntry[]
  readonly deadlineAt?: number | null
  readonly strategy?: ProviderStrategy
  readonly config?: SwitchNodeConfig
}

export type FlatWire = {
  readonly source: string
  readonly target: string
  /** 条件开关节点的出边分支：是=yes / 否=no；其他节点无 branch。 */
  readonly branch?: 'yes' | 'no'
}

export type FlatTopology = {
  readonly nodes: readonly FlatNode[]
  readonly wires: readonly FlatWire[]
  readonly version?: number
  readonly updatedAt?: string
}

// ── Canvas layout (per-node x/y positions on the topology canvas) ──
export type LayoutSnapshot = Record<string, { x: number; y: number }>

export type DuplicateActivation = {
  readonly providerName: string
  readonly entryIds: readonly string[]
}

function parseFlatNode(value: unknown): FlatNode {
  if (!isRecord(value)) throw new DashboardApiError('扁平拓扑节点格式无效', null)
  const kind = value.kind
  if (kind !== 'requestEntry' && kind !== 'provider' && kind !== 'slot' && kind !== 'switch') {
    throw new DashboardApiError('扁平拓扑节点类型无效', null)
  }
  let config: SwitchNodeConfig | undefined
  if (isRecord(value.config)) {
    const providers = Array.isArray(value.config.providers)
      ? value.config.providers.filter((p): p is string => typeof p === 'string')
      : []
    const models = Array.isArray(value.config.models)
      ? value.config.models.filter((m): m is string => typeof m === 'string')
      : []
    // 条件结构（叶子/组）与请求改写同形，这里整体透传，由编辑器负责解释。
    const conditions = (Array.isArray(value.config.conditions) ? value.config.conditions : []) as unknown as SwitchConditionNode[]
    config = {
      mode: value.config.mode === 'model' ? 'model' : 'provider',
      providers,
      models,
      conditionLogic: value.config.conditionLogic === 'OR' ? 'OR' : 'AND',
      conditions,
    }
  }
  return {
    id: readString(value.id, 'node.id'),
    kind,
    name: typeof value.name === 'string' ? value.name : undefined,
    providerId: typeof value.provider_id === 'string' ? value.provider_id : undefined,
    slotType: typeof value.slot_type === 'string' ? value.slot_type : undefined,
    enabled: value.enabled === undefined ? true : readBoolean(value.enabled, 'node.enabled'),
    weight: typeof value.weight === 'number' ? value.weight : undefined,
    emergency: value.emergency === true ? true : undefined,
    entries: readObjectArray(value.entries, 'node.entries', (x) => x as SlotEntry),
    deadlineAt: typeof value.deadline_at === 'number' ? value.deadline_at : null,
    strategy: isProviderStrategy(value.strategy) ? value.strategy : undefined,
    ...(config !== undefined ? { config } : {}),
  }
}

function isProviderStrategy(value: unknown): value is ProviderStrategy {
  return value === 'sequential' || value === 'random' || value === 'roundRobin'
}

function parseFlatWire(value: unknown): FlatWire {
  if (!isRecord(value)) throw new DashboardApiError('扁平拓扑连线格式无效', null)
  const branch = value.branch === 'yes' || value.branch === 'no' ? value.branch : undefined
  return {
    source: readString(value.source, 'wire.source'),
    target: readString(value.target, 'wire.target'),
    ...(branch !== undefined ? { branch } : {}),
  }
}

function parseFlatTopology(value: unknown): FlatTopology {
  if (!isRecord(value)) throw new DashboardApiError('扁平拓扑格式无效', null)
  const nodes = readObjectArray(value.nodes, 'flat.nodes', parseFlatNode)
  const wires = readObjectArray(value.wires, 'flat.wires', parseFlatWire)
  // 心跳回复（autoReply）插槽已下线：加载时剔除残留节点并丢弃触达它的连线，
  // 避免画布渲染空白卡、保存时携带已删除的插槽类型。
  const removed = new Set(
    nodes.filter((n) => n.kind === 'slot' && n.slotType === 'autoReply').map((n) => n.id),
  )
  const keptNodes = removed.size === 0
    ? nodes
    : nodes.filter((n) => !removed.has(n.id))
  const keptWires = removed.size === 0
    ? wires
    : wires.filter((w) => !removed.has(w.source) && !removed.has(w.target))
  return {
    nodes: keptNodes,
    wires: keptWires,
    ...(typeof value.version === 'number' ? { version: value.version } : {}),
    ...(typeof value.updated_at === 'string' ? { updatedAt: value.updated_at } : {}),
  }
}

function serializeFlatNode(node: FlatNode): JsonRecord {
  return {
    id: node.id,
    kind: node.kind,
    ...(node.name !== undefined ? { name: node.name } : {}),
    ...(node.providerId !== undefined ? { provider_id: node.providerId } : {}),
    ...(node.slotType !== undefined ? { slot_type: node.slotType } : {}),
    enabled: node.enabled,
    ...(node.weight !== undefined ? { weight: node.weight } : {}),
    ...(node.emergency ? { emergency: true } : {}),
    ...(node.entries !== undefined ? { entries: node.entries } : {}),
    ...(node.deadlineAt !== undefined ? { deadline_at: node.deadlineAt } : {}),
    ...(node.strategy !== undefined ? { strategy: node.strategy } : {}),
    ...(node.config !== undefined ? { config: node.config } : {}),
  }
}

function serializeFlatTopology(tp: FlatTopology): JsonRecord {
  return {
    nodes: tp.nodes.map(serializeFlatNode),
    wires: tp.wires.map((wire) => ({
      source: wire.source,
      target: wire.target,
      ...(wire.branch !== undefined ? { branch: wire.branch } : {}),
    })),
  }
}

function parseLayoutSnapshot(value: unknown): LayoutSnapshot {
  const result: LayoutSnapshot = {}
  if (!isRecord(value)) return result
  for (const [id, pos] of Object.entries(value)) {
    if (!isRecord(pos)) continue
    const x = pos.x
    const y = pos.y
    if (typeof x !== 'number' || !Number.isFinite(x)) continue
    if (typeof y !== 'number' || !Number.isFinite(y)) continue
    result[id] = { x, y }
  }
  return result
}

function parseLayoutResponse(value: unknown): { layout: LayoutSnapshot; version: number; updatedAt: string } {
  const defaults = { layout: {} as LayoutSnapshot, version: 0, updatedAt: '' }
  if (!isRecord(value)) return defaults
  return {
    layout: parseLayoutSnapshot(value.layout),
    version: typeof value.version === 'number' ? value.version : 0,
    updatedAt: typeof value.updated_at === 'string' ? value.updated_at : '',
  }
}

function parseDuplicateActivation(value: unknown): DuplicateActivation {
  if (!isRecord(value)) throw new DashboardApiError('重复激活冲突格式无效', null)
  return {
    providerName: readString(value.provider_name, 'dup.provider_name'),
    entryIds: readStringArray(value.entry_ids, 'dup.entry_ids'),
  }
}

// ── Channel affinity ──
export type ChannelAffinityRule = {
  readonly name: string
  readonly enabled: boolean
  readonly sessionIdFields: readonly string[]
  readonly modelFields: readonly string[]
  readonly ttlSeconds?: number
}

export type ChannelAffinitySetting = {
  readonly enabled: boolean
  readonly defaultTtlSeconds: number
  readonly rules: readonly ChannelAffinityRule[]
}

export type ChannelAffinitySettingInput = ChannelAffinitySetting

export type ChannelAffinityFallback = {
  readonly enabled: boolean
  readonly sessionIdFields: readonly string[]
  readonly modelFields: readonly string[]
}

export type ChannelAffinityPayload = {
  readonly setting: ChannelAffinitySetting
  readonly fallback: ChannelAffinityFallback
}

export type ChannelAffinityPayloadInput = ChannelAffinityPayload

// ── Per-table column display config ──
export type ColumnWidthConfig =
  | { readonly kind: 'percent'; readonly value: number }
  | { readonly kind: 'pixel'; readonly value: number }

export type ColumnDisplayConfig = {
  readonly width: ColumnWidthConfig
  readonly align: 'left' | 'right'
  readonly overflow: 'ellipsis' | 'wrap'
}

export type TableConfig = {
  readonly id: string
  readonly tableId: string
  readonly configs: readonly ColumnDisplayConfig[]
  readonly updatedAt: string
}

export type AgentOsPaths = {
  readonly windows: string
  readonly mac: string
}

export type AgentModelsContainer = '' | 'array' | 'object'

export type AgentJsonPaths = {
  readonly provider: string
  readonly model: string
  readonly models_container?: AgentModelsContainer
}

export type AgentRecommendationScope = 'provider' | 'model'

export const MODEL_INFO_FIELD_KEYS = ['max_context', 'max_output_token', 'input_types', 'thinking_levels', 'reasoning_effort'] as const
export type ModelInfoFieldKey = typeof MODEL_INFO_FIELD_KEYS[number]

// Unified shared vocabulary for the four model-info fields. Every
// surface (rule table, sync dialog, model info editor) uses these
// labels so naming stays consistent.
export const MODEL_INFO_FIELD_LABELS: Record<ModelInfoFieldKey, string> = {
  max_context: '最大上下文',
  max_output_token: '最大输出token',
  input_types: '支持的输入类型',
  thinking_levels: '支持的思考程度',
  reasoning_effort: '思考档位',
}

// AgentModelInfoFieldSpec — 显式的「值写法」对象：path 是模型配置对象内
// 的 gjson 路径，op 决定统一值写入前如何变形（各 agent 字段形状不同，
// 如 opencode 的 reasoning 要求 boolean 而统一值是档位数组）。
// op: raw（原样，默认）/ bool（非空→true，空→false）/ first（取第一个）
//     / join（拼接，sep 可选，默认 ","）。
// values: 可选白名单，数组值写入前只保留列出的字面量（如 openclaw 的
// input 只接受 text/image/video/audio），其它值（如 models.dev 的 pdf）
// 自动丢弃。
export type AgentModelInfoFieldOp = 'raw' | 'bool' | 'first' | 'join' | 'variants'

export type AgentModelInfoFieldSpec = {
  readonly path: string
  readonly action?: 'set' | 'skip' | 'delete'
  readonly op?: AgentModelInfoFieldOp
  readonly sep?: string
  readonly values?: readonly string[]
}

// 每个字段既接受纯路径字符串（等价 raw），也接受上面的对象写法。
export type AgentModelInfoFieldSpecValue = string | AgentModelInfoFieldSpec

export const AGENT_MODEL_INFO_FIELD_OPS: readonly AgentModelInfoFieldOp[] = ['raw', 'bool', 'first', 'join', 'variants']

// parseAgentModelInfoSpec 把服务端返回的字段值归一为 string | spec。
export function parseAgentModelInfoSpec(value: unknown): AgentModelInfoFieldSpecValue {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.path === 'string') {
    const spec: { path: string; action?: 'set' | 'skip' | 'delete'; op?: AgentModelInfoFieldOp; sep?: string; values?: string[] } = { path: value.path }
    if (value.action === 'skip' || value.action === 'delete') {
      spec.action = value.action
    }
    if (AGENT_MODEL_INFO_FIELD_OPS.includes(value.op as AgentModelInfoFieldOp)) {
      spec.op = value.op as AgentModelInfoFieldOp
    }
    if (typeof value.sep === 'string' && value.sep !== '') spec.sep = value.sep
    if (Array.isArray(value.values)) {
      spec.values = value.values.filter((x): x is string => typeof x === 'string')
    }
    return spec
  }
  return ''
}

export type AgentModelInfoFieldPaths = {
  readonly max_context: AgentModelInfoFieldSpecValue
  readonly max_output_token: AgentModelInfoFieldSpecValue
  readonly input_types: AgentModelInfoFieldSpecValue
  readonly thinking_levels: AgentModelInfoFieldSpecValue
  readonly reasoning_effort: AgentModelInfoFieldSpecValue
}

// AgentModelConfigSource — one persisted 模型配置参考供应商 selection for a
// config-file provider model, stored per sync-dialog open. Mode is "none"
// (不同步), "self" (a models.dev supplier picked directly, kept in
// self_supplier) or "link" (follow the same-named model's reference on one
// of our providers, kept in link_provider_id). Only the reference is
// persisted, never a resolved result; each open re-resolves it from
// models.dev and our provider table.
export type AgentModelConfigSource = {
  readonly mode: 'none' | 'self' | 'link'
  readonly self_supplier: string
  readonly link_provider_id: string
}

export type AgentModelConfigSources = Readonly<Record<string, Readonly<Record<string, AgentModelConfigSource>>>>

export type AgentProtocolConditionOp = 'equals' | 'contains' | 'not_contains' | 'not_equals'

export type AgentProtocolCondition = {
  readonly field: string
  readonly op: AgentProtocolConditionOp
  readonly value: string
}

// AgentProtocol — one "请求协议 (SDK)" block in a rule. Conditions are
// ORed provider-level gjson paths; EndpointTags is the required fixed
// "根据 endpoint 来判断" field.
export type AgentProtocol = {
  readonly name: string
  readonly conditions: readonly AgentProtocolCondition[]
  readonly endpoint_tags: readonly string[]
  readonly recommendations: readonly AgentRecommendation[]
}

export type AgentProtocolInput = {
  readonly name?: string
  readonly conditions?: readonly AgentProtocolCondition[]
  readonly endpoint_tags?: readonly string[]
  readonly recommendations?: readonly AgentRecommendation[]
}

export type AgentRecommendation = {
  readonly name?: string
  readonly scope: AgentRecommendationScope
  readonly key: string
  readonly description: string
  /** 推荐操作："set"（推荐填，默认）| "skip"（推荐不填）| "delete"（推荐删除字段） */
  readonly action?: 'set' | 'skip' | 'delete'
  readonly recommended: unknown
  readonly candidates?: Readonly<Record<string, string>>
  readonly required: boolean
  /** 值写法：写入前如何变换值 */
  readonly op?: AgentModelInfoFieldOp
  readonly sep?: string
  readonly values?: readonly string[]
}

export type AgentTypeRule = {
  readonly id: string
  readonly name: string
  readonly os_paths: AgentOsPaths
  readonly json_paths: AgentJsonPaths
  readonly recommendations: readonly AgentRecommendation[]
  readonly protocols: readonly AgentProtocol[]
  readonly model_info_fields: AgentModelInfoFieldPaths
  readonly config_jsonc: string
  /** 用户改过且与默认模板不一致：true 时启动种子不再跟随默认模板覆盖 */
  readonly customized: boolean
  readonly created_at: string
  readonly updated_at: string
  /** 是否存在同名默认推荐模版（编辑弹窗据此显示「使用默认推荐模版」） */
  readonly has_template?: boolean
}

// AgentTemplateConfig — 系统默认推荐模版（config/agent-templates/<name>.json
// 或内置）。「使用默认推荐模版」时用它预填编辑弹窗。
export type AgentTemplateConfig = {
  readonly name: string
  readonly os_paths: AgentOsPaths
  readonly json_paths: AgentJsonPaths
  readonly recommendations: readonly AgentRecommendation[]
  readonly protocols: readonly AgentProtocol[]
  readonly model_info_fields: AgentModelInfoFieldPaths
}

export type AgentTypeRuleInput = {
  readonly name?: string
  readonly windows?: string
  readonly mac?: string
  readonly provider_path?: string
  readonly model_path?: string
  readonly models_container?: AgentModelsContainer
  readonly recommendations?: readonly AgentRecommendation[]
  readonly protocols?: readonly AgentProtocol[]
  readonly model_info_fields?: AgentModelInfoFieldPaths
  readonly config_jsonc?: string
}

export type AgentPathCheckResult = {
  readonly exists: boolean
  readonly size: number
  readonly current_os: string
  readonly expandedPath: string
}

export type AgentSshProbeResult = {
  readonly ok: boolean
  readonly error?: string
  readonly detail?: string
}

export type AgentSshConfig = {
  readonly host: string
  readonly port: number
  readonly username: string
  readonly auth_type: 'password' | 'key'
  readonly password?: string
  readonly private_key?: string
  readonly jump_enabled: boolean
  readonly jump_host?: string
  readonly jump_port?: number
  readonly jump_username?: string
  readonly jump_auth_type?: 'password' | 'key'
  readonly jump_password?: string
  readonly jump_private_key?: string
}

export type AgentConfigMode = 'local' | 'ssh'
export type AgentTargetOS = 'windows' | 'mac' | 'other'

export type AgentConfigFile = {
  readonly id: string
  readonly record_name: string
  readonly agent_type: string
  readonly mode: AgentConfigMode
  readonly target_os: AgentTargetOS | null
  readonly path: string
  readonly ssh_config: AgentSshConfig | null
  readonly created_at: string
  readonly updated_at: string
}

export type AgentConfigFileInput = {
  readonly record_name: string
  readonly agent_type: string
  readonly mode: AgentConfigMode
  readonly target_os: AgentTargetOS | null
  readonly path: string
  readonly ssh_config: AgentSshConfig | null
}

export type AgentConfigListParams = {
  readonly limit: number
  readonly offset: number
}

export type AgentModelEntry = {
  readonly id: string
  readonly config: unknown
}

export type AgentModelProvider = {
  readonly provider_id: string
  readonly other_fields: unknown
  readonly models: readonly AgentModelEntry[]
}

export type AgentModelSummary = {
  readonly agent_type: string
  readonly providers: readonly AgentModelProvider[]
  readonly recommendations: readonly AgentRecommendation[]
  readonly protocols: readonly AgentProtocol[]
  readonly model_info_fields: AgentModelInfoFieldPaths
  readonly json_paths: AgentJsonPaths
}

export type ManagedProviderOption = {
  readonly id: string
  readonly name: string
  readonly status: boolean
  readonly endpoints: readonly string[]
  readonly models: readonly string[]
  readonly model_endpoints?: Readonly<Record<string, readonly string[]>>
  readonly endpointCount: number
  readonly modelCount: number
}

export type ManagedAgentGroup = {
  readonly endpoint: string
  readonly suffix: string
  readonly model_sources: Readonly<Record<string, string>>
  readonly provider_ids?: readonly string[]
}

export type ManagedGroupView = {
  readonly endpoint: string
  readonly suffix: string
  readonly provider_names: readonly string[]
  readonly provider_ids: readonly string[]
  readonly model_count: number
  readonly model_names: readonly string[]
  readonly model_sources: Readonly<Record<string, string>>
  readonly generated: Readonly<Record<string, unknown>>
  readonly file_provider: Readonly<Record<string, unknown>> | null
  readonly pending: boolean
  readonly pending_fields: number
}

export type ManagedProviderView = {
  readonly id: string
  readonly name: string
  readonly provider_ids: readonly string[]
  readonly stale_provider_ids: readonly string[]
  readonly groups: readonly ManagedGroupView[]
  readonly hidden_groups: readonly ManagedAgentGroup[]
  readonly pending_sync: boolean
  readonly pending_fields: number
  readonly api_key: string
  readonly base_url: string
  readonly source_name: string
}

export type ManagedProviderInput = {
  readonly name: string
  readonly provider_ids: readonly string[]
  readonly groups: readonly ManagedAgentGroup[]
  readonly api_key?: string
  readonly base_url?: string
  readonly source_name?: string
}

export class DashboardApiError extends Error {
  readonly name = 'DashboardApiError'
  readonly status: number | null
  readonly currentRevision: number | null

  constructor(message: string, status: number | null, currentRevision: number | null = null) {
    super(message)
    this.status = status
    this.currentRevision = currentRevision
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// toStrMap narrows an unknown-keyed record into the string-keyed map
// shape used by managed-provider model_sources.
function toStrMap(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const k of Object.keys(value)) {
    const v = value[k]
    out[k] = typeof v === 'string' ? v : ''
  }
  return out
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  return value
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  return value
}

function readNumber(value: unknown, field: string, fallback?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (fallback !== undefined && value === undefined) {
    return fallback
  }
  throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new DashboardApiError(`服务端返回的 ${field} 不是有效 JSON`, null)
  }
}

function toRFC3339Date(date: string | undefined, endOfDay: boolean): string | undefined {
  if (!date) return undefined
  // Already RFC3339 — pass through
  if (date.includes('T')) return date
  // Treat YYYY-MM-DD as local-time day boundary
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'
  const offset = -new Date().getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const tz = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return `${date}${suffix}${tz}`
}

function parseSystemSetting(value: unknown): SystemSetting {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的设置格式无效', null)
  }
  return {
    key: readString(value.key, 'setting.key'),
    value: readString(value.value, 'setting.value'),
  }
}

function parseFetchedModel(value: unknown): FetchedModel {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的模型格式无效', null)
  }
  const id = readString(value.id, 'model.id')
  return {
    id,
    name: readString(value.name ?? id, 'model.name'),
  }
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (value === '' || value === null || value === undefined) {
    return []
  }
  const parsed = typeof value === 'string' ? parseJson(value, field) : value
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  return parsed
}

function readStringRecord(value: unknown, field: string): Readonly<Record<string, string>> {
  if (value === '' || value === null || value === undefined) {
    return {}
  }
  const parsed = typeof value === 'string' ? parseJson(value, field) : value
  if (!isRecord(parsed) || Object.values(parsed).some((item) => typeof item !== 'string')) {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  return parsed as Record<string, string>
}

function parseEndpoint(value: unknown): ProviderEndpoint {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 endpoints 格式无效', null)
  }
  return {
    pathSuffix: readString(value.pathSuffix ?? value.path_suffix, 'endpoints.path_suffix'),
  }
}

function parseModelPrices(value: unknown): ModelPrices {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 models.prices 格式无效', null)
  }
  return {
    input: readString(value.input ?? '', 'models.prices.input'),
    cacheWrite: readString(value.cacheWrite ?? value.cache_write ?? '', 'models.prices.cacheWrite'),
    cacheRead: readString(value.cacheRead ?? value.cache_read ?? '', 'models.prices.cacheRead'),
    output: readString(value.output ?? '', 'models.prices.output'),
  }
}

function parseModelReferencePrices(value: unknown): ModelReferencePrices {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 models.referencePrices 格式无效', null)
  }
  return {
    input: readNumber(value.input ?? value.input_price ?? 0, 'models.referencePrices.input'),
    cacheWrite: readNumber(value.cacheWrite ?? value.cache_write ?? 0, 'models.referencePrices.cacheWrite'),
    cacheRead: readNumber(value.cacheRead ?? value.cache_read ?? 0, 'models.referencePrices.cacheRead'),
    output: readNumber(value.output ?? 0, 'models.referencePrices.output'),
  }
}

function parseModel(value: unknown): ProviderModel {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 models 格式无效', null)
  }
  const legacyRate = typeof value.discount === 'number' && Number.isFinite(value.discount)
    ? String(value.discount)
    : undefined
  return {
    model: readString(value.model, 'models.model'),
    endpoints: readStringArray(value.endpoints ?? [], 'models.endpoints'),
    rate: readString(value.rate ?? legacyRate ?? '1', 'models.rate'),
    ratePriceConfigId: typeof value.priceConfigId === 'string' ? value.priceConfigId : null,
    // 保留空串 referenceProvider（不归一化为 null）：用户选了「从
    // models.dev 参考」模式但还没选具体厂商时，模式必须能在保存/重载后
    // 幸存——空串配合 prices=null 即可还原出 reference 模式，价格按 0。
    referenceProvider: typeof value.referenceProvider === 'string'
      ? value.referenceProvider
      : null,
    referencePrices: value.referencePrices === null || value.referencePrices === undefined
      ? null
      : parseModelReferencePrices(value.referencePrices),
    referenceAt: typeof value.referenceAt === 'string' ? value.referenceAt : null,
    prices: value.prices === null || value.prices === undefined ? null : parseModelPrices(value.prices),
  }
}

function readObjectArray<T>(value: unknown, field: string, parseItem: (item: unknown) => T): readonly T[] {
  if (value === '' || value === null || value === undefined) {
    return []
  }
  const parsed = typeof value === 'string' ? parseJson(value, field) : value
  if (!Array.isArray(parsed)) {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  return parsed.map(parseItem)
}

function parseChannelAffinityRule(value: unknown): ChannelAffinityRule {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的亲和规则格式无效', null)
  }
  return {
    name: readString(value.name, 'affinity_rule.name'),
    enabled: readBoolean(value.enabled, 'affinity_rule.enabled'),
    sessionIdFields: readStringArray(value.session_id_fields, 'affinity_rule.session_id_fields'),
    modelFields: readStringArray(value.model_fields, 'affinity_rule.model_fields'),
    ...(typeof value.ttl_seconds === 'number' && Number.isFinite(value.ttl_seconds) ? { ttlSeconds: value.ttl_seconds } : {}),
  }
}

function parseChannelAffinity(value: unknown): ChannelAffinitySetting {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的渠道亲和配置格式无效', null)
  }
  return {
    enabled: readBoolean(value.enabled, 'affinity.enabled'),
    defaultTtlSeconds: readNumber(value.default_ttl_seconds, 'affinity.default_ttl_seconds', 1800),
    rules: readObjectArray(value.rules, 'affinity.rules', parseChannelAffinityRule),
  }
}

function parseChannelAffinityFallback(value: unknown): ChannelAffinityFallback {
  if (!isRecord(value)) {
    return { enabled: false, sessionIdFields: [], modelFields: [] }
  }
  return {
    enabled: readBoolean(value.enabled, 'affinity.fallback.enabled'),
    sessionIdFields: readStringArray(value.session_id_fields, 'affinity.fallback.session_id_fields'),
    modelFields: readStringArray(value.model_fields, 'affinity.fallback.model_fields'),
  }
}

function parseChannelAffinityPayload(value: unknown): ChannelAffinityPayload {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的渠道亲和配置格式无效', null)
  }
  return {
    setting: parseChannelAffinity(value.setting),
    fallback: parseChannelAffinityFallback(value.fallback),
  }
}

function parseColumnWidth(value: unknown): ColumnWidthConfig | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const rawVal = value.value
  if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return null
  if (kind === 'percent') return { kind: 'percent', value: rawVal }
  if (kind === 'pixel') return { kind: 'pixel', value: rawVal }
  return null
}

function parseColumnDisplayConfig(value: unknown): ColumnDisplayConfig | null {
  if (!isRecord(value)) return null
  const width = parseColumnWidth(value.width)
  if (!width) return null
  const align = value.align
  if (align !== 'left' && align !== 'right') return null
  const overflow = value.overflow
  if (overflow !== 'ellipsis' && overflow !== 'wrap') return null
  return { width, align, overflow }
}

function parseTableConfig(value: unknown): TableConfig {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的表格配置格式无效', null)
  }
  const rawConfigs = value.configs
  let parsedConfigs: readonly ColumnDisplayConfig[] = []
  if (typeof rawConfigs === 'string') {
    const decoded = parseJson(rawConfigs, 'table.configs')
    if (!Array.isArray(decoded)) {
      throw new DashboardApiError('table.configs 必须是数组', null)
    }
    parsedConfigs = decoded
      .map(parseColumnDisplayConfig)
      .filter((cfg): cfg is ColumnDisplayConfig => cfg !== null)
  } else if (Array.isArray(rawConfigs)) {
    parsedConfigs = rawConfigs
      .map(parseColumnDisplayConfig)
      .filter((cfg): cfg is ColumnDisplayConfig => cfg !== null)
  } else {
    throw new DashboardApiError('table.configs 必须是数组', null)
  }
  return {
    id: readString(value.id, 'table.id'),
    tableId: readString(value.table_id, 'table.table_id'),
    configs: parsedConfigs,
    updatedAt: readString(value.updated_at, 'table.updated_at'),
  }
}

function serializeChannelAffinity(input: ChannelAffinitySettingInput): JsonRecord {
  return {
    enabled: input.enabled,
    default_ttl_seconds: input.defaultTtlSeconds,
    rules: input.rules.map((rule) => ({
      name: rule.name,
      enabled: rule.enabled,
      session_id_fields: rule.sessionIdFields,
      model_fields: rule.modelFields,
      ...(rule.ttlSeconds !== undefined ? { ttl_seconds: rule.ttlSeconds } : {}),
    })),
  }
}

function parseProvider(value: unknown): Provider {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的供应商格式无效', null)
  }
  return {
    id: readString(value.id, 'provider.id'),
    name: readString(value.name, 'provider.name'),
    baseUrls: readStringArray(value.base_urls, 'base_urls'),
    keys: readStringArray(value.keys, 'keys'),
    keyNotes: readStringRecord(value.key_notes, 'provider.key_notes'),
    endpoints: readObjectArray(value.endpoints, 'endpoints', parseEndpoint),
    models: readObjectArray(value.models, 'models', parseModel),
    status: readBoolean(value.status, 'provider.status'),
    autoDisabled: readBoolean(value.auto_disabled, 'provider.auto_disabled'),
    workflowEnabled: readBoolean(value.workflow_enabled, 'provider.workflow_enabled'),
  }
}

function isDisabledRecordDimension(value: unknown): value is DisabledRecordDimension {
  return value === 'key' || value === 'base_url' || value === 'provider'
}

function parseDisabledRecord(value: unknown): DisabledRecord {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的禁用记录格式无效', null)
  }
  const dimension = readString(value.dimension, 'disabled_record.dimension')
  if (!isDisabledRecordDimension(dimension)) {
    throw new DashboardApiError(`服务端返回的禁用维度无效: ${dimension}`, null)
  }
  return {
    id: readString(value.id, 'disabled_record.id'),
    providerId: readString(value.provider_id, 'disabled_record.provider_id'),
    dimension,
    value: readString(value.value, 'disabled_record.value'),
    requestHeaders: readString(value.request_headers ?? '', 'disabled_record.request_headers'),
    requestBody: readString(value.request_body ?? '', 'disabled_record.request_body'),
    errorMessage: readString(value.error_message, 'disabled_record.error_message'),
    ruleId: readString(value.rule_id ?? '', 'disabled_record.rule_id'),
    ruleName: readString(value.rule_name ?? '', 'disabled_record.rule_name'),
    disabledAt: readString(value.disabled_at, 'disabled_record.disabled_at'),
    lastRetryAt: value.last_retry_at == null || value.last_retry_at === ''
      ? null
      : readString(value.last_retry_at, 'disabled_record.last_retry_at'),
    retryCount: readNumber(value.retry_count, 'disabled_record.retry_count', 0),
    resolvedAt: value.resolved_at == null || value.resolved_at === ''
      ? null
      : readString(value.resolved_at, 'disabled_record.resolved_at'),
    createdAt: readString(value.created_at, 'disabled_record.created_at'),
    updatedAt: readString(value.updated_at, 'disabled_record.updated_at'),
  }
}

function parseDisabledValues(value: unknown, field: string): Readonly<Record<string, boolean>> {
  if (!isRecord(value)) {
    throw new DashboardApiError(`服务端返回的 ${field} 格式无效`, null)
  }
  const values: Record<string, boolean> = {}
  for (const [key, disabled] of Object.entries(value)) {
    values[key] = readBoolean(disabled, `${field}.${key}`)
  }
  return values
}

function parseProviderDisableStatus(value: unknown): ProviderDisableStatus {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的故障转移状态格式无效', null)
  }
  return {
    providerId: readString(value.provider_id, 'disable_status.provider_id'),
    provider: readBoolean(value.provider, 'disable_status.provider'),
    baseUrls: parseDisabledValues(value.base_urls, 'disable_status.base_urls'),
    keys: parseDisabledValues(value.keys, 'disable_status.keys'),
  }
}

function parseToken(value: unknown): Token {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的令牌格式无效', null)
  }
  const quota = value.quota
  return {
    id: readString(value.id, 'token.id'),
    name: readString(value.name, 'token.name'),
    key: readString(value.key, 'token.key'),
    historyKeys: readStringArray(value.history_keys, 'history_keys'),
    quota: quota === null ? null : readNumber(quota, 'token.quota'),
    usedQuota: readNumber(value.used_quota, 'token.used_quota', 0),
    status: readBoolean(value.status, 'token.status'),
  }
}

function parseStageMs(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return -1
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : -1
}

function parseLog(value: unknown): UsageLog {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的日志格式无效', null)
  }
  const status = readString(value.status, 'log.status')
  if (status !== 'success' && status !== 'failed' && status !== '') {
    throw new DashboardApiError(`无效的日志状态: ${status}`, null)
  }
  return {
    id: readString(value.id, 'log.id'),
    requestId: readString(value.request_id, 'log.request_id'),
    createdAt: readString(value.created_at, 'log.created_at'),
    userId: readString(value.user_id, 'log.user_id'),
    tokenName: readString(value.token_name, 'log.token_name'),
    providerName: readString(value.provider_name, 'log.provider_name'),
    modelName: readString(value.model_name, 'log.model_name'),
    source: readString(value.source ?? '', 'log.source'),
    promptTokens: readNumber(value.prompt_tokens, 'log.prompt_tokens'),
    completionTokens: readNumber(value.completion_tokens, 'log.completion_tokens'),
    promptCacheMissTokens: readNumber(value.prompt_cache_miss_tokens, 'log.prompt_cache_miss_tokens', 0),
    promptCacheHitTokens: readNumber(value.prompt_cache_hit_tokens, 'log.prompt_cache_hit_tokens', 0),
    isStream: readBoolean(value.is_stream, 'log.is_stream'),
    quota: readNumber(value.quota, 'log.quota'),
    currency: readString(value.currency ?? '', 'log.currency') as 'USD' | 'CNY' | '',
    useTime: readNumber(value.use_time, 'log.use_time'),
    connectMs: parseStageMs(value.connect_ms),
    firstByteMs: parseStageMs(value.first_byte_ms),
    requestRewriteMs: parseStageMs(value.request_rewrite_ms),
    responseRewriteMs: parseStageMs(value.response_rewrite_ms),
    streamRewriteMs: parseStageMs(value.stream_rewrite_ms),
    queueWaitMs: parseStageMs(value.queue_wait_ms),
    status,
    errorMessage: readString(value.error_message, 'log.error_message'),
    eventDetail: readString(value.event_detail ?? '', 'log.event_detail'),
    upstreamUrl: readString(value.upstream_url ?? '', 'log.upstream_url'),
    providerKey: readString(value.provider_key ?? '', 'log.provider_key'),
    affinityReuse: value.affinity_reuse === 'none' || value.affinity_reuse === 'partial' || value.affinity_reuse === 'full' ? value.affinity_reuse : '',
    affinityReuseParts: typeof value.affinity_reuse_parts === 'string' && value.affinity_reuse_parts !== ''
      ? value.affinity_reuse_parts.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  }
}

function parseLogCaptureFile(value: unknown): LogCaptureFile {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取日志格式无效', null)
  }
  const type = readString(value.type, 'capture.type')
  if (type !== 'request' && type !== 'response' && type !== 'system') {
    throw new DashboardApiError(`无效的抓取日志类型: ${type}`, null)
  }
  return {
    id: readString(value.id, 'capture.id'),
    name: readString(value.name, 'capture.name'),
    prefix: readString(value.prefix, 'capture.prefix'),
    source: readString(value.source, 'capture.source'),
    type,
    size: readNumber(value.size, 'capture.size'),
    created_at: readString(value.created_at, 'capture.created_at'),
  }
}

function parseLogCaptureStageRow(value: unknown): LogCaptureStageRow {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取阶段格式无效', null)
  }
  const headers = value.headers
  let parsedHeaders: Record<string, string> | null
  if (headers === undefined || headers === null) {
    parsedHeaders = null
  } else if (isRecord(headers)) {
    parsedHeaders = headers as Record<string, string>
  } else {
    throw new DashboardApiError('capture stage headers 格式无效', null)
  }
  return {
    headers: parsedHeaders,
    body: value.body,
    status: readNumber(value.status, 'stage.status', 0),
    error: value.error == null ? '' : readString(value.error, 'stage.error'),
    created_at: readString(value.created_at, 'stage.created_at'),
  }
}

function parseLogCaptureRequestNode(value: unknown): LogCaptureRequestNode {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取请求节点格式无效', null)
  }
  return {
    before: value.before == null ? undefined : parseLogCaptureStageRow(value.before),
    after: value.after == null ? undefined : parseLogCaptureStageRow(value.after),
    modified: readBoolean(value.modified, 'request.modified'),
  }
}

function parseLogCaptureResponseNode(value: unknown): LogCaptureResponseNode {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取响应节点格式无效', null)
  }
  return {
    before: value.before == null ? undefined : parseLogCaptureStageRow(value.before),
    after: value.after == null ? undefined : parseLogCaptureStageRow(value.after),
    status: readNumber(value.status, 'response.status', 0),
    modified: readBoolean(value.modified, 'response.modified'),
  }
}

function parseLogCapturePairSummary(value: unknown): LogCapturePairSummary {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取日志对格式无效', null)
  }
  const responseCount = readNumber(value.response_count, 'pair.response_count')
  if (responseCount < 0) {
    throw new DashboardApiError('response_count 不能为负', null)
  }
  return {
    request_id: readString(value.request_id, 'pair.request_id'),
    type_label: readString(value.type_label, 'pair.type_label'),
    prefix: readString(value.prefix, 'pair.prefix'),
    source: readString(value.source, 'pair.source'),
    provider_id: readString(value.provider_id, 'pair.provider_id'),
    provider_name: readString(value.provider_name ?? '', 'pair.provider_name'),
    model_name: readString(value.model_name ?? '', 'pair.model_name'),
    token_name: readString(value.token_name ?? '', 'pair.token_name'),
    created_at: readString(value.created_at, 'pair.created_at'),
    has_request: readBoolean(value.has_request, 'pair.has_request'),
    has_response: readBoolean(value.has_response, 'pair.has_response'),
    response_count: responseCount,
    has_rewrite: readBoolean(value.has_rewrite, 'pair.has_rewrite'),
    is_stream: value.is_stream === undefined ? false : readBoolean(value.is_stream, 'pair.is_stream'),
    has_error: readBoolean(value.has_error, 'pair.has_error'),
    is_incomplete: readBoolean(value.is_incomplete, 'pair.is_incomplete'),
  }
}

function parseLogCapturePairFull(value: unknown): LogCapturePairFull {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取日志对详情格式无效', null)
  }
  if (!Array.isArray(value.responses)) {
    throw new DashboardApiError('responses 必须是数组', null)
  }
  return {
    request_id: readString(value.request_id, 'pair.request_id'),
    prefix: readString(value.prefix, 'pair.prefix'),
    source: readString(value.source, 'pair.source'),
    provider_id: readString(value.provider_id, 'pair.provider_id'),
    created_at: readString(value.created_at, 'pair.created_at'),
    request: value.request == null ? undefined : parseLogCaptureRequestNode(value.request),
    responses: value.responses.map(parseLogCaptureResponseNode),
    error: value.error == null ? '' : readString(value.error, 'pair.error'),
    timing: value.timing == null ? undefined : parseLogCaptureTiming(value.timing),
    is_stream: value.is_stream === undefined ? false : readBoolean(value.is_stream, 'pair.is_stream'),
  }
}

function parseLogCaptureTiming(value: unknown): LogCaptureTiming {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的抓取耗时格式无效', null)
  }
  return {
    connectMs: parseStageMs(value.connect_ms),
    firstByteMs: parseStageMs(value.first_byte_ms),
    requestRewriteMs: parseStageMs(value.request_rewrite_ms),
    responseRewriteMs: parseStageMs(value.response_rewrite_ms),
    streamRewriteMs: parseStageMs(value.stream_rewrite_ms),
    queueWaitMs: parseStageMs(value.queue_wait_ms),
  }
}

function parseLogCaptureMergedBody(value: unknown): LogCaptureMergedBody {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的整合响应体格式无效', null)
  }
  return {
    value: value.value,
    content_type: value.content_type == null ? '' : readString(value.content_type, 'merged.content_type'),
    raw: value.raw == null ? '' : readString(value.raw, 'merged.raw'),
    merged: value.merged == null ? false : readBoolean(value.merged, 'merged.merged'),
  }
}

function parseModelStat(value: unknown): ModelStat {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的模型统计格式无效', null)
  }
  return {
    model: readString(value.model, 'stat.model'),
    count: readNumber(value.count, 'stat.count'),
    tokens: readNumber(value.tokens, 'stat.tokens'),
  }
}

function parseLogStats(value: unknown): LogStats {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的统计格式无效', null)
  }
  return {
    totalRequests: readNumber(value.total_requests, 'stat.total_requests'),
    successCount: readNumber(value.success_count, 'stat.success_count'),
    failedCount: readNumber(value.failed_count, 'stat.failed_count'),
    totalTokens: readNumber(value.total_tokens, 'stat.total_tokens'),
    averageLatency: readNumber(value.average_latency, 'stat.average_latency'),
    totalCost: readNumber(value.total_cost, 'stat.total_cost'),
    cacheHitRate: readNumber(value.cache_hit_rate, 'stat.cache_hit_rate'),
    throughput: readNumber(value.throughput, 'stat.throughput'),
    models: readObjectArray(value.models, 'stat.models', parseModelStat),
  }
}

function parseActiveRequest(value: unknown): ActiveRequest {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的活跃请求格式无效', null)
  }
  return {
    requestId: readString(value.request_id, 'active.request_id'),
    model: readString(value.model, 'active.model'),
    tokenName: readString(value.token_name, 'active.token_name'),
    userId: readString(value.user_id, 'active.user_id'),
    provider: readString(value.provider ?? '', 'active.provider'),
    providerId: readString(value.provider_id ?? '', 'active.provider_id'),
    source: readString(value.source ?? '', 'active.source'),
    startTime: readString(value.start_time, 'active.start_time'),
    stream: readBoolean(value.stream, 'active.stream'),
    elapsedMs: readNumber(value.elapsed_ms, 'active.elapsed_ms'),
    firstByteMs: value.first_byte_ms == null ? null : readNumber(value.first_byte_ms, 'active.first_byte_ms'),
    endTime: value.end_time == null || value.end_time === '' ? null : readString(value.end_time, 'active.end_time'),
    outcome: readString(value.outcome ?? '', 'active.outcome'),
    stage: readString(value.stage ?? '', 'active.stage'),
    chunkCount: readNumber(value.chunk_count ?? 0, 'active.chunk_count'),
    bytesReceived: readNumber(value.bytes_received ?? 0, 'active.bytes_received'),
    pathNodeIds: readStringArray(value.path_node_ids ?? [], 'active.path_node_ids'),
    affinityReuse: readString(value.affinity_reuse ?? '', 'active.affinity_reuse'),
  }
}

function parseActiveRequestConfig(value: unknown): ActiveRequestConfig {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的活跃请求配置格式无效', null)
  }
  const minutes = readNumber(value.retention_minutes, 'config.retention_minutes')
  if (minutes < 0 || minutes > 1440) {
    throw new DashboardApiError('服务端返回的保留时间无效', null)
  }
  return { retentionMinutes: minutes }
}

function parseEnvelope(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回格式无效', null)
  }
  if ('error' in value && typeof value.error === 'string') {
    throw new DashboardApiError(value.error, null)
  }
  return value.data
}

// REQUEST_TIMEOUT_MS caps every dashboard fetch. 高延迟 / 跨域时避免
// AuthGate 等 users/me 或业务请求无限挂起。
const REQUEST_TIMEOUT_MS = 8000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetchWithTimeout(`${apiBaseUrl}/v1/dashboard${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new DashboardApiError(`无法连接后端：${error.message}`, null)
    }
    throw new DashboardApiError('无法连接后端', null)
  }

  const text = await response.text()
  const body = text === '' ? null : parseJson(text, '响应体')
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`
    const currentRevision = isRecord(body) && typeof body.current_revision === 'number'
      ? body.current_revision
      : null
    throw new DashboardApiError(message, response.status, currentRevision)
  }
  return parseEnvelope(body)
}

async function requestFull(path: string, init?: RequestInit): Promise<JsonRecord> {
  let response: Response
  try {
    response = await fetchWithTimeout(`${apiBaseUrl}/v1/dashboard${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new DashboardApiError(`无法连接后端：${error.message}`, null)
    }
    throw new DashboardApiError('无法连接后端', null)
  }

  const body = await parseResponseBody(response)
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`
    const currentRevision = isRecord(body) && typeof body.current_revision === 'number'
      ? body.current_revision
      : null
    throw new DashboardApiError(message, response.status, currentRevision)
  }
  if (!isRecord(body)) {
    throw new DashboardApiError('服务端返回格式无效', null)
  }
  if ('error' in body && typeof body.error === 'string') {
    throw new DashboardApiError(body.error, null)
  }
  return body
}

async function requestRaw(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetchWithTimeout(`${apiBaseUrl}/v1/dashboard${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new DashboardApiError(`无法连接后端：${error.message}`, null)
    }
    throw new DashboardApiError('无法连接后端', null)
  }

  const body = await parseResponseBody(response)
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : `请求失败（HTTP ${response.status}）`
    throw new DashboardApiError(message, response.status)
  }
  return body
}

// 非 JSON 时把 HTTP 状态码一并塞进错误里，方便排查。
async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    const prefix = response.ok ? '服务端返回的响应体不是有效 JSON' : `请求失败（HTTP ${response.status}）：响应不是有效 JSON`
    throw new DashboardApiError(prefix, response.status)
  }
}

function serializeProvider(provider: ProviderInput): JsonRecord {
  return {
    name: provider.name,
    base_urls: JSON.stringify(provider.baseUrls),
    keys: JSON.stringify(provider.keys),
    key_notes: JSON.stringify(provider.keyNotes),
    endpoints: JSON.stringify(provider.endpoints),
    models: JSON.stringify(provider.models),
    status: provider.status,
    auto_disabled: provider.autoDisabled,
    workflow_enabled: provider.workflowEnabled,
  }
}

function serializeToken(token: TokenInput): JsonRecord {
  return {
    name: token.name,
    quota: token.quota,
    status: token.status,
    ...(token.key !== undefined ? { key: token.key } : {}),
    ...(token.historyKeys !== undefined ? { history_keys: JSON.stringify(token.historyKeys) } : {}),
    ...(token.usedQuota !== undefined ? { used_quota: token.usedQuota } : {}),
  }
}

// ── Rule types ──

export type RewriteRule = {
  readonly id: string
  readonly name: string
  readonly script: string
  readonly status: boolean
}

// 并行控制节点内联配置：直接在拓扑 slot 条目上保存，不再依赖规则表。
// 所有请求统一使用一个滑动窗口，不区分供应商。
export type ConcurrencyNodeConfig = {
  readonly windowMinutes: number // 每 X 分钟内
  readonly maxCount: number // 最多 N 条
}

// 后端报告的单条并发窗口当前占用（ConcurrencyWindowCounter 行的视图）。
export type ConcurrencyWindowActive = {
  readonly nodeId: string
  readonly windowCount: number // 当前窗口内活跃条数
  readonly maxCount: number // 窗口容量
}

export function defaultConcurrencyNodeConfig(): ConcurrencyNodeConfig {
  return { windowMinutes: 1, maxCount: 20 }
}

export function parseConcurrencyNodeConfig(value: unknown): ConcurrencyNodeConfig {
  if (!isRecord(value)) return defaultConcurrencyNodeConfig()
  let windowMinutes = readNumber(value.windowMinutes, 'concurrency.windowMinutes', 1)
  if (windowMinutes <= 0) windowMinutes = 1
  let maxCount = readNumber(value.maxCount, 'concurrency.maxCount', 20)
  if (maxCount <= 0) maxCount = 20
  return { windowMinutes, maxCount }
}

export type FailoverRule = {
  readonly id: string
  readonly name: string
  readonly primaryProvider: string
  readonly fallbackProvider: string
  readonly condition: 'timeout' | 'error' | 'rate_limit'
  readonly status: boolean
  readonly keywords: readonly string[]
  readonly actions: readonly FailoverAction[]
  readonly dimension: '' | 'base_url' | 'key' | 'provider'
  readonly autoDisable: boolean
  readonly matchPatterns: readonly string[]
  readonly ttfbSeconds: number
  readonly speedLimit: number
  readonly disableThreshold: number
  readonly disableWindowMinutes: number
}

export type FailoverAction = {
  readonly dimension: 'base_url' | 'key' | 'provider'
  readonly automaticPolling: boolean
  readonly autoDisable: boolean
}

export type ResponseRewriteRule = {
  readonly id: string
  readonly name: string
  readonly script: string
  readonly status: boolean
}

export type RuleType = 'rewrite' | 'failover' | 'rewrite-response'

export type RuleListParams = {
  readonly limit: number
  readonly offset: number
}

export type RuleListResult<T> = {
  readonly rules: readonly T[]
  readonly total: number
}

// ── Rule parse / serialize ──

function parseRewriteRule(value: unknown): RewriteRule {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的规则格式无效', null)
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    script: readString(value.script, 'rule.script'),
    status: readBoolean(value.status, 'rule.status'),
  }
}

function parseFailoverRule(value: unknown): FailoverRule {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的规则格式无效', null)
  const rawCondition = readString(value.condition, 'rule.condition')
  const condition = rawCondition === 'timeout' || rawCondition === 'error' || rawCondition === 'rate_limit' ? rawCondition : 'timeout'
  const rawDimension = readString(value.dimension, 'rule.dimension')
  const dimension: FailoverRule['dimension'] =
    rawDimension === 'base_url' || rawDimension === 'key' || rawDimension === 'provider' ? rawDimension : ''
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    primaryProvider: readString(value.primary_provider, 'rule.primary_provider'),
    fallbackProvider: readString(value.fallback_provider, 'rule.fallback_provider'),
    condition,
    status: readBoolean(value.status, 'rule.status'),
    keywords: readStringArray(value.keywords, 'rule.keywords'),
    actions: readObjectArray(value.actions, 'rule.actions', parseFailoverAction),
    dimension,
    autoDisable: readBoolean(value.auto_disable, 'rule.auto_disable'),
    matchPatterns: readStringArray(value.match_patterns, 'rule.match_patterns'),
    ttfbSeconds: readNumber(value.ttfb_seconds, 'rule.ttfb_seconds', 0),
    speedLimit: readNumber(value.speed_limit, 'rule.speed_limit', 0),
    disableThreshold: readNumber(value.disable_threshold, 'rule.disable_threshold', 1),
    disableWindowMinutes: readNumber(value.disable_window_minutes, 'rule.disable_window_minutes', 5),
  }
}

function parseFailoverAction(value: unknown): FailoverAction {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的故障转移动作格式无效', null)
  const dimension = readString(value.dimension, 'rule.actions.dimension')
  if (dimension !== 'base_url' && dimension !== 'key' && dimension !== 'provider') {
    throw new DashboardApiError('服务端返回的故障转移动作维度无效', null)
  }
  return {
    dimension,
    automaticPolling: readBoolean(value.automatic_polling, 'rule.actions.automatic_polling'),
    autoDisable: readBoolean(value.auto_disable, 'rule.actions.auto_disable'),
  }
}

function parseResponseRewriteRule(value: unknown): ResponseRewriteRule {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的规则格式无效', null)
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    script: readString(value.script, 'rule.script'),
    status: readBoolean(value.status, 'rule.status'),
  }
}

type RuleSerializer<T> = (rule: Partial<T> & { readonly status: boolean }) => JsonRecord

const serializeRewriteRule: RuleSerializer<RewriteRule> = (rule) => ({
  name: rule.name,
  script: (rule as RewriteRule).script ?? '',
  status: rule.status,
})

const serializeFailoverRule: RuleSerializer<FailoverRule> = (rule) => ({
  name: rule.name,
  primary_provider: (rule as FailoverRule).primaryProvider ?? '',
  fallback_provider: (rule as FailoverRule).fallbackProvider ?? '',
  condition: (rule as FailoverRule).condition ?? 'timeout',
  status: rule.status,
  keywords: (rule as FailoverRule).keywords ?? [],
  actions: (rule as FailoverRule).actions ?? [],
  dimension: (rule as FailoverRule).dimension ?? '',
  auto_disable: (rule as FailoverRule).autoDisable ?? false,
  match_patterns: (rule as FailoverRule).matchPatterns ?? [],
  ttfb_seconds: (rule as FailoverRule).ttfbSeconds ?? 0,
  speed_limit: (rule as FailoverRule).speedLimit ?? 0,
  disable_threshold: (rule as FailoverRule).disableThreshold ?? 1,
  disable_window_minutes: (rule as FailoverRule).disableWindowMinutes ?? 5,
})

const serializeResponseRewriteRule: RuleSerializer<ResponseRewriteRule> = (rule) => ({
  name: rule.name,
  script: (rule as ResponseRewriteRule).script ?? '',
  status: rule.status,
})

function ruleSerializerForType(type: RuleType): RuleSerializer<unknown> {
  switch (type) {
    case 'rewrite':           return serializeRewriteRule as RuleSerializer<unknown>
    case 'failover':          return serializeFailoverRule as RuleSerializer<unknown>
    case 'rewrite-response':  return serializeResponseRewriteRule as RuleSerializer<unknown>
  }
}

function ruleParserForType(type: RuleType): (value: unknown) => unknown {
  switch (type) {
    case 'rewrite':           return parseRewriteRule
    case 'failover':          return parseFailoverRule
    case 'rewrite-response':  return parseResponseRewriteRule
  }
}

// ── Rule API methods ──

export type RuntimeMetrics = {
  readonly uptime_seconds: number
  readonly requests_total: number
  readonly requests_success: number
  readonly requests_failed: number
  readonly active_requests: number
  readonly queued_requests: number
  readonly avg_latency_ms: number
  readonly total_tokens: number
  readonly models: Record<string, number>
}

function parseMetrics(value: unknown): RuntimeMetrics {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的运行时指标格式无效', null)
  }
  const models: Record<string, number> = {}
  const rawModels = value.models
  if (isRecord(rawModels)) {
    for (const [key, val] of Object.entries(rawModels)) {
      if (typeof val === 'number') {
        models[key] = val
      }
    }
  }
  return {
    uptime_seconds: readNumber(value.uptime_seconds, 'uptime_seconds'),
    requests_total: readNumber(value.requests_total, 'requests_total'),
    requests_success: readNumber(value.requests_success, 'requests_success'),
    requests_failed: readNumber(value.requests_failed, 'requests_failed'),
    active_requests: readNumber(value.active_requests, 'active_requests'),
    queued_requests: readNumber(value.queued_requests, 'queued_requests'),
    avg_latency_ms: readNumber(value.avg_latency_ms, 'avg_latency_ms'),
    total_tokens: readNumber(value.total_tokens, 'total_tokens'),
    models,
  }
}

function parseTopologyVersionSummary(value: unknown): TopologyVersionSummary {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的版本格式无效', null)
  }
  return {
    id: readString(value.id, 'version.id'),
    createdAt: readString(value.created_at, 'version.created_at'),
    workflowTotal: readNumber(value.workflow_total, 'version.workflow_total'),
    workflowActive: readNumber(value.workflow_active, 'version.workflow_active'),
    nodeCount: readNumber(value.node_count, 'version.node_count'),
  }
}

function parseTopologyCurrentVersion(value: unknown): TopologyCurrentVersion {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的当前版本格式无效', null)
  }
  return {
    archived: readBoolean(value.archived, 'version.archived'),
    workflowTotal: readNumber(value.workflow_total, 'version.workflow_total'),
    workflowActive: readNumber(value.workflow_active, 'version.workflow_active'),
    nodeCount: readNumber(value.node_count, 'version.node_count'),
    updatedAt: readString(value.updated_at, 'version.updated_at'),
  }
}

function parseTopologyVersionList(value: unknown): TopologyVersionList {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的版本列表格式无效', null)
  }
  const versions = value.versions
  if (!Array.isArray(versions)) {
    throw new DashboardApiError('服务端返回的版本列表格式无效', null)
  }
  return {
    current: value.current === null ? null : parseTopologyCurrentVersion(value.current),
    versions: versions.map(parseTopologyVersionSummary),
  }
}

function parseAgentSshConfig(value: unknown): AgentSshConfig | null {
  if (value === null || value === undefined || value === '') return null
  // The backend persists ssh_config as a JSON blob string on the row and
  // re-sends that blob (sanitized) in list responses. Accept both the
  // string form and a pre-decoded object.
  let record: unknown = value
  if (typeof value === 'string') {
    try {
      record = parseJson(value, 'ssh_config')
    } catch {
      throw new DashboardApiError('服务端返回的 SSH 配置格式无效', null)
    }
  }
  if (!isRecord(record)) {
    throw new DashboardApiError('服务端返回的 SSH 配置格式无效', null)
  }
  const authType = readString(record.auth_type, 'ssh_config.auth_type')
  if (authType !== 'password' && authType !== 'key') {
    throw new DashboardApiError(`无效的 SSH 认证方式: ${authType}`, null)
  }
  const jumpAuthTypeValue = record.jump_auth_type
  const jumpAuthType = jumpAuthTypeValue === undefined || jumpAuthTypeValue === null || jumpAuthTypeValue === ''
    ? undefined
    : readString(jumpAuthTypeValue, 'ssh_config.jump_auth_type')
  if (jumpAuthType !== undefined && jumpAuthType !== 'password' && jumpAuthType !== 'key') {
    throw new DashboardApiError(`无效的跳板机认证方式: ${jumpAuthType}`, null)
  }
  return {
    host: readString(record.host, 'ssh_config.host'),
    port: readNumber(record.port, 'ssh_config.port', 22),
    username: readString(record.username, 'ssh_config.username'),
    auth_type: authType,
    password: record.password === undefined || record.password === null || record.password === ''
      ? undefined
      : readString(record.password, 'ssh_config.password'),
    private_key: record.private_key === undefined || record.private_key === null || record.private_key === ''
      ? undefined
      : readString(record.private_key, 'ssh_config.private_key'),
    jump_enabled: record.jump_enabled === undefined || record.jump_enabled === null
      ? false
      : readBoolean(record.jump_enabled, 'ssh_config.jump_enabled'),
    jump_host: record.jump_host === undefined || record.jump_host === null || record.jump_host === ''
      ? undefined
      : readString(record.jump_host, 'ssh_config.jump_host'),
    jump_port: readNumber(record.jump_port, 'ssh_config.jump_port', 22),
    jump_username: record.jump_username === undefined || record.jump_username === null || record.jump_username === ''
      ? undefined
      : readString(record.jump_username, 'ssh_config.jump_username'),
    jump_auth_type: jumpAuthType,
    jump_password: record.jump_password === undefined || record.jump_password === null || record.jump_password === ''
      ? undefined
      : readString(record.jump_password, 'ssh_config.jump_password'),
    jump_private_key: record.jump_private_key === undefined || record.jump_private_key === null || record.jump_private_key === ''
      ? undefined
      : readString(record.jump_private_key, 'ssh_config.jump_private_key'),
  }
}

function parseAgentTypeRule(value: unknown): AgentTypeRule {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的软件类型规则格式无效', null)
  }
  const osPaths = isRecord(value.os_paths) ? value.os_paths : {}
  const jsonPaths = isRecord(value.json_paths) ? value.json_paths : {}
  const recs = Array.isArray(value.recommendations) ? value.recommendations : []
  const protocols = Array.isArray(value.protocols) ? value.protocols : []
  const mif = isRecord(value.model_info_fields) ? value.model_info_fields : {}
  return {
    id: readString(value.id, 'agent_type_rule.id'),
    name: readString(value.name, 'agent_type_rule.name'),
    os_paths: {
      windows: typeof osPaths.windows === 'string' ? osPaths.windows : '',
      mac: typeof osPaths.mac === 'string' ? osPaths.mac : '',
    },
    json_paths: {
      provider: typeof jsonPaths.provider === 'string' ? jsonPaths.provider : '',
      model: typeof jsonPaths.model === 'string' ? jsonPaths.model : '',
      models_container: parseAgentModelsContainer(jsonPaths.models_container),
    },
    recommendations: recs.map(parseAgentRecommendation),
    protocols: protocols.map(parseAgentProtocol),
    model_info_fields: {
      max_context: parseAgentModelInfoSpec(mif.max_context),
      max_output_token: parseAgentModelInfoSpec(mif.max_output_token),
      input_types: parseAgentModelInfoSpec(mif.input_types),
      thinking_levels: parseAgentModelInfoSpec(mif.thinking_levels),
      reasoning_effort: parseAgentModelInfoSpec(mif.reasoning_effort),
    },
    config_jsonc: typeof value.config_jsonc === 'string' ? value.config_jsonc : '',
    customized: value.customized === true,
    created_at: readString(value.created_at, 'agent_type_rule.created_at'),
    updated_at: readString(value.updated_at, 'agent_type_rule.updated_at'),
    has_template: value.has_template === true,
  }
}

function parseAgentTemplateConfig(value: unknown): AgentTemplateConfig {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的默认推荐模版格式无效', null)
  }
  const osPaths = isRecord(value.os_paths) ? value.os_paths : {}
  const jsonPaths = isRecord(value.json_paths) ? value.json_paths : {}
  const recs = Array.isArray(value.recommendations) ? value.recommendations : []
  const protocols = Array.isArray(value.protocols) ? value.protocols : []
  const mif = isRecord(value.model_info_fields) ? value.model_info_fields : {}
  return {
    name: readString(value.name, 'agent_template.name'),
    os_paths: {
      windows: typeof osPaths.windows === 'string' ? osPaths.windows : '',
      mac: typeof osPaths.mac === 'string' ? osPaths.mac : '',
    },
    json_paths: {
      provider: typeof jsonPaths.provider === 'string' ? jsonPaths.provider : '',
      model: typeof jsonPaths.model === 'string' ? jsonPaths.model : '',
      models_container: parseAgentModelsContainer(jsonPaths.models_container),
    },
    recommendations: recs.map(parseAgentRecommendation),
    protocols: protocols.map(parseAgentProtocol),
    model_info_fields: {
      max_context: parseAgentModelInfoSpec(mif.max_context),
      max_output_token: parseAgentModelInfoSpec(mif.max_output_token),
      input_types: parseAgentModelInfoSpec(mif.input_types),
      thinking_levels: parseAgentModelInfoSpec(mif.thinking_levels),
      reasoning_effort: parseAgentModelInfoSpec(mif.reasoning_effort),
    },
  }
}

function parseAgentProtocol(value: unknown): AgentProtocol {
  if (!isRecord(value)) {
    return { name: '', conditions: [], endpoint_tags: [], recommendations: [] }
  }
  const conditions = Array.isArray(value.conditions) ? value.conditions : []
  const tags = Array.isArray(value.endpoint_tags) ? value.endpoint_tags : []
  const recs = Array.isArray(value.recommendations) ? value.recommendations : []
  return {
    name: typeof value.name === 'string' ? value.name : '',
    conditions: conditions.map((c) => {
      if (!isRecord(c)) return { field: '', op: 'contains' as const, value: '' }
      const op = c.op
      const valid: readonly AgentProtocolConditionOp[] = ['equals', 'contains', 'not_contains', 'not_equals']
      return {
        field: typeof c.field === 'string' ? c.field : '',
        op: valid.includes(op as AgentProtocolConditionOp) ? (op as AgentProtocolConditionOp) : 'contains',
        value: typeof c.value === 'string' ? c.value : '',
      }
    }),
    endpoint_tags: tags.filter((t): t is string => typeof t === 'string'),
    recommendations: recs.map(parseAgentRecommendation),
  }
}

// parseAgentModelsContainer maps whatever the server returned for the
// rule's `models_container` field onto the canonical form used by the
// UI: "" (unknown / unset, fall back to "object"), "array" or "object".
// Anything else is coerced to "" so the editor doesn't display a bogus
// value, and the write path then degrades to the legacy object shape.
function parseAgentModelsContainer(value: unknown): AgentModelsContainer {
  if (typeof value !== 'string') return ''
  const lower = value.trim().toLowerCase()
  if (lower === 'array' || lower === 'object') return lower
  return ''
}

function parseAgentRecommendation(value: unknown): AgentRecommendation {
  if (!isRecord(value)) {
    return { scope: 'provider', key: '', description: '', recommended: null, required: false }
  }
  const scope = value.scope === 'model' ? 'model' : 'provider'
  const candidates = isRecord(value.candidates) ? value.candidates : {}
  const out: Record<string, string> = {}
  for (const k of Object.keys(candidates)) {
    const v = candidates[k]
    out[k] = typeof v === 'string' ? v : ''
  }
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    scope,
    key: typeof value.key === 'string' ? value.key : '',
    description: typeof value.description === 'string' ? value.description : '',
    action:
      value.action === 'skip' || value.action === 'delete'
        ? (value.action as 'skip' | 'delete')
        : undefined,
    recommended: value.recommended ?? null,
    candidates: Object.keys(out).length > 0 ? out : undefined,
    required: value.required === true,
    op: AGENT_MODEL_INFO_FIELD_OPS.includes(value.op as AgentModelInfoFieldOp)
      ? (value.op as AgentModelInfoFieldOp)
      : undefined,
    sep: typeof value.sep === 'string' && value.sep !== '' ? value.sep : undefined,
    values: Array.isArray(value.values) ? value.values.filter((x): x is string => typeof x === 'string') : undefined,
  }
}

function parseAgentPathCheckResult(value: unknown): AgentPathCheckResult {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的路径检测结果无效', null)
  }
  return {
    exists: readBoolean(value.exists, 'path_check.exists'),
    size: readNumber(value.size, 'path_check.size', 0),
    current_os: readString(value.current_os, 'path_check.current_os'),
    expandedPath: readString(value.expandedPath, 'path_check.expandedPath'),
  }
}

function parseAgentSshProbeResult(value: unknown): AgentSshProbeResult {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 SSH 探测结果无效', null)
  }
  return {
    ok: readBoolean(value.ok, 'ssh_probe.ok'),
    error: typeof value.error === 'string' ? value.error : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
  }
}

function parseAgentConfigFile(value: unknown): AgentConfigFile {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的接管配置格式无效', null)
  }
  const mode = readString(value.mode, 'agent_config.mode')
  if (mode !== 'local' && mode !== 'ssh') {
    throw new DashboardApiError(`无效的接管模式: ${mode}`, null)
  }
  const targetOs = value.target_os
  if (targetOs !== null && targetOs !== '' && targetOs !== 'windows' && targetOs !== 'mac' && targetOs !== 'other') {
    throw new DashboardApiError(`无效的目标系统: ${String(targetOs)}`, null)
  }
  return {
    id: readString(value.id, 'agent_config.id'),
    record_name: readString(value.record_name, 'agent_config.record_name'),
    agent_type: readString(value.agent_type, 'agent_config.agent_type'),
    mode,
    target_os: typeof targetOs === 'string' && targetOs !== '' ? targetOs : null,
    path: readString(value.path, 'agent_config.path'),
    ssh_config: parseAgentSshConfig(value.ssh_config),
    created_at: readString(value.created_at, 'agent_config.created_at'),
    updated_at: readString(value.updated_at, 'agent_config.updated_at'),
  }
}

function parseAgentModelSummary(value: unknown): AgentModelSummary {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的模型摘要格式无效', null)
  }
  const providers = Array.isArray(value.providers) ? value.providers : []
  const recs = Array.isArray(value.recommendations) ? value.recommendations : []
  const protocols = Array.isArray(value.protocols) ? value.protocols : []
  const mif = isRecord(value.model_info_fields) ? value.model_info_fields : {}
  return {
    agent_type: typeof value.agent_type === 'string' ? value.agent_type : '',
    providers: providers.map((raw) => {
      if (!isRecord(raw)) return { provider_id: '', other_fields: null, models: [] }
      const models = Array.isArray(raw.models) ? raw.models : []
      return {
        provider_id: typeof raw.provider_id === 'string' ? raw.provider_id : '',
        other_fields: raw.other_fields ?? null,
        models: models.map((m) => {
          if (!isRecord(m)) return { id: '', config: null }
          return {
            id: typeof m.id === 'string' ? m.id : '',
            config: m.config ?? null,
          }
        }),
      }
    }),
    recommendations: recs.map(parseAgentRecommendation),
    protocols: protocols.map(parseAgentProtocol),
    model_info_fields: {
      max_context: parseAgentModelInfoSpec(mif.max_context),
      max_output_token: parseAgentModelInfoSpec(mif.max_output_token),
      input_types: parseAgentModelInfoSpec(mif.input_types),
      thinking_levels: parseAgentModelInfoSpec(mif.thinking_levels),
      reasoning_effort: parseAgentModelInfoSpec(mif.reasoning_effort),
    },
    json_paths: (() => {
      const jp = isRecord(value.json_paths) ? value.json_paths : {}
      return {
        provider: typeof jp.provider === 'string' ? jp.provider : '',
        model: typeof jp.model === 'string' ? jp.model : '',
        models_container: parseAgentModelsContainer(jp.models_container),
      }
    })(),
  }
}

export const dashboardApi = {
  // ── Providers ──
  async listProviders(params: ProviderListParams): Promise<{ readonly providers: readonly Provider[]; readonly total: number }> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    const body = await requestFull(`/providers?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的供应商列表格式无效', null)
    }
    return {
      providers: data.map(parseProvider),
      total: readNumber(body.total, 'total', 0),
    }
  },
  async createProvider(provider: ProviderInput): Promise<Provider> {
    return parseProvider(await request('/providers', { method: 'POST', body: JSON.stringify(serializeProvider(provider)) }))
  },
  async updateProvider(id: string, provider: ProviderInput): Promise<Provider> {
    return parseProvider(await request(`/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ id, ...serializeProvider(provider) }) }))
  },
  async deleteProvider(id: string): Promise<void> {
    await request(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async toggleProvider(id: string): Promise<Provider> {
    return parseProvider(await request(`/providers/${encodeURIComponent(id)}/toggle`, { method: 'POST' }))
  },
  async toggleWorkflow(id: string): Promise<Provider> {
    return parseProvider(await request(`/providers/${encodeURIComponent(id)}/workflow-toggle`, { method: 'POST' }))
  },
  async listProviderDisableStatuses(): Promise<readonly ProviderDisableStatus[]> {
    const body = await requestFull('/providers/disable-status')
    if (!Array.isArray(body.data)) {
      throw new DashboardApiError('服务端返回的故障转移状态列表格式无效', null)
    }
    return body.data.map(parseProviderDisableStatus)
  },
  async resetProviderDisableStatus(
    id: string,
    input: { readonly dimension: ProviderDisableDimension; readonly value: string },
  ): Promise<void> {
    await request(`/providers/${encodeURIComponent(id)}/disable-status/reset`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async resetAllProviderDisableStatus(dimension: ProviderDisableDimension): Promise<void> {
    await request('/providers/disable-status/reset-all', {
      method: 'POST',
      body: JSON.stringify({ dimension }),
    })
  },
  async resetProviderDisableDimension(id: string, dimension: ProviderDisableDimension): Promise<void> {
    await request(`/providers/${encodeURIComponent(id)}/disable-status/reset-dimension`, {
      method: 'POST',
      body: JSON.stringify({ dimension }),
    })
  },

  // ── Disabled records ──
  async listDisabledRecords(): Promise<readonly DisabledRecord[]> {
    const data = await request('/disabled-records')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的禁用记录列表格式无效', null)
    }
    return data.map(parseDisabledRecord)
  },
  async replayDisabledRecord(id: string): Promise<{ readonly record: DisabledRecord; readonly resolved: boolean }> {
    const body = await requestFull(`/disabled-records/${encodeURIComponent(id)}/replay`, { method: 'POST' })
    return {
      record: parseDisabledRecord(body.data),
      resolved: readBoolean(body.resolved, 'replay.resolved'),
    }
  },
  async restoreDisabledRecordDirectly(id: string): Promise<{ readonly resolved: boolean }> {
    const body = await requestFull(`/disabled-records/${encodeURIComponent(id)}/restore-direct`, { method: 'POST' })
    return { resolved: readBoolean(body.resolved, 'restore.resolved') }
  },
  async extendDisabledRecordCountdown(id: string, minutes: number): Promise<{ readonly record: DisabledRecord; readonly extended: boolean }> {
    const body = await requestFull(`/disabled-records/${encodeURIComponent(id)}/extend-countdown`, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    })
    return {
      record: parseDisabledRecord(body.data),
      extended: readBoolean(body.extended, 'extend.extended'),
    }
  },

  // ── Tokens ──
  async listTokens(params: TokenListParams): Promise<TokenListResult> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    const body = await requestFull(`/tokens?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的令牌列表格式无效', null)
    }
    return {
      tokens: data.map(parseToken),
      total: readNumber(body.total, 'total', 0),
    }
  },
  async createToken(token: TokenInput): Promise<Token> {
    return parseToken(await request('/tokens', { method: 'POST', body: JSON.stringify(serializeToken(token)) }))
  },
  async updateToken(id: string, token: TokenInput): Promise<Token> {
    return parseToken(await request(`/tokens/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ id, ...serializeToken(token) }) }))
  },
  async deleteToken(id: string): Promise<void> {
    await request(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async toggleToken(id: string): Promise<Token> {
    return parseToken(await request(`/tokens/${encodeURIComponent(id)}/toggle`, { method: 'POST' }))
  },
  async rotateToken(id: string): Promise<Token> {
    return parseToken(await request(`/tokens/${encodeURIComponent(id)}/rotate`, { method: 'POST' }))
  },

  // ── Logs ──
  async listLogs(params: LogListParams): Promise<LogListResult> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    if (params.model) qp.set('model', params.model)
    if (params.provider) qp.set('provider', params.provider)
    if (params.type) qp.set('type', params.type)
    if (params.status) qp.set('status', params.status)
    if (params.token) qp.set('token', params.token)
    if (params.source) qp.set('source', params.source)
    if (params.requestId) qp.set('request_id', params.requestId)
    if (params.from) qp.set('from', toRFC3339Date(params.from, false) ?? params.from)
    if (params.to) qp.set('to', toRFC3339Date(params.to, true) ?? params.to)

    const body = await requestFull(`/logs?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的日志列表格式无效', null)
    }
    return {
      logs: data.map(parseLog),
      total: readNumber(body.total, 'total', 0),
    }
  },

  async clearLogs(input: { scope: 'filtered' | 'all'; filters?: Record<string, unknown> }): Promise<number> {
    const body = await requestFull('/logs/clear', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return readNumber(body.deleted, 'deleted', 0)
  },

  async clearUsage(): Promise<void> {
    await requestFull('/usage/clear', { method: 'POST' })
  },

  async listLogCaptureFiles(params: LogCaptureListParams): Promise<LogCaptureListResult> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    if (params.prefix) qp.set('prefix', params.prefix)
    if (params.type) qp.set('type', params.type)
    if (params.from) qp.set('from', toRFC3339Date(params.from, false) ?? params.from)
    if (params.to) qp.set('to', toRFC3339Date(params.to, true) ?? params.to)
    if (params.headerKey) qp.set('headerKey', params.headerKey)
    if (params.headerValue) qp.set('headerValue', params.headerValue)
    if (params.token) qp.set('token', params.token)
    if (params.provider) qp.set('provider', params.provider)
    if (params.model) qp.set('model', params.model)
    if (params.source) qp.set('source', params.source)

    const body = await requestFull(`/logs/capture?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的抓取日志列表格式无效', null)
    }
    return {
      files: data.map(parseLogCaptureFile),
      total: readNumber(body.total, 'total', 0),
    }
  },

  async clearLogCapture(input: {
    scope: 'filtered' | 'all'
    prefix?: string
    type?: string
    source?: string
    from?: string
    to?: string
  }): Promise<number> {
    const body = await requestFull('/log-capture/clear', {
      method: 'POST',
      body: JSON.stringify({
        scope: input.scope,
        ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.from !== undefined ? { from: input.from } : {}),
        ...(input.to !== undefined ? { to: input.to } : {}),
      }),
    })
    return readNumber(body.deleted, 'deleted', 0)
  },

  async readLogCaptureFile(id: string): Promise<unknown> {
    const body = await requestFull(`/logs/capture/${encodeURIComponent(id)}`)
    return body.data
  },

  async listLogCapturePairs(params: LogCaptureListParams): Promise<LogCapturePairListResult> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    if (params.prefix) qp.set('prefix', params.prefix)
    if (params.type) qp.set('type', params.type)
    if (params.from) qp.set('from', toRFC3339Date(params.from, false) ?? params.from)
    if (params.to) qp.set('to', toRFC3339Date(params.to, true) ?? params.to)
    if (params.headerKey) qp.set('headerKey', params.headerKey)
    if (params.headerValue) qp.set('headerValue', params.headerValue)
    if (params.token) qp.set('token', params.token)
    if (params.provider) qp.set('provider', params.provider)
    if (params.model) qp.set('model', params.model)
    if (params.source) qp.set('source', params.source)
    const body = await requestFull(`/logs/capture/pairs?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的抓取日志对列表格式无效', null)
    }
    return {
      pairs: data.map(parseLogCapturePairSummary),
      total: readNumber(body.total, 'total', 0),
    }
  },

  async listLogCapturePrefixes(): Promise<readonly string[]> {
    const body = await requestFull('/logs/capture/prefixes')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的抓取文件夹列表格式无效', null)
    }
    return data.map((v) => readString(v, 'prefix.name'))
  },

  async listLogSources(): Promise<readonly string[]> {
    const body = await requestFull('/logs/sources')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的来源列表格式无效', null)
    }
    return data.map((v) => readString(v, 'source.name'))
  },

  async listLogModels(): Promise<readonly string[]> {
    const body = await requestFull('/logs/models')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的模型列表格式无效', null)
    }
    return data.map((v) => readString(v, 'model.name'))
  },

  async listLogCaptureSources(): Promise<readonly string[]> {
    const body = await requestFull('/logs/capture/sources')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的抓取来源列表格式无效', null)
    }
    return data.map((v) => readString(v, 'source.name'))
  },

  async listLogCaptureModels(): Promise<readonly string[]> {
    const body = await requestFull('/logs/capture/models')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的抓取模型列表格式无效', null)
    }
    return data.map((v) => readString(v, 'model.name'))
  },

  async readLogCapturePair(requestId: string): Promise<LogCapturePairFull> {
    const body = await requestFull(`/logs/capture/pairs/${encodeURIComponent(requestId)}`)
    return parseLogCapturePairFull(body.data)
  },

  async readLogCaptureMergedResponse(
    requestId: string,
    opts: { stage?: 'before' | 'after'; index?: number } = {},
  ): Promise<LogCaptureMergedBody> {
    const qp = new URLSearchParams()
    if (opts.stage) qp.set('stage', opts.stage)
    if (opts.index != null) qp.set('index', String(opts.index))
    const qs = qp.toString()
    const path = `/logs/capture/pairs/${encodeURIComponent(requestId)}/merged-response${qs ? `?${qs}` : ''}`
    const body = await requestFull(path)
    return parseLogCaptureMergedBody(body.data)
  },

  async getLogStats(range: DateRange): Promise<LogStats> {
    const qp = new URLSearchParams()
    if (range.from) qp.set('from', toRFC3339Date(range.from, false) ?? range.from)
    if (range.to) qp.set('to', toRFC3339Date(range.to, true) ?? range.to)
    const data = await request(`/logs/stats?${qp.toString()}`)
    return parseLogStats(data)
  },

  async getActiveRequests(): Promise<readonly ActiveRequest[]> {
    const data = await request('/active-requests')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的活跃请求列表格式无效', null)
    }
    return data.map(parseActiveRequest)
  },
  async killActiveRequest(requestId: string): Promise<void> {
    await request(`/active-requests/${encodeURIComponent(requestId)}/kill`, { method: 'POST' })
  },

  async getActiveRequestConfig(): Promise<ActiveRequestConfig> {
    const data = await request('/active-requests/config')
    return parseActiveRequestConfig(data)
  },

  async updateActiveRequestConfig(retentionMinutes: number): Promise<ActiveRequestConfig> {
    const data = await request('/active-requests/config', {
      method: 'PUT',
      body: JSON.stringify({ retention_minutes: retentionMinutes }),
    })
    return parseActiveRequestConfig(data)
  },

  // ── Rules ──
  async listRules<T>(type: RuleType, params: RuleListParams): Promise<RuleListResult<T>> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    const body = await requestFull(`/rules/${encodeURIComponent(type)}?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) throw new DashboardApiError('服务端返回的规则列表格式无效', null)
    return {
      rules: data.map(ruleParserForType(type)) as readonly T[],
      total: readNumber(body.total, 'total', 0),
    }
  },
  async createRule<T>(type: RuleType, rule: Partial<T> & { readonly status: boolean }): Promise<T> {
    const serializer = ruleSerializerForType(type)
    return ruleParserForType(type)(await request(
      `/rules/${encodeURIComponent(type)}`,
      { method: 'POST', body: JSON.stringify(serializer(rule)) },
    )) as T
  },
  async updateRule<T>(type: RuleType, id: string, rule: Partial<T> & { readonly status: boolean }): Promise<T> {
    const serializer = ruleSerializerForType(type)
    return ruleParserForType(type)(await request(
      `/rules/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(serializer(rule)) },
    )) as T
  },
async deleteRule(type: RuleType, id: string): Promise<void> {
    await request(`/rules/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async testRewriteRule(type: 'rewrite' | 'rewrite-response', id: string, body: unknown): Promise<{original: unknown; modified: unknown}> {
    const data = await request(`/rules/${type}/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    if (!isRecord(data)) throw new DashboardApiError('服务端返回格式无效', null)
    return { original: data.original, modified: data.modified }
  },

  async currentUser(): Promise<CurrentUser> {
    const body = await request('/users/me')
    if (!isRecord(body)) {
      throw new DashboardApiError('服务端返回的用户信息格式无效', null)
    }
    return {
      id: readString(body.id, 'user.id'),
      username: readString(body.username, 'user.username'),
      role: readString(body.role, 'user.role'),
    }
  },
  async updateUsername(username: string): Promise<CurrentUser> {
    const body = await request('/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    })
    if (!isRecord(body)) {
      throw new DashboardApiError('服务端返回的用户信息格式无效', null)
    }
    return {
      id: readString(body.id, 'user.id'),
      username: readString(body.username, 'user.username'),
      role: readString(body.role, 'user.role'),
    }
  },
  async updatePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request('/users/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
  },

  async login(username: string, password: string): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/v1/dashboard/users/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) {
      const text = await response.text()
      const body = text === '' ? null : parseJson(text, '登录响应')
      const message = isRecord(body) && typeof body.error === 'string' ? body.error : `登录失败（HTTP ${response.status}）`
      throw new DashboardApiError(message, response.status)
    }
  },
  async logout(): Promise<void> {
    try {
      await fetch(`${apiBaseUrl}/v1/dashboard/users/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore — logout must always succeed client-side
    }
  },

  // ── Settings ──
  async getSettings(): Promise<readonly SystemSetting[]> {
    const data = await request('/settings')
    return (Array.isArray(data) ? data : []).map(parseSystemSetting)
  },
  async updateSetting(key: string, value: string): Promise<SystemSetting> {
    return parseSystemSetting(await request('/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }))
  },
  async refreshExchangeRate(): Promise<number> {
    const body = await request('/exchange-rate/refresh', { method: 'POST' })
    const rate = isRecord(body) ? readNumber(body.rate, 'exchange-rate.rate', 0) : 0
    if (rate <= 0) {
      throw new DashboardApiError('服务端返回的汇率格式无效', null)
    }
    return rate
  },
  async testExchangeRate(url: string, field: string): Promise<number> {
    const body = await request('/exchange-rate/test', {
      method: 'POST',
      body: JSON.stringify({ url, field }),
    })
    const rate = isRecord(body) ? readNumber(body.rate, 'exchange-rate.rate', 0) : 0
    if (rate <= 0) {
      throw new DashboardApiError('服务端返回的汇率格式无效', null)
    }
    return rate
  },
  async getBaseUrlPaths(): Promise<readonly string[]> {
    const data = await request('/settings/base-url-paths')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的路径列表格式无效', null)
    }
    return data.filter(isRecord).map((v) => readString(v.path, 'base-url-path.path'))
  },
  async replaceBaseUrlPaths(paths: readonly string[]): Promise<void> {
    await request('/settings/base-url-paths', {
      method: 'PUT',
      body: JSON.stringify({ paths }),
    })
  },

  // ── Provider models ──
  async fetchModelsFromEndpoint(endpoint: string, key?: string): Promise<readonly FetchedModel[]> {
    const data = await request('/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ endpoint, ...(key !== undefined ? { key } : {}) }),
    })
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的模型列表格式无效', null)
    }
    return data.map(parseFetchedModel)
  },

  async getTopology(): Promise<TopologyDocument> {
    const body = await requestRaw('/topology')
    return parseTopologyDocument(body)
  },
  async saveTopology(document: TopologyDocument): Promise<TopologyDocument> {
    const body = await requestRaw('/topology', {
      method: 'PUT',
      body: JSON.stringify(document),
    })
    return parseTopologyDocument(body)
  },

  async getChannelAffinity(): Promise<ChannelAffinityPayload> {
    const body = await request('/channel-affinity')
    return parseChannelAffinityPayload(body)
  },
  async saveChannelAffinity(input: ChannelAffinityPayloadInput): Promise<ChannelAffinityPayload> {
    const body = await request('/channel-affinity', {
      method: 'PUT',
      body: JSON.stringify({
        setting: serializeChannelAffinity(input.setting),
        fallback: {
          enabled: input.fallback.enabled,
          session_id_fields: input.fallback.sessionIdFields,
          model_fields: input.fallback.modelFields,
        },
      }),
    })
    return parseChannelAffinityPayload(body)
  },

  async getTableConfig(id: string): Promise<TableConfig | null> {
    try {
      const body = await requestFull(`/table-configs/${encodeURIComponent(id)}`)
      return parseTableConfig(body.data)
    } catch (err) {
      if (err instanceof DashboardApiError && err.status === 404) return null
      throw err
    }
  },
  async saveTableConfig(id: string, configs: readonly ColumnDisplayConfig[]): Promise<TableConfig> {
    const body = await requestFull(`/table-configs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ configs }),
    })
    return parseTableConfig(body.data)
  },

  async getFlatTopology(): Promise<FlatTopology> {
    const body = await request('/flat-topology')
    return parseFlatTopology(body)
  },
  async saveFlatTopology(tp: FlatTopology): Promise<FlatTopology> {
    const body = await request('/flat-topology', {
      method: 'PUT',
      body: JSON.stringify(serializeFlatTopology(tp)),
    })
    return parseFlatTopology(body)
  },

  async getLayout(): Promise<{ layout: LayoutSnapshot; version: number; updatedAt: string }> {
    const body = await request('/layout')
    return parseLayoutResponse(body)
  },
  async saveLayout(layout: LayoutSnapshot): Promise<{ layout: LayoutSnapshot; version: number; updatedAt: string }> {
    const body = await request('/layout', {
      method: 'PUT',
      body: JSON.stringify({ layout }),
    })
    return parseLayoutResponse(body)
  },
  async validateFlatTopology(): Promise<readonly DuplicateActivation[]> {
    const body = await request('/flat-topology/validate')
    if (!Array.isArray(body)) throw new DashboardApiError('服务端返回的重复激活冲突格式无效', null)
    return body.map(parseDuplicateActivation)
  },

  async listConcurrencyWindows(): Promise<readonly ConcurrencyWindowActive[]> {
    const body = await request('/concurrency/windows')
    if (!Array.isArray(body)) throw new DashboardApiError('服务端返回的并发窗口状态格式无效', null)
    return body.map((raw) => {
      const nodeId = isRecord(raw) && typeof raw.node_id === 'string' ? raw.node_id : ''
      const windowCount = isRecord(raw) && typeof raw.window_count === 'number' ? raw.window_count : 0
      const maxCount = isRecord(raw) && typeof raw.max_count === 'number' ? raw.max_count : 0
      return { nodeId, windowCount, maxCount }
    })
  },

  async listTopologyVersions(): Promise<TopologyVersionList> {
    return parseTopologyVersionList(await request('/topology/versions'))
  },
  async archiveTopologyVersion(): Promise<TopologyVersionList> {
    return parseTopologyVersionList(await request('/topology/versions/archive', { method: 'POST' }))
  },
  async getTopologyVersion(id: string): Promise<{ version: TopologyVersionSummary; document: FlatTopology }> {
    const body = await request(`/topology/versions/${encodeURIComponent(id)}`)
    if (!isRecord(body)) {
      throw new DashboardApiError('服务端返回的版本详情格式无效', null)
    }
    return {
      version: parseTopologyVersionSummary(body),
      document: parseFlatTopology(body.document),
    }
  },
  async restoreTopologyVersion(id: string): Promise<TopologyVersionList> {
    return parseTopologyVersionList(await request(`/topology/versions/${encodeURIComponent(id)}/restore`, { method: 'POST' }))
  },

  async getRuntimeMetrics(): Promise<RuntimeMetrics> {
    let response: Response
    try {
      response = await fetch(`${apiBaseUrl}/metrics`, {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof Error) {
        throw new DashboardApiError(`无法连接后端：${error.message}`, null)
      }
      throw new DashboardApiError('无法连接后端', null)
    }

    const text = await response.text()
    if (!response.ok) {
      throw new DashboardApiError(`获取指标失败（HTTP ${response.status}）`, response.status)
    }

    const body = text === '' ? null : parseJson(text, '指标响应')
    return parseMetrics(body)
  },

  // ── Agent 接管 ──
  async listAgentTypes(): Promise<readonly string[]> {
    const data = await request('/agent-types')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的软件类型列表格式无效', null)
    }
    return data.map((name) => {
      if (typeof name !== 'string') {
        throw new DashboardApiError('服务端返回的软件类型列表格式无效', null)
      }
      return name
    })
  },
  async listAgentTypeRules(): Promise<{ readonly rules: readonly AgentTypeRule[]; readonly total: number }> {
    const body = await requestFull('/agent-type-rules?limit=1000&offset=0')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的软件类型规则列表格式无效', null)
    }
    return {
      rules: data.map(parseAgentTypeRule),
      total: readNumber(body.total, 'total', 0),
    }
  },
  async getAgentTypeRuleTemplate(name: string): Promise<AgentTemplateConfig> {
    const data = await request(`/agent-type-rules/${encodeURIComponent(name)}/template`)
    return parseAgentTemplateConfig(data)
  },
  async createAgentTypeRule(name: string): Promise<AgentTypeRule> {
    return parseAgentTypeRule(await request('/agent-type-rules', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }))
  },
  async updateAgentTypeRule(id: string, input: AgentTypeRuleInput): Promise<AgentTypeRule> {
    return parseAgentTypeRule(await request(`/agent-type-rules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }))
  },
  async deleteAgentTypeRule(id: string): Promise<void> {
    await request(`/agent-type-rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async checkAgentConfigPath(rawPath: string): Promise<AgentPathCheckResult> {
    const data = await request(`/agent-config-files/check?path=${encodeURIComponent(rawPath)}`)
    return parseAgentPathCheckResult(data)
  },
  async readAgentConfigPath(rawPath: string): Promise<string> {
    const data = await request(`/agent-config-files/read?path=${encodeURIComponent(rawPath)}`)
    if (!isRecord(data) || typeof data.content !== 'string') {
      throw new DashboardApiError('服务端返回的文件内容格式无效', null)
    }
    return data.content
  },
  async testAgentSshConnection(input: {
    readonly ssh_config: AgentSshConfig
    readonly path: string
    readonly target_os: AgentTargetOS
  }): Promise<{
    readonly connect: AgentSshProbeResult
    readonly read: AgentSshProbeResult
    readonly write: AgentSshProbeResult
  }> {
    const data = await request('/agent-config-files/test-ssh', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的 SSH 测试结果格式无效', null)
    }
    return {
      connect: parseAgentSshProbeResult(data.connect),
      read: parseAgentSshProbeResult(data.read),
      write: parseAgentSshProbeResult(data.write),
    }
  },
  async readAgentConfigRemotePath(sshConfig: AgentSshConfig, path: string, target_os: AgentTargetOS): Promise<string> {
    const data = await request('/agent-config-files/read-remote', {
      method: 'POST',
      body: JSON.stringify({ ssh_config: sshConfig, path, target_os }),
    })
    if (!isRecord(data) || typeof data.content !== 'string') {
      throw new DashboardApiError('服务端返回的远程文件内容格式无效', null)
    }
    return data.content
  },
  async listAgentConfigFiles(params: AgentConfigListParams): Promise<{ readonly files: readonly AgentConfigFile[]; readonly total: number }> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    const body = await requestFull(`/agent-config-files?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的接管配置列表格式无效', null)
    }
    return {
      files: data.map(parseAgentConfigFile),
      total: readNumber(body.total, 'total', 0),
    }
  },
  async createAgentConfigFile(input: AgentConfigFileInput): Promise<AgentConfigFile> {
    return parseAgentConfigFile(await request('/agent-config-files', {
      method: 'POST',
      body: JSON.stringify(input),
    }))
  },
  async getAgentConfigFileContent(id: string): Promise<string> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/content`)
    if (!isRecord(data) || typeof data.content !== 'string') {
      throw new DashboardApiError('服务端返回的文件内容格式无效', null)
    }
    return data.content
  },
  async saveAgentConfigFileContent(id: string, content: string): Promise<void> {
    await request(`/agent-config-files/${encodeURIComponent(id)}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  },
  async updateAgentConfigFile(id: string, input: AgentConfigFileInput): Promise<AgentConfigFile> {
    return parseAgentConfigFile(await request(`/agent-config-files/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }))
  },
  async deleteAgentConfigFile(id: string): Promise<void> {
    await request(`/agent-config-files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async getAgentConfigFileModels(id: string): Promise<AgentModelSummary> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/models`)
    return parseAgentModelSummary(data)
  },
  async applyAgentRecommendations(
    id: string,
    input: { readonly provider_id: string; readonly model_id?: string },
  ): Promise<{ readonly applied: number; readonly content: string }> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/apply-recommendations`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的套用结果格式无效', null)
    }
    return {
      applied: readNumber(data.applied, 'applied', 0),
      content: typeof data.content === 'string' ? data.content : '',
    }
  },
  async applyRecommendationTemplate(
    id: string,
  ): Promise<{
    readonly applied: number
    readonly content: string
    readonly providers: readonly {
      readonly provider_id: string
      readonly count: number
      readonly models: Readonly<Record<string, number>>
    }[]
  }> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/apply-recommendation-template`, {
      method: 'POST',
    })
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的套用结果格式无效', null)
    }
    const providers = Array.isArray(data.providers) ? data.providers : []
    return {
      applied: readNumber(data.applied, 'applied', 0),
      content: typeof data.content === 'string' ? data.content : '',
      providers: providers.map((raw) => {
        if (!isRecord(raw)) return { provider_id: '', count: 0, models: {} }
        const rawModels = isRecord(raw.models) ? raw.models : {}
        const models: Record<string, number> = {}
        for (const k of Object.keys(rawModels)) {
          const v = rawModels[k]
          models[k] = typeof v === 'number' ? v : Number(v) || 0
        }
        return {
          provider_id: typeof raw.provider_id === 'string' ? raw.provider_id : '',
          count: readNumber(raw.count, 'count', 0),
          models,
        }
      }),
    }
  },
  async applyRecommendationConfig(
    id: string,
    checked: Record<string, readonly string[]>,
    modelFields: Record<string, Record<string, Record<string, unknown>>>,
  ): Promise<{ readonly applied: number; readonly content: string }> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/apply-recommendation-config`, {
      method: 'POST',
      body: JSON.stringify({ checked, model_fields: modelFields }),
    })
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的套用结果格式无效', null)
    }
    return {
      applied: readNumber(data.applied, 'applied', 0),
      content: typeof data.content === 'string' ? data.content : '',
    }
  },
  async syncAgentConfigFileModelFields(
    id: string,
    input: {
      readonly provider_id: string
      readonly model_id: string
      readonly fields: Readonly<Record<string, unknown>>
    },
  ): Promise<{ readonly applied: number; readonly content: string }> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/sync-model-fields`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的同步结果格式无效', null)
    }
    return {
      applied: readNumber(data.applied, 'applied', 0),
      content: typeof data.content === 'string' ? data.content : '',
    }
  },
  async getAgentModelConfigSources(id: string): Promise<AgentModelConfigSources> {
    const data = await requestFull(`/agent-config-files/${encodeURIComponent(id)}/model-config-sources`)
    if (!isRecord(data.data)) {
      throw new DashboardApiError('服务端返回的模型配置参考供应商格式无效', null)
    }
    const out: Record<string, Record<string, AgentModelConfigSource>> = {}
    for (const [providerId, rawModels] of Object.entries(data.data as Record<string, unknown>)) {
      if (!isRecord(rawModels)) continue
      for (const [modelId, rawSource] of Object.entries(rawModels as Record<string, unknown>)) {
        if (!isRecord(rawSource)) continue
        const mode = rawSource.mode === 'self' || rawSource.mode === 'link' ? rawSource.mode : 'none'
        out[providerId] = out[providerId] ?? {}
        out[providerId][modelId] = {
          mode,
          self_supplier: typeof rawSource.self_supplier === 'string' ? rawSource.self_supplier : '',
          link_provider_id: typeof rawSource.link_provider_id === 'string' ? rawSource.link_provider_id : '',
        }
      }
    }
    return out
  },
  async saveAgentModelConfigSources(id: string, sources: AgentModelConfigSources): Promise<void> {
    await request(`/agent-config-files/${encodeURIComponent(id)}/model-config-sources`, {
      method: 'PUT',
      body: JSON.stringify({ sources }),
    })
  },
  async listManagedProviderOptions(): Promise<{ readonly options: readonly ManagedProviderOption[]; readonly systemBaseUrl: string }> {
    const body = await requestFull('/agent-config-files/managed-options')
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的供应商选项格式无效', null)
    }
    const systemBaseUrl = typeof body.system_base_url === 'string' ? body.system_base_url : ''
    return {
      systemBaseUrl,
      options: data.map((raw) => {
        if (!isRecord(raw)) {
          return { id: '', name: '', status: true, endpoints: [], models: [], model_endpoints: {}, endpointCount: 0, modelCount: 0 }
        }
        const eps = Array.isArray(raw.endpoints) ? raw.endpoints : []
        const mods = Array.isArray(raw.models) ? raw.models : []
        const modelEndpoints: Record<string, readonly string[]> = {}
        if (isRecord(raw.model_endpoints)) {
          for (const [name, list] of Object.entries(raw.model_endpoints as Record<string, unknown>)) {
            modelEndpoints[name] = Array.isArray(list)
              ? list.filter((e): e is string => typeof e === 'string')
              : []
          }
        }
        return {
          id: typeof raw.id === 'string' ? raw.id : '',
          name: typeof raw.name === 'string' ? raw.name : '',
          status: typeof raw.status === 'boolean' ? raw.status : true,
          endpoints: eps.filter((e): e is string => typeof e === 'string'),
          models: mods.filter((m): m is string => typeof m === 'string'),
          model_endpoints: modelEndpoints,
          endpointCount: readNumber(raw.endpoint_count, 'endpoint_count', 0),
          modelCount: readNumber(raw.model_count, 'model_count', 0),
        }
      }),
    }
  },
  async listManagedProviders(id: string): Promise<readonly ManagedProviderView[]> {
    const data = await request(`/agent-config-files/${encodeURIComponent(id)}/managed-providers`)
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的托管 provider 列表格式无效', null)
    }
    return data.map((raw) => {
      if (!isRecord(raw)) {
        return { id: '', name: '', provider_ids: [], stale_provider_ids: [], groups: [], hidden_groups: [], pending_sync: false, pending_fields: 0, api_key: '', base_url: '', source_name: '' }
      }
      const groups = Array.isArray(raw.groups) ? raw.groups : []
      const hidden = Array.isArray(raw.hidden_groups) ? raw.hidden_groups : []
      return {
        id: typeof raw.id === 'string' ? raw.id : '',
        name: typeof raw.name === 'string' ? raw.name : '',
        provider_ids: Array.isArray(raw.provider_ids)
          ? raw.provider_ids.filter((x): x is string => typeof x === 'string')
          : [],
        stale_provider_ids: Array.isArray(raw.stale_provider_ids)
          ? raw.stale_provider_ids.filter((x): x is string => typeof x === 'string')
          : [],
        groups: groups.map((g) => {
          const gr = isRecord(g) ? g : {}
          const modelNames = Array.isArray(gr.model_names) ? gr.model_names : []
          return {
            endpoint: typeof gr.endpoint === 'string' ? gr.endpoint : '',
            suffix: typeof gr.suffix === 'string' ? gr.suffix : '',
            provider_names: Array.isArray(gr.provider_names)
              ? gr.provider_names.filter((x): x is string => typeof x === 'string')
              : [],
            provider_ids: Array.isArray(gr.provider_ids)
              ? gr.provider_ids.filter((x): x is string => typeof x === 'string')
              : [],
            model_count: readNumber(gr.model_count, 'model_count', 0),
            model_names: modelNames.filter((x): x is string => typeof x === 'string'),
            model_sources: toStrMap(gr.model_sources),
            generated: isRecord(gr.generated) ? gr.generated : {},
            file_provider: isRecord(gr.file_provider) ? gr.file_provider : null,
            pending: gr.pending === true,
            pending_fields: readNumber(gr.pending_fields, 'pending_fields', 0),
          }
        }),
        hidden_groups: hidden.map((h) => {
          const hg = isRecord(h) ? h : {}
          return {
            endpoint: typeof hg.endpoint === 'string' ? hg.endpoint : '',
            suffix: typeof hg.suffix === 'string' ? hg.suffix : '',
            model_sources: toStrMap(hg.model_sources),
          }
        }),
        pending_sync: raw.pending_sync === true,
        pending_fields: readNumber(raw.pending_fields, 'pending_fields', 0),
        api_key: typeof raw.api_key === 'string' ? raw.api_key : '',
        base_url: typeof raw.base_url === 'string' ? raw.base_url : '',
        source_name: typeof raw.source_name === 'string' ? raw.source_name : '',
      }
    })
  },
  async createManagedProvider(id: string, input: ManagedProviderInput): Promise<void> {
    await request(`/agent-config-files/${encodeURIComponent(id)}/managed-providers`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async updateManagedProvider(id: string, mid: string, input: ManagedProviderInput): Promise<void> {
    await request(
      `/agent-config-files/${encodeURIComponent(id)}/managed-providers/${encodeURIComponent(mid)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    )
  },
  async deleteManagedProvider(id: string, mid: string): Promise<void> {
    await request(
      `/agent-config-files/${encodeURIComponent(id)}/managed-providers/${encodeURIComponent(mid)}`,
      { method: 'DELETE' },
    )
  },
  async syncManagedProvider(
    id: string,
    mid: string,
  ): Promise<{ readonly synced: number; readonly content: string }> {
    const data = await request(
      `/agent-config-files/${encodeURIComponent(id)}/managed-providers/${encodeURIComponent(mid)}/sync`,
      { method: 'POST' },
    )
    if (!isRecord(data)) {
      throw new DashboardApiError('服务端返回的同步结果格式无效', null)
    }
    return {
      synced: readNumber(data.synced, 'synced', 0),
      content: typeof data.content === 'string' ? data.content : '',
    }
  },
}
