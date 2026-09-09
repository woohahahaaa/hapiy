import type {
  AgentModelInfoFieldPaths,
  AgentModelInfoFieldSpec,
  AgentModelInfoFieldSpecValue,
  ModelInfoFieldKey,
} from '@/lib/dashboard-api'
import { MODEL_INFO_FIELD_KEYS, MODEL_INFO_FIELD_LABELS } from '@/lib/dashboard-api'
import { findModelsDevProviderRow, type ModelsDevModel } from '@/lib/models-dev'

export interface ModelInfoFieldChange {
  readonly key: ModelInfoFieldKey
  readonly label: string
  readonly path: string
  readonly oldValue: unknown
  readonly newValue: unknown
  readonly field: AgentModelInfoFieldSpecValue
}

export function fieldValueAt(obj: unknown, path: string): unknown {
  if (!path || !obj || typeof obj !== 'object') return undefined
  const segs = path.split('.')
  let cur: unknown = obj
  for (const seg of segs) {
    if (!cur || typeof cur !== 'object') return undefined
    const next = (cur as Record<string, unknown>)[seg]
    if (next === undefined) return undefined
    cur = next
  }
  return cur
}

function filterValues(values: readonly string[] | undefined, raw: readonly unknown[]): readonly unknown[] {
  if (!values || values.length === 0) return raw
  const allowed = new Set(values.map((v) => v.trim().toLowerCase()))
  return raw.filter((item) => allowed.has(String(item).trim().toLowerCase()))
}

// filterValuesFor exposes filterValues for tests: drops elements not in
// the allowed whitelist (case-insensitive); empty whitelist passes all.
export function filterValuesFor(values: readonly string[] | undefined, raw: readonly unknown[]): readonly unknown[] {
  return filterValues(values, raw)
}

function applySpecOp(raw: unknown, spec: AgentModelInfoFieldSpec): unknown {
  switch (spec.op) {
    case 'bool': {
      if (raw === undefined || raw === null) return undefined
      return Array.isArray(raw) ? raw.length > 0 : Boolean(raw)
    }
    case 'first': {
      if (!Array.isArray(raw) || raw.length === 0) return undefined
      const filtered = filterValues(spec.values, raw)
      return filtered.length > 0 ? filtered[0] : undefined
    }
    case 'join': {
      if (!Array.isArray(raw) || raw.length === 0) return undefined
      const filtered = filterValues(spec.values, raw)
      return filtered.length > 0 ? filtered.join(spec.sep ?? ',') : undefined
    }
    default: {
      if (raw === undefined || raw === null) return undefined
      if (Array.isArray(raw)) {
        const filtered = filterValues(spec.values, raw)
        return filtered.length > 0 ? filtered : undefined
      }
      return raw
    }
  }
}

export function valuesEqualAt(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// sourceMapFor builds the unified field snapshot from a models.dev row.
export function sourceMapFor(row: ModelsDevModel): Record<string, unknown> {
  const types = [...new Set([...row.inputTypes, ...row.outputTypes])]
  return {
    max_context: row.contextLength > 0 ? row.contextLength : undefined,
    max_output_token: row.maxOutput > 0 ? row.maxOutput : undefined,
    input_types: types.length > 0 ? types : undefined,
    thinking_levels: row.reasoning ? ['high'] : [],
  }
}

// Spec 解析：字符串路径 vs 显式对象（path/op/sep）。
function specFor(value: AgentModelInfoFieldSpecValue): { path: string; apply: (raw: unknown) => unknown } | null {
  if (typeof value === 'string') {
    if (!value) return null
    return { path: value, apply: (raw) => (raw === undefined || raw === null ? undefined : raw) }
  }
  if (value && typeof value.path === 'string' && value.path) {
    return {
      path: value.path,
      apply: (raw) => applySpecOp(raw, value as AgentModelInfoFieldSpec),
    }
  }
  return null
}

/**
 * modelInfoChangesFor computes the four unified model-info field changes
 * (max_context / max_output_token / input_types / thinking_levels) by
 * diffing the model's current config against its models.dev reference
 * supplier. Used by both the "使用推荐配置" dialog and the "预览差异"
 * feature so the two always agree.
 */
export function modelInfoChangesFor(
  config: unknown,
  modelId: string,
  supplier: string | undefined,
  snapshot: readonly ModelsDevModel[] | null,
  modelInfoFields: AgentModelInfoFieldPaths,
): ModelInfoFieldChange[] {
  if (!supplier) return []
  const model = findModelsDevProviderRow(snapshot ?? [], modelId, supplier)
  if (!model) return []
  if (!config || typeof config !== 'object') return []
  const source = sourceMapFor(model)
  const changes: ModelInfoFieldChange[] = []
  for (const key of MODEL_INFO_FIELD_KEYS) {
    const spec = modelInfoFields[key]
    const resolved = specFor(spec)
    if (!resolved) continue
    const raw = source[key]
    if (raw === undefined || raw === null) continue
    const current = fieldValueAt(config, resolved.path)
    const next = resolved.apply(raw)
    if (next === undefined) continue
    if (!valuesEqualAt(current, next)) {
      changes.push({
        key,
        label: MODEL_INFO_FIELD_ABBREV[key],
        path: resolved.path,
        oldValue: current,
        newValue: next,
        field: spec,
      })
    }
  }
  return changes
}

export const MODEL_INFO_FIELD_ABBREV: Record<ModelInfoFieldKey, string> = MODEL_INFO_FIELD_LABELS