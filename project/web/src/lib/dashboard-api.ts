const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

type JsonRecord = Record<string, unknown>

export type ProviderEndpoint = {
  readonly name: string
  readonly pathSuffix: string
}

export type ProviderModel = {
  readonly model: string
  readonly endpoints: readonly string[]
  readonly discount?: number
}

export type Provider = {
  readonly id: string
  readonly name: string
  readonly baseUrls: readonly string[]
  readonly keys: readonly string[]
  readonly endpoints: readonly ProviderEndpoint[]
  readonly models: readonly ProviderModel[]
  readonly status: boolean
  readonly weight: number
}

export type ProviderInput = Omit<Provider, 'id'>

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

export type UsageLog = {
  readonly id: string
  readonly createdAt: string
  readonly userId: string
  readonly tokenName: string
  readonly channelName: string
  readonly modelName: string
  readonly promptTokens: number
  readonly completionTokens: number
  readonly isStream: boolean
  readonly quota: number
  readonly useTime: number
  readonly status: 'success' | 'failed'
}

export type LogListParams = {
  readonly model?: string
  readonly status?: string
  readonly token?: string
  readonly limit: number
  readonly offset: number
}

export type LogListResult = {
  readonly logs: readonly UsageLog[]
  readonly total: number
}

export type PriceConfig = {
  readonly id: string
  readonly model: string
  readonly inputPrice: number
  readonly outputPrice: number
  readonly cacheWritePrice: number
  readonly cacheReadPrice: number
}

export type PriceConfigInput = {
  readonly model: string
  readonly inputPrice: number
  readonly outputPrice: number
  readonly cacheWritePrice: number
  readonly cacheReadPrice: number
}

export class DashboardApiError extends Error {
  readonly name = 'DashboardApiError'
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
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

function parsePrice(value: unknown): PriceConfig {
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
  }
}

function serializePrice(input: PriceConfigInput): JsonRecord {
  return {
    model: input.model,
    input_price: input.inputPrice,
    output_price: input.outputPrice,
    cache_write_price: input.cacheWritePrice,
    cache_read_price: input.cacheReadPrice,
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
    name: readString(value.name, 'endpoints.name'),
    pathSuffix: readString(value.pathSuffix ?? value.path_suffix, 'endpoints.path_suffix'),
  }
}

function parseModel(value: unknown): ProviderModel {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的 models 格式无效', null)
  }
  const discount = value.discount
  return {
    model: readString(value.model, 'models.model'),
    endpoints: readStringArray(value.endpoints ?? [], 'models.endpoints'),
    ...(typeof discount === 'number' && Number.isFinite(discount) ? { discount } : {}),
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

function parseProvider(value: unknown): Provider {
  if (!isRecord(value)) {
    throw new DashboardApiError('服务端返回的渠道格式无效', null)
  }
  return {
    id: readString(value.id, 'channel.id'),
    name: readString(value.name, 'channel.name'),
    baseUrls: readStringArray(value.base_urls, 'base_urls'),
    keys: readStringArray(value.keys, 'keys'),
    endpoints: readObjectArray(value.endpoints, 'endpoints', parseEndpoint),
    models: readObjectArray(value.models, 'models', parseModel),
    status: readBoolean(value.status, 'channel.status'),
    weight: readNumber(value.weight, 'channel.weight', 1),
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
    channelName: readString(value.channel_name, 'log.channel_name'),
    modelName: readString(value.model_name, 'log.model_name'),
    promptTokens: readNumber(value.prompt_tokens, 'log.prompt_tokens'),
    completionTokens: readNumber(value.completion_tokens, 'log.completion_tokens'),
    isStream: readBoolean(value.is_stream, 'log.is_stream'),
    quota: readNumber(value.quota, 'log.quota'),
    useTime: readNumber(value.use_time, 'log.use_time'),
    status,
  }
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
    throw new DashboardApiError(message, response.status)
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
    throw new DashboardApiError(message, response.status)
  }
  if (!isRecord(body)) {
    throw new DashboardApiError('服务端返回格式无效', null)
  }
  if ('error' in body && typeof body.error === 'string') {
    throw new DashboardApiError(body.error, null)
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
    weight: provider.weight,
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
  readonly primaryChannel: string
  readonly fallbackChannel: string
  readonly condition: 'timeout' | 'error' | 'rate_limit'
  readonly status: boolean
}

export type ResponseRewriteRule = {
  readonly id: string
  readonly name: string
  readonly script: string
  readonly status: boolean
}

export type RuleType = 'rewrite' | 'heartbeat' | 'concurrency' | 'failover' | 'rewrite-response'

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
  return {
    id: readString(value.id, 'rule.id'),
    name: readString(value.name, 'rule.name'),
    primaryChannel: readString(value.primary_channel, 'rule.primary_channel'),
    fallbackChannel: readString(value.fallback_channel, 'rule.fallback_channel'),
    condition,
    status: readBoolean(value.status, 'rule.status'),
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
  primary_channel: (rule as FailoverRule).primaryChannel ?? '',
  fallback_channel: (rule as FailoverRule).fallbackChannel ?? '',
  condition: (rule as FailoverRule).condition ?? 'timeout',
  status: rule.status,
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

export const dashboardApi = {
  // ── Providers ──
  async listProviders(): Promise<readonly Provider[]> {
    const data = await request('/channels')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的渠道列表格式无效', null)
    }
    return data.map(parseProvider)
  },
  async createProvider(provider: ProviderInput): Promise<Provider> {
    return parseProvider(await request('/channels', { method: 'POST', body: JSON.stringify(serializeProvider(provider)) }))
  },
  async updateProvider(id: string, provider: ProviderInput): Promise<Provider> {
    return parseProvider(await request(`/channels/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ id, ...serializeProvider(provider) }) }))
  },
  async deleteProvider(id: string): Promise<void> {
    await request(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async toggleProvider(id: string): Promise<Provider> {
    return parseProvider(await request(`/channels/${encodeURIComponent(id)}/toggle`, { method: 'POST' }))
  },

  // ── Tokens ──
  async listTokens(): Promise<readonly Token[]> {
    const data = await request('/tokens')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的令牌列表格式无效', null)
    }
    return data.map(parseToken)
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

  // ── Rules ──
  async listRules<T>(type: RuleType): Promise<readonly T[]> {
    const data = await request(`/rules/${encodeURIComponent(type)}`)
    if (!Array.isArray(data)) throw new DashboardApiError('服务端返回的规则列表格式无效', null)
    return data.map(ruleParserForType(type)) as readonly T[]
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

  async currentUser(): Promise<{ readonly id: string; readonly username: string; readonly role: string }> {
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

  async listPrices(): Promise<readonly PriceConfig[]> {
    const data = await request('/prices')
    if (!Array.isArray(data)) {
      throw new DashboardApiError('服务端返回的价格列表格式无效', null)
    }
    return data.map(parsePrice)
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
    return parsePrice(await request('/prices', { method: 'POST', body: JSON.stringify(serializePrice(input)) }))
  },
  async updatePrice(id: string, input: PriceConfigInput): Promise<PriceConfig> {
    return parsePrice(await request(`/prices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(serializePrice(input)),
    }))
  },
  async deletePrice(id: string): Promise<void> {
    await request(`/prices/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
