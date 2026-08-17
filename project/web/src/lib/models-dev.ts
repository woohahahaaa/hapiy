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
    .sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id))
    .slice(0, limit)
    .map((entry) => entry.model)
}