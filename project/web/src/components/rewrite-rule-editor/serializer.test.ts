import { describe, expect, it } from 'vitest'
import {
  emptyAction,
  isActionValid,
  isConditionValid,
  literalCapable,
  parseRule,
  parseValueInput,
  serializeRule,
  type Action,
  type LeafCondition,
  type RuleForm,
} from './serializer'

function makeAction(partial: Partial<Action>): Action {
  return { ...emptyAction(), ...partial }
}

function makeForm(actions: Action[]): RuleForm {
  return { blocks: [{ id: 'rule-1', conditions: [], actions }] }
}

function makeCondition(partial: Partial<LeafCondition>): LeafCondition {
  return { path: 'a', op: 'eq', value: '"x"', invert: false, scope: 'all', ...partial }
}

describe('parseValueInput', () => {
  it('true/false/null/数字 token 解析为原生字面量', () => {
    expect(parseValueInput('true')).toEqual({ kind: 'literal', json: true })
    expect(parseValueInput('false')).toEqual({ kind: 'literal', json: false })
    expect(parseValueInput('null')).toEqual({ kind: 'literal', json: null })
    expect(parseValueInput('0.7')).toEqual({ kind: 'literal', json: 0.7 })
    expect(parseValueInput('-3')).toEqual({ kind: 'literal', json: -3 })
    expect(parseValueInput('1e3')).toEqual({ kind: 'literal', json: 1000 })
  })

  it('带引号的合法 JSON 字符串解析为字符串（去引号）', () => {
    expect(parseValueInput('"hello"')).toEqual({ kind: 'string', value: 'hello' })
    expect(parseValueInput('""')).toEqual({ kind: 'string', value: '' })
    expect(parseValueInput('"a \\"b\\" c"')).toEqual({ kind: 'string', value: 'a "b" c' })
  })

  it('空文本 / 裸文本 / 坏引号 → invalid', () => {
    expect(parseValueInput('')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('   ')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('hello')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('"unterminated')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('trueish')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('1.2.3')).toEqual({ kind: 'invalid' })
  })
})

describe('literalCapable', () => {
  it('set + body / set + all（非 header 路径）可走字面量约定', () => {
    expect(literalCapable(makeAction({ mode: 'set', scope: 'body' }))).toBe(true)
    expect(literalCapable(makeAction({ mode: 'set', scope: 'all', path: 'stream' }))).toBe(true)
  })

  it('header 路径（scope=header 或 all 下手写 header. 前缀）与非 set 模式不可', () => {
    expect(literalCapable(makeAction({ mode: 'set', scope: 'header' }))).toBe(false)
    expect(literalCapable(makeAction({ mode: 'set', scope: 'all', path: 'header.X-Foo' }))).toBe(false)
    expect(literalCapable(makeAction({ mode: 'append', scope: 'body' }))).toBe(false)
  })
})

describe('action value round-trip（quote-required 约定）', () => {
  it('字符串加载为带引号文本，保存回字符串', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'stream', value: 'hello' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('"hello"')
    expect(serializeRule(form)).toBe(script)
  })

  it('true 加载为 true token，保存回原生 true', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'flag', value: true }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('true')
    expect(serializeRule(form)).toBe(script)
  })

  it('数字加载为数字 token，保存回原生 number', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'temperature', value: 0.7 }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('0.7')
    expect(serializeRule(form)).toBe(script)
  })

  it('null 加载为 null token，保存回原生 null', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'tool_calls', value: null }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('null')
    expect(serializeRule(form)).toBe(script)
  })

  it('表单里带引号输入 → 序列化为字符串内容', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'name', value: '"hello"' })])
    expect(serializeRule(form)).toBe(JSON.stringify([{ mode: 'set', path: 'name', value: 'hello' }]))
  })

  it('表单里 token 输入 → 序列化为原生 JSON', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'flag', value: 'true' })])
    expect(serializeRule(form)).toBe(JSON.stringify([{ mode: 'set', path: 'flag', value: true }]))
  })
})

describe('invalid value 丢弃', () => {
  it('set 模式裸文本 action 不合法且被序列化丢弃', () => {
    const action = makeAction({ mode: 'set', path: 'x', value: 'hello' })
    expect(isActionValid(action)).toBe(false)
    expect(serializeRule(makeForm([action]))).toBe('[]')
  })

  it('set 模式空 value 不合法', () => {
    expect(isActionValid(makeAction({ mode: 'set', path: 'x', value: '' }))).toBe(false)
  })

  it('条件裸文本 value 不合法且被序列化丢弃', () => {
    const cond = makeCondition({ value: 'abc' })
    expect(isConditionValid(cond)).toBe(false)
    const form: RuleForm = {
      blocks: [{ id: 'rule-1', conditions: [cond], actions: [makeAction({ mode: 'set', path: 'x', value: '1' })] }],
    }
    expect(serializeRule(form)).toBe(JSON.stringify([{ mode: 'set', path: 'x', value: 1 }]))
  })
})

describe('非 set 模式保持纯字符串语义', () => {
  it('append 的 value 不解析约定，原样作为字符串输出', () => {
    for (const v of ['true', 'hello', '0.7']) {
      const action = makeAction({ mode: 'append', path: 'x', value: v })
      expect(isActionValid(action)).toBe(true)
      expect(serializeRule(makeForm([action]))).toBe(JSON.stringify([{ mode: 'append', path: 'x', value: v }]))
    }
  })
})

describe('header 作用域保持纯字符串语义', () => {
  it('scope=header 的 set：value 原样字符串输出，路径补前缀', () => {
    const action = makeAction({ mode: 'set', path: 'X-Foo', value: 'true', scope: 'header' })
    expect(isActionValid(action)).toBe(true)
    expect(serializeRule(makeForm([action]))).toBe(
      JSON.stringify([{ mode: 'set', path: 'header.X-Foo', value: 'true', scope: 'header' }]),
    )
  })

  it('scope=all + 手写 header. 前缀：value 原样字符串输出', () => {
    const action = makeAction({ mode: 'set', path: 'header.X-Foo', value: 'true', scope: 'all' })
    expect(isActionValid(action)).toBe(true)
    expect(serializeRule(makeForm([action]))).toBe(
      JSON.stringify([{ mode: 'set', path: 'header.X-Foo', value: 'true' }]),
    )
  })

  it('header set 字符串 round-trip 无损', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'header.X-Foo', value: 'bar', scope: 'header' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('bar')
    expect(serializeRule(form)).toBe(script)
  })
})

describe('条件值约定', () => {
  it('原生 number/boolean 条件值加载为 token 并保存回原生', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'x', value: '1', conditions: [{ path: 'n', op: 'gt', value: 5 }] }])
    const form = parseRule(script)
    expect(form.blocks[0].conditions[0]).toMatchObject({ value: '5' })
    expect(serializeRule(form)).toBe(script)
  })

  it('字符串条件值加载为带引号文本并保存回字符串', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'x', value: '1', conditions: [{ path: 'a', op: 'eq', value: '1' }] }])
    const form = parseRule(script)
    expect(form.blocks[0].conditions[0]).toMatchObject({ value: '"1"' })
    expect(serializeRule(form)).toBe(script)
  })

  it('缺失条件值加载为空文本', () => {
    const conds = parseRule(
      JSON.stringify([{ mode: 'set', path: 'x', value: '1', conditions: [{ path: 'a', op: 'eq' }] }]),
    ).blocks[0].conditions
    expect(conds[0]).toMatchObject({ value: '' })
  })
})

describe('replace 模式（from/to 字符串，不用 value）', () => {
  it('from/to 仍为字符串语义', () => {
    const form = makeForm([makeAction({ mode: 'replace', path: 'a', from: 'foo', to: 'bar', value: 'unused' })])
    const script = serializeRule(form)
    expect(script).toBe(JSON.stringify([{ mode: 'replace', path: 'a', from: 'foo', to: 'bar' }]))
  })
})

describe('嵌套 AND/OR 条件 round-trip', () => {
  const cases: [string, string][] = [
    ['单层 OR 组', JSON.stringify([{ mode: 'set', path: 'model', value: 'x', conditions: [{ logic: 'OR', children: [{ path: 'a', op: 'eq', value: '1' }, { path: 'b', op: 'eq', value: '2' }] }] }])],
    ['双层嵌套', JSON.stringify([{ mode: 'set', path: 'model', value: 'x', conditions: [{ logic: 'AND', children: [{ path: 'a', op: 'eq', value: '1' }, { logic: 'OR', children: [{ path: 'b', op: 'eq', value: '2' }, { path: 'c', op: 'eq', value: '3' }] }] }] }])],
  ]
  for (const [name, script] of cases) {
    it(`${name} 无损往返`, () => {
      expect(serializeRule(parseRule(script))).toBe(script)
    })
  }

  it('顶层单层 OR 组拆为 conditionLogic + 平铺叶子', () => {
    const form = parseRule(JSON.stringify([{ mode: 'set', path: 'p', value: 'v', conditions: [{ logic: 'OR', children: [{ path: 'a', op: 'eq', value: '1' }] }] }]))
    expect(form.blocks[0].conditionLogic).toBe('OR')
    expect(form.blocks[0].conditions).toHaveLength(1)
    expect(form.blocks[0].conditions[0]).toMatchObject({ path: 'a', op: 'eq' })
  })

  it('嵌套在组内的逻辑组保持组合节点', () => {
    const form = parseRule(JSON.stringify([{ mode: 'set', path: 'p', value: 'v', conditions: [{ logic: 'AND', children: [{ path: 'a', op: 'eq', value: '1' }, { logic: 'OR', children: [{ path: 'b', op: 'eq', value: '2' }] }] }] }]))
    const cond = form.blocks[0].conditions[0]
    expect(cond).toMatchObject({ logic: 'AND' })
    expect('children' in cond && cond.children).toHaveLength(2)
  })
})
