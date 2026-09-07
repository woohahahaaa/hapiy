export type ModelsDevModel = {
  readonly id: string
  readonly name: string
  readonly providerId: string
  readonly providerName: string
  readonly inputPrice: number
  readonly outputPrice: number
  readonly cacheWritePrice: number
  readonly cacheReadPrice: number
  readonly contextLength: number
  readonly maxOutput: number
  readonly inputTypes: readonly string[]
  readonly outputTypes: readonly string[]
  readonly reasoning: boolean
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const API_URL = `${apiBaseUrl}/v1/dashboard/models-dev`

let cached: readonly ModelsDevModel[] | null = null
let loadPromise: Promise<readonly ModelsDevModel[]> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function parseModel(value: unknown): ModelsDevModel {
  if (!isRecord(value)) {
    throw new Error('models.dev 数据格式无效')
  }
  return {
    id: readString(value.id),
    name: readString(value.name),
    providerId: readString(value.provider_id),
    providerName: readString(value.provider_name),
    inputPrice: readNumber(value.input_price),
    outputPrice: readNumber(value.output_price),
    cacheWritePrice: readNumber(value.cache_write_price),
    cacheReadPrice: readNumber(value.cache_read_price),
    contextLength: readNumber(value.context_length),
    maxOutput: readNumber(value.max_output),
    inputTypes: readStringArray(value.input_types),
    outputTypes: readStringArray(value.output_types),
    reasoning: value.reasoning === true,
  }
}

export async function loadModelsDevModels(): Promise<readonly ModelsDevModel[]> {
  if (cached) return cached
  if (!loadPromise) {
    loadPromise = fetch(API_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`models.dev 数据请求失败（${response.status}）`)
        const body = (await response.json()) as unknown
        if (!isRecord(body)) throw new Error('models.dev 数据格式无效')
        const data = body.data
        if (!Array.isArray(data)) throw new Error('models.dev 数据格式无效')
        return data.map(parseModel)
      })
      .then((models) => {
        cached = models
        return cached
      })
      .finally(() => {
        loadPromise = null
      })
  }
  return loadPromise
}

function scoreMatch(model: ModelsDevModel, needle: string): number {
  const id = model.id.toLowerCase()
  const name = model.name.toLowerCase()
  const provider = model.providerName.toLowerCase()
  if (id === needle) return 0
  if (id.startsWith(needle)) return 1
  if (id.includes(needle)) return 2
  if (name.startsWith(needle)) return 3
  if (name.includes(needle)) return 4
  if (provider.includes(needle)) return 5
  return -1
}

// Models.dev publishes the same model under different id shapes: some
// providers use "provider/model", others the bare model id. A stored model
// name therefore matches both the exact id/name and a fully-qualified id
// whose trailing segment is the model name.
function modelKeyMatches(id: string, name: string, needle: string): boolean {
  if (id === needle || name === needle) return true
  return id.endsWith(`/${needle}`)
}

export function searchModelsDevModels(
  models: readonly ModelsDevModel[],
  query: string,
  limit = 50,
): readonly ModelsDevModel[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return models
    .map((model) => ({ model, score: scoreMatch(model, needle) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score ||
      a.model.providerName.localeCompare(b.model.providerName, 'en') ||
      a.model.id.localeCompare(b.model.id, 'en'))
    .slice(0, limit)
    .map((entry) => entry.model)
}

// Trim + case-insensitive id/name match (falling back to a qualified
// provider/model id's bare trailing segment, see modelKeyMatches); null when
// nothing matches. The returned row's id keeps its snapshot casing — callers
// normalize to lowercase before persisting.
export function findModelsDevModel(
  models: readonly ModelsDevModel[],
  value: string,
): ModelsDevModel | null {
  const needle = value.trim().toLowerCase()
  if (!needle) return null
  const exact = models.find(
    (model) =>
      model.id.toLowerCase() === needle || model.name.toLowerCase() === needle,
  )
  if (exact) return exact
  const qualified = models.find(
    (model) =>
      model.id.toLowerCase() !== needle &&
      model.id.toLowerCase().endsWith(`/${needle}`),
  )
  return qualified ?? null
}

// Distinct providers of rows whose id/name equals the committed model value.
// 官方（lab，模型的第一方厂商）排在最前，其余按名称字母序。
export function providersForModel(
  models: readonly ModelsDevModel[],
  value: string,
): ReadonlyArray<{ readonly providerId: string; readonly providerName: string }> {
  const needle = value.trim().toLowerCase()
  if (!needle) return []
  const providers = new Map<string, string>()
  for (const model of models) {
    if (modelKeyMatches(model.id.toLowerCase(), model.name.toLowerCase(), needle)) {
      providers.set(model.providerId, model.providerName)
    }
  }
  const lab = labProviderIdForModel(value)
  return [...providers.entries()]
    .map(([providerId, providerName]) => ({ providerId, providerName }))
    .sort((a, b) =>
      a.providerId === lab ? -1 : b.providerId === lab ? 1 : a.providerName.localeCompare(b.providerName, 'en'),
    )
}

// LAB_PREFIX_RULES — 模型 id 前缀 → models.dev 第一方（lab）provider id。
// models.dev 平铺 provider→models 且无官方/权重字段，"官方源"用这张表
// 推断；注意 provider id 以实际 api.json 为准（如 moonshotai / zhipuai /
// volcengine / amazon-bedrock）。
const LAB_PREFIX_RULES: readonly (readonly [string, string])[] = [
  ['claude', 'anthropic'],
  ['gpt', 'openai'],
  ['chatgpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['gemini', 'google'],
  ['gemma', 'google'],
  ['deepseek', 'deepseek'],
  ['grok', 'xai'],
  ['kimi', 'moonshotai'],
  ['glm', 'zhipuai'],
  ['minimax', 'minimax'],
  ['qwen', 'alibaba'],
  ['llama', 'meta'],
  ['mistral', 'mistral'],
  ['codestral', 'mistral'],
  ['magistral', 'mistral'],
  ['ministral', 'mistral'],
  ['pixtral', 'mistral'],
  ['command', 'cohere'],
  ['aya', 'cohere'],
  ['doubao', 'volcengine'],
  ['nova', 'amazon-bedrock'],
]

// labProviderIdForModel 推断模型的第一方厂商 provider id；推断不出返回 null。
export function labProviderIdForModel(modelValue: string): string | null {
  const name = modelValue.trim().toLowerCase()
  if (!name) return null
  for (const [prefix, providerId] of LAB_PREFIX_RULES) {
    if (name.startsWith(prefix)) return providerId
  }
  return null
}

// isModelsDevLab 报告某 provider 是否为该模型的官方（lab）供应商。
export function isModelsDevLab(modelValue: string, providerId: string): boolean {
  return labProviderIdForModel(modelValue) === providerId
}

// First models.dev row matching (modelValue, providerName) for refilling prices.
export function findModelsDevProviderRow(
  models: readonly ModelsDevModel[],
  modelValue: string,
  providerName: string,
): ModelsDevModel | null {
  const needle = modelValue.trim().toLowerCase()
  if (!needle) return null
  const found = models.find(
    (model) =>
      modelKeyMatches(model.id.toLowerCase(), model.name.toLowerCase(), needle) &&
      model.providerName.toLowerCase() === providerName.toLowerCase(),
  )
  return found ?? null
}

// resetModelsDevCache drops the module-level snapshot so the next
// loadModelsDevModels() call re-fetches from upstream. Used by the
// per-model 刷新 action which must always check the live state of the
// reference supplier before overwriting the stored price snapshot.
export function resetModelsDevCache(): void {
  cached = null
  loadPromise = null
}

export async function refreshModelsDevModels(): Promise<readonly ModelsDevModel[]> {
  resetModelsDevCache()
  return loadModelsDevModels()
}