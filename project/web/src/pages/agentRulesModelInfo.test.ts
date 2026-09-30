import { describe, expect, it } from 'vitest'
import { buildModelInfoFieldsPayload, modelInfoRowsFromSpecs } from './agentRulesModelInfo'

// 回归：规则编辑页曾经不往返 variant_shape，保存一次就把 opencode-v2 的
// 数组形状退回旧版对象形状，写出的 variants 会被 OpenCode V2 判为 malformed
// 并整块跳过 provider。这里锁死 spec → 行 → payload 的往返。
describe('agentRulesModelInfo variant_shape round-trip', () => {
  it('reads variant_shape="array" from a stored spec', () => {
    const rows = modelInfoRowsFromSpecs({
      max_context: 'limit.context',
      max_output_token: '',
      input_types: 'capabilities.input',
      thinking_levels: '',
      reasoning_effort: { path: 'variants', op: 'variants', values: ['low', 'high', 'max'], variant_shape: 'array' },
    })
    expect(rows.reasoning_effort.variantShape).toBe('array')
    expect(rows.reasoning_effort.op).toBe('variants')
  })

  it('defaults a spec without variant_shape to the legacy object shape', () => {
    const rows = modelInfoRowsFromSpecs({
      max_context: '',
      max_output_token: '',
      input_types: '',
      thinking_levels: '',
      reasoning_effort: { path: 'variants', op: 'variants', values: ['low', 'high'] },
    })
    expect(rows.reasoning_effort.variantShape).toBe('')
  })

  it('writes variant_shape back on save so a rule edit cannot drop it', () => {
    const { fields, error } = buildModelInfoFieldsPayload(
      modelInfoRowsFromSpecs({
        max_context: 'limit.context',
        max_output_token: 'limit.output',
        input_types: 'capabilities.input',
        thinking_levels: '',
        reasoning_effort: { path: 'variants', op: 'variants', values: ['low', 'high', 'max'], variant_shape: 'array' },
      }),
    )
    expect(error).toBeNull()
    expect(fields.reasoning_effort).toEqual({
      path: 'variants',
      op: 'variants',
      values: ['low', 'high', 'max'],
      variant_shape: 'array',
    })
  })

  it('does not invent variant_shape for the legacy object shape', () => {
    const { fields } = buildModelInfoFieldsPayload(
      modelInfoRowsFromSpecs({
        max_context: '',
        max_output_token: '',
        input_types: '',
        thinking_levels: '',
        reasoning_effort: { path: 'variants', op: 'variants', values: ['low', 'high'] },
      }),
    )
    expect(fields.reasoning_effort).toEqual({ path: 'variants', op: 'variants', values: ['low', 'high'] })
  })

  it('ignores variant_shape on a non-variants op', () => {
    const { fields } = buildModelInfoFieldsPayload(
      modelInfoRowsFromSpecs({
        max_context: 'limit.context',
        max_output_token: '',
        input_types: '',
        thinking_levels: '',
        reasoning_effort: { path: 'input', op: 'join', values: ['text'], variant_shape: 'array' },
      }),
    )
    expect(fields.reasoning_effort).toEqual({ path: 'input', op: 'join', values: ['text'] })
  })
})
