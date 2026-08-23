import { parseTopologyDocument } from './topology-document'
import type { Workflow } from './topology-document'
import type { SlotEntry } from '@/components/topology/slot-items'
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

export type ProviderModel = {
  readonly model: string
  readonly endpoints: readonly string[]
  readonly rate: string
  readonly prices: ModelPrices | null
}

export type Provider = {
  readonly id: string
  readonly name: string
  readonly baseUrls: readonly string[]
  readonly keys: readonly string[]
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
  readonly status: 'success' | 'failed'
  readonly errorMessage: string
  readonly upstreamUrl: string
}

export type LogListParams = {
  readonly model?: string
  readonly status?: string
  readonly token?: string
  readonly from?: string
  readonly to?: string
  readonly limit: number
  readonly offset: number
}

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
  readonly models: readonly ModelStat[]
}

export type ActiveRequest = {
  readonly requestId: string
  readonly model: string
  readonly tokenName: string
  readonly userId: string
  readonly provider: string
  readonly source: string
  readonly stream: boolean
  readonly startTime: string
  readonly elapsedMs: number
  readonly endTime: string | null
  readonly outcome: string
  readonly stage: string
  readonly chunkCount: number
  readonly bytesReceived: number
  readonly pathNodeIds: readonly string[]
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

export type PriceRule = {
  readonly pattern: string
  readonly multiplier: number
}

export type FetchedModel = {
  readonly id: string
  readonly name: string
}

export type PriceConfig = {
  readonly id: string
  readonly model: string
  readonly inputPrice: number
  readonly outputPrice: number
  readonly cacheWritePrice: number
  readonly cacheReadPrice: number
  readonly contextLength: number
  readonly maxToken: number
  readonly supportedTypes: readonly string[]
  readonly aliases: readonly string[]
  readonly endpoints: readonly string[]
  readonly thinkingLevels: readonly string[]
  readonly rate: readonly PriceRule[]
}

export type PriceConfigInput = Omit<PriceConfig, 'id'>

export type PriceListParams = {
  readonly limit: number
  readonly offset: number
}

export type CurrentUser = {
  readonly id: string
  readonly username: string
  readonly role: string
}

// ── Flat topology (canvas node/wire model) ──
export type FlatNodeKind = 'requestEntry' | 'provider' | 'slot'

export type ProviderStrategy = 'sequential' | 'random' | 'roundRobin'

export type FlatNode = {
  readonly id: string
  readonly kind: FlatNodeKind
  readonly name?: string
  readonly providerId?: string
  readonly slotType?: string
  readonly enabled: boolean
  readonly weight?: number
  readonly entries?: readonly SlotEntry[]
  readonly logDeadlineAt?: number | null
  readonly strategy?: ProviderStrategy
}

export type FlatWire = {
  readonly source: string
  readonly target: string
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
  if (kind !== 'requestEntry' && kind !== 'provider' && kind !== 'slot') {
    throw new DashboardApiError('扁平拓扑节点类型无效', null)
  }
  return {
    id: readString(value.id, 'node.id'),
    kind,
    name: typeof value.name === 'string' ? value.name : undefined,
    providerId: typeof value.provider_id === 'string' ? value.provider_id : undefined,
    slotType: typeof value.slot_type === 'string' ? value.slot_type : undefined,
    enabled: value.enabled === undefined ? true : readBoolean(value.enabled, 'node.enabled'),
    weight: typeof value.weight === 'number' ? value.weight : undefined,
    entries: readObjectArray(value.entries, 'node.entries', (x) => x as SlotEntry),
    logDeadlineAt: typeof value.log_deadline_at === 'number' ? value.log_deadline_at : null,
    strategy: isProviderStrategy(value.strategy) ? value.strategy : undefined,
  }
}

function isProviderStrategy(value: unknown): value is ProviderStrategy {
  return value === 'sequential' || value === 'random' || value === 'roundRobin'
}

function parseFlatWire(value: unknown): FlatWire {
  if (!isRecord(value)) throw new DashboardApiError('扁平拓扑连线格式无效', null)
  return { source: readString(value.source, 'wire.source'), target: readString(value.target, 'wire.target') }
}

function parseFlatTopology(value: unknown): FlatTopology {
  if (!isRecord(value)) throw new DashboardApiError('扁平拓扑格式无效', null)
  return {
    nodes: readObjectArray(value.nodes, 'flat.nodes', parseFlatNode),
    wires: readObjectArray(value.wires, 'flat.wires', parseFlatWire),
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
    ...(node.entries !== undefined ? { entries: node.entries } : {}),
    ...(node.logDeadlineAt !== undefined ? { log_deadline_at: node.logDeadlineAt } : {}),
    ...(node.strategy !== undefined ? { strategy: node.strategy } : {}),
  }
}

function serializeFlatTopology(tp: FlatTopology): JsonRecord {
  return {
    nodes: tp.nodes.map(serializeFlatNode),
    wires: tp.wires.map((wire) => ({ source: wire.source, target: wire.target })),
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
export type ChannelAffinityKeySource =
  | { readonly type: 'request_header'; readonly key: string }
  | { readonly type: 'gjson'; readonly path: string }

export type ChannelAffinityRule = {
  readonly name: string
  readonly enabled: boolean
  readonly modelRegex: readonly string[]
  readonly pathRegex: readonly string[]
  readonly keySources: readonly ChannelAffinityKeySource[]
  readonly includeModelName: boolean
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

export function parsePrice(value: unknown): PriceConfig {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的价格格式无效', null)
  }
  return {
    id: readString(value.id, 'price.id'),
    model: readString(value.model, 'price.model'),
    inputPrice: readNumber(value.input_price, 'price.input_price', 0),
    outputPrice: readNumber(value.output_price, 'price.output_price', 0),
    cacheWritePrice: readNumber(value.cache_write_price, 'price.cache_write_price', 0),
    cacheReadPrice: readNumber(value.cache_read_price, 'price.cache_read_price', 0),
    contextLength: readNumber(value.context_length, 'price.context_length', 0),
    maxToken: readNumber(value.max_token, 'price.max_token', 0),
    supportedTypes: readStringArray(value.supported_types, 'price.supported_types'),
    aliases: readStringArray(value.aliases, 'price.aliases'),
    endpoints: readStringArray(value.endpoints, 'price.endpoints'),
    thinkingLevels: readStringArray(value.thinking_levels, 'price.thinking_levels'),
    rate: readObjectArray(value.rate, 'price.rate', parsePriceRule),
  }
}

function parsePriceRule(value: unknown): PriceRule {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 price.rate 格式无效', null)
  }
  return {
    pattern: readString(value.pattern, 'price.rate.pattern'),
    multiplier: readNumber(value.multiplier, 'price.rate.multiplier'),
  }
}

export function serializePrice(input: PriceConfigInput): JsonRecord {
  return {
    model: input.model,
    input_price: input.inputPrice,
    output_price: input.outputPrice,
    cache_write_price: input.cacheWritePrice,
    cache_read_price: input.cacheReadPrice,
    context_length: input.contextLength,
    max_token: input.maxToken,
    supported_types: JSON.stringify(input.supportedTypes),
    aliases: JSON.stringify(input.aliases),
    endpoints: JSON.stringify(input.endpoints),
    thinking_levels: JSON.stringify(input.thinkingLevels),
    rate: JSON.stringify(input.rate),
  }
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

function parseKeySource(value: unknown): ChannelAffinityKeySource {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 key source 格式无效', null)
  }
  const type = readString(value.type, 'key_source.type')
  if (type === 'request_header') {
    return { type: 'request_header', key: readString(value.key, 'key_source.key') }
  }
  if (type === 'gjson') {
    return { type: 'gjson', path: readString(value.path, 'key_source.path') }
  }
  throw new DashboardApiError(`服务端返回的 key source 类型无效: ${type}`, null)
}

function parseChannelAffinityRule(value: unknown): ChannelAffinityRule {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的亲和规则格式无效', null)
  }
  return {
    name: readString(value.name, 'affinity_rule.name'),
    enabled: readBoolean(value.enabled, 'affinity_rule.enabled'),
    modelRegex: readStringArray(value.model_regex, 'affinity_rule.model_regex'),
    pathRegex: readStringArray(value.path_regex, 'affinity_rule.path_regex'),
    keySources: readObjectArray(value.key_sources, 'affinity_rule.key_sources', parseKeySource),
    includeModelName: readBoolean(value.include_model_name, 'affinity_rule.include_model_name'),
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
      model_regex: rule.modelRegex,
      path_regex: rule.pathRegex,
      key_sources: rule.keySources,
      include_model_name: rule.includeModelName,
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
    endpoints: readObjectArray(value.endpoints, 'endpoints', parseEndpoint),
    models: readObjectArray(value.models, 'models', parseModel),
    status: readBoolean(value.status, 'provider.status'),
    autoDisabled: readBoolean(value.auto_disabled, 'provider.auto_disabled'),
    workflowEnabled: readBoolean(value.workflow_enabled, 'provider.workflow_enabled'),
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
    throw new DashboardApiError('服务端返回的自动禁用状态格式无效', null)
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
  if (status !== 'success' && status !== 'failed') {
    throw new DashboardApiError(`无效的日志状态: ${status}`, null)
  }
  return {
    id: readString(value.id, 'log.id'),
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
    upstreamUrl: readString(value.upstream_url ?? '', 'log.upstream_url'),
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
    source: readString(value.source ?? '', 'active.source'),
    startTime: readString(value.start_time, 'active.start_time'),
    stream: readBoolean(value.stream, 'active.stream'),
    elapsedMs: readNumber(value.elapsed_ms, 'active.elapsed_ms'),
    endTime: value.end_time == null || value.end_time === '' ? null : readString(value.end_time, 'active.end_time'),
    outcome: readString(value.outcome ?? '', 'active.outcome'),
    stage: readString(value.stage ?? '', 'active.stage'),
    chunkCount: readNumber(value.chunk_count ?? 0, 'active.chunk_count'),
    bytesReceived: readNumber(value.bytes_received ?? 0, 'active.bytes_received'),
    pathNodeIds: readStringArray(value.path_node_ids ?? [], 'active.path_node_ids'),
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

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/v1/dashboard${path}`, {
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
    response = await fetch(`${apiBaseUrl}/v1/dashboard${path}`, {
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
    response = await fetch(`${apiBaseUrl}/v1/dashboard${path}`, {
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
    throw new DashboardApiError(message, response.status)
  }
  return body
}

function serializeProvider(provider: ProviderInput): JsonRecord {
  return {
    name: provider.name,
    base_urls: JSON.stringify(provider.baseUrls),
    keys: JSON.stringify(provider.keys),
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

export type HeartbeatRule = {
  readonly id: string
  readonly name: string
  readonly matchCondition: string
  readonly replyContent: string
  readonly timeout: number
  readonly status: boolean
}

export type ConcurrencyRule = {
  readonly id: string
  readonly name: string
  readonly scope: 'global' | 'per_user' | 'per_token'
  readonly maxConcurrent: number
  readonly queueEnabled: boolean
  readonly status: boolean
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
  readonly retryCount: number
  readonly autoDisable: boolean
  readonly matchPatterns: readonly string[]
  readonly ttfbSeconds: number
}

export type FailoverAction = {
  readonly dimension: 'base_url' | 'key' | 'provider'
  readonly retryCount: number
  readonly automaticPolling: boolean
  readonly autoDisable: boolean
}

export type ResponseRewriteRule = {
  readonly id: string
  readonly name: string
  readonly script: string
  readonly status: boolean
}

export type RuleType = 'rewrite' | 'heartbeat' | 'concurrency' | 'failover' | 'rewrite-response'

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

function parseHeartbeatRule(value: unknown): HeartbeatRule {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的规则格式无效', null)
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    matchCondition: readString(value.match_condition, 'rule.match_condition'),
    replyContent: readString(value.reply_content, 'rule.reply_content'),
    timeout: readNumber(value.timeout, 'rule.timeout', 30),
    status: readBoolean(value.status, 'rule.status'),
  }
}

function parseConcurrencyRule(value: unknown): ConcurrencyRule {
  if (!isRecord(value)) throw new DashboardApiError('服务端返回的规则格式无效', null)
  const rawScope = readString(value.scope, 'rule.scope')
  const scope = rawScope === 'global' || rawScope === 'per_user' || rawScope === 'per_token' ? rawScope : 'global'
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    scope,
    maxConcurrent: readNumber(value.max_concurrent, 'rule.max_concurrent', 10),
    queueEnabled: readBoolean(value.queue_enabled, 'rule.queue_enabled'),
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
    retryCount: readNumber(value.retry_count, 'rule.retry_count', 3),
    autoDisable: readBoolean(value.auto_disable, 'rule.auto_disable'),
    matchPatterns: readStringArray(value.match_patterns, 'rule.match_patterns'),
    ttfbSeconds: readNumber(value.ttfb_seconds, 'rule.ttfb_seconds', 0),
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
    retryCount: readNumber(value.retry_count, 'rule.actions.retry_count', 3),
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

const serializeHeartbeatRule: RuleSerializer<HeartbeatRule> = (rule) => ({
  name: rule.name,
  match_condition: (rule as HeartbeatRule).matchCondition ?? '*',
  reply_content: (rule as HeartbeatRule).replyContent ?? '',
  timeout: (rule as HeartbeatRule).timeout ?? 30,
  status: rule.status,
})

const serializeConcurrencyRule: RuleSerializer<ConcurrencyRule> = (rule) => ({
  name: rule.name,
  scope: (rule as ConcurrencyRule).scope ?? 'global',
  max_concurrent: (rule as ConcurrencyRule).maxConcurrent ?? 10,
  queue_enabled: (rule as ConcurrencyRule).queueEnabled ?? true,
  status: rule.status,
})

const serializeFailoverRule: RuleSerializer<FailoverRule> = (rule) => ({
  name: rule.name,
  primary_provider: (rule as FailoverRule).primaryProvider ?? '',
  fallback_provider: (rule as FailoverRule).fallbackProvider ?? '',
  condition: (rule as FailoverRule).condition ?? 'timeout',
  status: rule.status,
  keywords: (rule as FailoverRule).keywords ?? [],
  actions: ((rule as FailoverRule).actions ?? []).map((action) => ({
    dimension: action.dimension,
    retry_count: action.retryCount,
    automatic_polling: action.automaticPolling,
    auto_disable: action.autoDisable,
  })) ?? [],
  dimension: (rule as FailoverRule).dimension ?? '',
  retry_count: (rule as FailoverRule).retryCount ?? 3,
  auto_disable: (rule as FailoverRule).autoDisable ?? true,
  match_patterns: (rule as FailoverRule).matchPatterns ?? [],
  ttfb_seconds: (rule as FailoverRule).ttfbSeconds ?? 0,
})

const serializeResponseRewriteRule: RuleSerializer<ResponseRewriteRule> = (rule) => ({
  name: rule.name,
  script: (rule as ResponseRewriteRule).script ?? '',
  status: rule.status,
})

function ruleParserForType(type: RuleType): (value: unknown) => unknown {
  switch (type) {
    case 'rewrite':           return parseRewriteRule
    case 'heartbeat':         return parseHeartbeatRule
    case 'concurrency':       return parseConcurrencyRule
    case 'failover':          return parseFailoverRule
    case 'rewrite-response':  return parseResponseRewriteRule
  }
}

function ruleSerializerForType(type: RuleType): RuleSerializer<unknown> {
  switch (type) {
    case 'rewrite':           return serializeRewriteRule as RuleSerializer<unknown>
    case 'heartbeat':         return serializeHeartbeatRule as RuleSerializer<unknown>
    case 'concurrency':       return serializeConcurrencyRule as RuleSerializer<unknown>
    case 'failover':          return serializeFailoverRule as RuleSerializer<unknown>
    case 'rewrite-response':  return serializeResponseRewriteRule as RuleSerializer<unknown>
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
      throw new DashboardApiError('服务端返回的自动禁用状态列表格式无效', null)
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
    if (params.status) qp.set('status', params.status)
    if (params.token) qp.set('token', params.token)
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
    from?: string
    to?: string
  }): Promise<number> {
    const body = await requestFull('/log-capture/clear', {
      method: 'POST',
      body: JSON.stringify({
        scope: input.scope,
        ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
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

  async listPrices(params: PriceListParams): Promise<{ readonly prices: readonly PriceConfig[]; readonly total: number }> {
    const qp = new URLSearchParams()
    qp.set('limit', String(params.limit))
    qp.set('offset', String(params.offset))
    const body = await requestFull(`/models?${qp.toString()}`)
    const data = body.data
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的模型列表格式无效', null)
    }
    return {
      prices: data.map(parsePrice),
      total: readNumber(body.total, 'total', 0),
    }
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
  async createPrice(input: PriceConfigInput): Promise<PriceConfig> {
    return parsePrice(await request('/models', { method: 'POST', body: JSON.stringify(serializePrice(input)) }))
  },
  async updatePrice(id: string, input: PriceConfigInput): Promise<PriceConfig> {
    return parsePrice(await request(`/models/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(serializePrice(input)),
    }))
  },
  async deletePrice(id: string): Promise<void> {
    await request(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
}
