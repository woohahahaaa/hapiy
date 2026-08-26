import { describe, expect, it } from 'vitest'
import { emptyAction, parseRule, serializeRule, type Action, type RuleForm } from './serializer'

function makeAction(partial: Partial<Action>): Action {
  return { ...emptyAction(), ...partial }
}

function makeForm(actions: Action[]): RuleForm {
  return { blocks: [{ id: 'rule-1', conditions: [], actions }] }
}

describe('valueLiteral 序列化/反序列化', () => {
  it('boolean 字面量 (true) 序列化为原生 JSON', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'stream', value: 'true', valueLiteral: true })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'set', path: 'stream', value: true }]))
  })

  it('boolean 字面量 (false) 反序列化回 valueLiteral', () => {
    const form = parseRule(JSON.stringify([{ mode: 'set', path: 'stream', value: false }]))
    const action = form.blocks[0].actions[0]
    expect(action.valueLiteral).toBe(false)
    expect(action.value).toBe('')
  })

  it('数字字面量序列化为 JSON number', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'temperature', value: '0.7', valueLiteral: 0.7 })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'set', path: 'temperature', value: 0.7 }]))
  })

  it('null 字面量序列化为 JSON null', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'tool_calls', value: 'null', valueLiteral: null })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'set', path: 'tool_calls', value: null }]))
  })

  it('未启用字面量的 value 仍然走字符串模式', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'name', value: 'true', valueLiteral: undefined })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'set', path: 'name', value: 'true' }]))
  })

  it('valueLiteral !== undefined 时不依赖 value 字符串', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'flag', value: 'leftover-text', valueLiteral: false })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'set', path: 'flag', value: false }]))
  })

  it('round-trip: 字面量 → 序列化 → 反序列化保持类型', () => {
    const original = makeAction({ mode: 'set', path: 'flag', value: '', valueLiteral: null })
    const script = serializeRule(makeForm([original]))
    const parsed = parseRule(script).blocks[0].actions[0]
    expect(parsed.valueLiteral).toBeNull()
  })
})

describe('valueLiteral 兼容性', () => {
  it('value 为字面量、from/to 仍为字符串（replace 模式）', () => {
    const form = makeForm([makeAction({
      mode: 'replace',
      path: 'a',
      from: 'foo',
      to: 'bar',
      value: 'unused',
      valueLiteral: true,
    })])
    const script = serializeRule(form)
    // replace 模式不走 value 字段，只看 from/to。
    expect(script).toBe(JSON.stringify([{ mode: 'replace', path: 'a', from: 'foo', to: 'bar' }]))
  })
})