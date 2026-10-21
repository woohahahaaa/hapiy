import { i18n } from '@/i18n/i18n'

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
  /** 该模型支持的思考档位枚举（models.dev reasoning_options 的 effort 项），如 high/medium/xhigh */
  readonly effortLevels: readonly string[]
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
    throw new Error(i18n.t('lib:modelsDev.invalidFormat'))
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
    effortLevels: readStringArray(value.effort_levels),
  }
}

export async function loadModelsDevModels(): Promise<readonly ModelsDevModel[]> {
  if (cached) return cached
  if (!loadPromise) {
    loadPromise = fetch(API_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(i18n.t('lib:modelsDev.requestFailed', { status: response.status }))
        const body = (await response.json()) as unknown
        if (!isRecord(body)) throw new Error(i18n.t('lib:modelsDev.invalidFormat'))
        const data = body.data
        if (!Array.isArray(data)) throw new Error(i18n.t('lib:modelsDev.invalidFormat'))
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

// normalizeModelKey 去掉连字符与空白（统一小写）后的模型名，用于宽松匹配。
// 用户侧可能输入 "GLM5.3"、"Kimi K3"、"deepseek v3 flash" 等变体，而
// models.dev 发布为 "glm-5.3" / "Kimi K3" / "deepseek-v3-flash"——去掉
// 连字符/空格后两者一致，供应商页面与接管 agent 都从这里受益。
function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]/g, '')
}

// normalizeProviderKey 是供应商名的宽松归一化：去掉空格、括号、连字符、
// 点号等所有非字母数字字符，只保留 Unicode 字母与数字，并统一小写。
// 例：OpenCode Go / opencode go / opencodego / opencode(go) 都变成
// "opencodego"；中文供应商名保留汉字，不会退化成空串。
export function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
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
  // 归一化兜底：去掉连字符/空格后的匹配（如 "glm53" ↔ "glm-5.3"）。
  const nid = normalizeModelKey(id)
  const nname = normalizeModelKey(name)
  const nprovider = normalizeModelKey(provider)
  const nneedle = normalizeModelKey(needle)
  if (nid === nneedle || nname === nneedle) return 6
  if (nid.includes(nneedle) || nname.includes(nneedle)) return 7
  if (nprovider.includes(nneedle)) return 8
  return -1
}

// isVersionSuffixMatch reports whether the longer value is the shorter one
// plus a pure numeric version/date suffix. This bridges official renames like
// "deepseek-v4.1-flash" (user) ↔ "DeepSeek V4.1 Flash 1017" (models.dev)
// without matching different tiers such as "gpt-4o" ↔ "gpt-4o-mini" or
// "deepseek-v4-flash" ↔ "deepseek-v4-flash-vision-exp" (letter suffix).
function isVersionSuffixMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (!longer.startsWith(shorter)) return false
  return /^\d+$/.test(longer.slice(shorter.length))
}

// Models.dev publishes the same model under different id shapes: some
// providers use "provider/model", others the bare model id. A stored model
// name therefore matches both the exact id/name and a fully-qualified id
// whose trailing segment is the model name. 归一化（去连字符/空格）后同样
// 兜底匹配，见 normalizeModelKey；纯数字版本/日期后缀（如 1017、20241022）
// 也视为同一模型，避免官方改名后匹配不上。
function modelKeyMatches(id: string, name: string, needle: string): boolean {
  if (id === needle || name === needle) return true
  if (id.endsWith(`/${needle}`)) return true
  const nid = normalizeModelKey(id)
  const nname = normalizeModelKey(name)
  const nneedle = normalizeModelKey(needle)
  if (nid === nneedle || nname === nneedle) return true
  if (nid.endsWith(`/${nneedle}`)) return true
  return isVersionSuffixMatch(nid, nneedle) || isVersionSuffixMatch(nname, nneedle)
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
// normalize to lowercase before persisting. 连字符/空格变体（如 "GLM5.3"）
// 也会归一化后兜底匹配。
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
  if (qualified) return qualified
  const nneedle = normalizeModelKey(needle)
  if (nneedle) {
    const loose = models.find(
      (model) =>
        normalizeModelKey(model.id) === nneedle ||
        normalizeModelKey(model.name) === nneedle,
    )
    if (loose) return loose
    return models.find(
      (model) =>
        normalizeModelKey(model.id) !== nneedle &&
        normalizeModelKey(model.id).endsWith(`/${nneedle}`),
    ) ?? null
  }
  return null
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
  ['mimo', 'xiaomi'],
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

// First models.dev row matching (modelValue, supplier) for refilling prices.
// supplier 可以是 providerName（用户手动选择时存的）或 providerId（自动
// 推断官方厂商时 labProviderIdForModel 返回的是 provider_id）。两者都走
// normalizeProviderKey：括号/空格/连字符/点号全部忽略，只保留字母数字，
// 所以 "opencode go"、"opencodego"、"opencode(go)"、"OpenCode Go" 都能
// 命中同一条 models.dev 供应商记录。
export function findModelsDevProviderRow(
  models: readonly ModelsDevModel[],
  modelValue: string,
  supplier: string,
): ModelsDevModel | null {
  const needle = modelValue.trim().toLowerCase()
  if (!needle) return null
  const nsupplier = normalizeProviderKey(supplier)
  if (!nsupplier) return null
  const found = models.find((model) => {
    if (!modelKeyMatches(model.id.toLowerCase(), model.name.toLowerCase(), needle)) return false
    const providerName = normalizeProviderKey(model.providerName)
    const providerID = normalizeProviderKey(model.providerId)
    return (providerName !== '' && providerName === nsupplier)
      || (providerID !== '' && providerID === nsupplier)
  })
  return found ?? null
}

export type ModelsDevReferenceSource = 'own-provider' | 'official' | 'stored' | 'candidate'

export type ModelsDevReference = {
  readonly row: ModelsDevModel
  readonly supplier: string
  readonly source: ModelsDevReferenceSource
}

// resolveModelsDevReference is the single reference-picking rule used by the
// provider one-click price fill and every agent "apply recommendations" flow.
// Order:
//  1. the current provider's own models.dev row (gateway-specific prices);
//  2. the official lab inferred from the model name;
//  3. the previously stored/manual reference supplier;
//  4. the first candidate (official first, then provider name alphabetically,
//     because models.dev exposes no popularity rank).
// Names are compared through normalizeProviderKey, so punctuation and
// spacing differences never block a match.
export function resolveModelsDevReference(
  models: readonly ModelsDevModel[],
  modelValue: string,
  options: {
    readonly ownProviderNames?: readonly string[]
    readonly storedSupplier?: string | null
    readonly allowCandidateFallback?: boolean
  } = {},
): ModelsDevReference | null {
  const needle = modelValue.trim()
  if (!needle) return null
  const match = (supplier: string): ModelsDevModel | null => {
    if (!supplier.trim()) return null
    return findModelsDevProviderRow(models, needle, supplier)
  }

  for (const own of options.ownProviderNames ?? []) {
    const row = match(own)
    if (row) return { row, supplier: row.providerName, source: 'own-provider' }
  }

  const lab = labProviderIdForModel(needle)
  if (lab) {
    const row = match(lab)
    if (row) return { row, supplier: row.providerName, source: 'official' }
  }

  if (options.storedSupplier) {
    const row = match(options.storedSupplier)
    if (row) return { row, supplier: row.providerName, source: 'stored' }
  }

  if (options.allowCandidateFallback !== false) {
    const candidate = providersForModel(models, needle)[0]
    if (candidate) {
      const row = match(candidate.providerName)
      if (row) return { row, supplier: row.providerName, source: 'candidate' }
    }
  }
  return null
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