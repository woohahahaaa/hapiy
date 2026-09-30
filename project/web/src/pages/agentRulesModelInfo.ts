import { i18n } from '@/i18n/i18n'
import {
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentModelInfoFieldOp,
  type AgentModelInfoFieldPaths,
  type AgentModelInfoFieldSpecValue,
  type ModelInfoFieldKey,
} from '@/lib/dashboard-api'

// ModelInfoVariantShape — op="variants" 的写入形状："" = 旧版对象 map
// （{level:{options:{reasoningEffort}}}，opencode-v1）；"array" = opencode-v2
// 数组（[{id,settings:{reasoningEffort}}]）。后端 shapeValue 依此决定形状；
// 丢成 "" 会让 V2 写出对象 map，被 opencode V2 判为 malformed 整块跳过。
export type ModelInfoVariantShape = '' | 'array'

// ModelInfoFieldRow — 模型信息字段的结构化编辑状态：不再用 JSON 文本，
// 而是拆成 路径 / 写法(op) / sep / 允许值 / 形状 / 操作 六列（与下方推荐字段
// 表格同一套「值 + 写法」规则）。variantShape 必须往返保存，否则编辑一次
// 规则就会把 V2 的数组形状退回旧版对象形状。
export type ModelInfoFieldRow = {
  path: string
  action: 'set' | 'skip' | 'delete'
  op: AgentModelInfoFieldOp
  sep: string
  valuesText: string
  variantShape: ModelInfoVariantShape
}

export const EMPTY_MODEL_INFO_ROW: ModelInfoFieldRow = {
  path: '',
  action: 'set',
  op: 'raw',
  sep: '',
  valuesText: '',
  variantShape: '',
}

export const EMPTY_MODEL_INFO_ROWS: Record<ModelInfoFieldKey, ModelInfoFieldRow> = {
  max_context: { ...EMPTY_MODEL_INFO_ROW },
  max_output_token: { ...EMPTY_MODEL_INFO_ROW },
  input_types: { ...EMPTY_MODEL_INFO_ROW },
  thinking_levels: { ...EMPTY_MODEL_INFO_ROW },
  reasoning_effort: { ...EMPTY_MODEL_INFO_ROW },
}

// modelInfoRowsFromSpecs 把持久化的字段值（纯路径字符串或「值&写法」对象）
// 归一为编辑器行。variant_shape 只在 op=variants 时才有意义，保留为
// "" | "array" 两种。
export function modelInfoRowsFromSpecs(
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
      rows[key].variantShape = v.variant_shape === 'array' ? 'array' : ''
    }
  }
  return rows
}

// buildModelInfoFieldsPayload 把编辑器行组装回 API payload。空路径的行：
// 只填了写法（op/sep/允许值/操作/形状）等内容时报错，否则跳过（不写该字段）；
// 出错不提前返回，其余字段照常组装（整弹窗 JSON 序列化依赖完整结果）。
export function buildModelInfoFieldsPayload(
  rows: Record<ModelInfoFieldKey, ModelInfoFieldRow>,
): { fields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue>; error: string | null } {
  const fields: Record<ModelInfoFieldKey, AgentModelInfoFieldSpecValue> = {
    max_context: '',
    max_output_token: '',
    input_types: '',
    thinking_levels: '',
    reasoning_effort: '',
  }
  let error: string | null = null
  for (const key of MODEL_INFO_FIELD_KEYS) {
    const row = rows[key]
    const path = row.path.trim()
    if (path === '') {
      const hasOther =
        row.op !== 'raw' || row.action !== 'set' || row.sep.trim() !== '' ||
        row.valuesText.trim() !== '' || row.variantShape !== ''
      if (hasOther && error === null) {
        error = i18n.t('agentRules:errors.modelInfoPathRequired', { label: i18n.t('agentRules:modelInfoFields.' + MODEL_INFO_FIELD_LABELS[key]) })
      }
      continue
    }
    const spec: { path: string; action?: 'set' | 'skip' | 'delete'; op?: AgentModelInfoFieldOp; sep?: string; values?: string[]; variant_shape?: string } = { path }
    if (row.action !== 'set') spec.action = row.action
    if (row.op !== 'raw') spec.op = row.op
    if (row.sep.trim() !== '') spec.sep = row.sep.trim()
    const values = row.valuesText.split(',').map((s) => s.trim()).filter((s) => s !== '')
    if (values.length > 0) spec.values = values
    if (row.op === 'variants' && row.variantShape === 'array') spec.variant_shape = 'array'
    fields[key] = spec
  }
  return { fields, error }
}
