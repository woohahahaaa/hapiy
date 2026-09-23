import { describe, expect, it } from 'vitest'
import {
  allowJsonLiterals,
  emptyAction,
  isActionValid,
  isConditionValid,
  parseRule,
  parseValueInput,
  serializeRule,
  valueConventionActive,
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
  return { path: 'a', op: 'eq', value: '"x"', invert: false, scope: 'body', ...partial }
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

  it('默认（refs=false）：空文本 / 裸文本 / 坏引号 → invalid', () => {
    expect(parseValueInput('')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('   ')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('hello')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('"unterminated')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('trueish')).toEqual({ kind: 'invalid' })
    expect(parseValueInput('1.2.3')).toEqual({ kind: 'invalid' })
  })

  it('refs=true：裸文本解析为变量引用', () => {
    expect(parseValueInput('X-Session-Id', { refs: true })).toEqual({ kind: 'ref', ref: 'X-Session-Id' })
    expect(parseValueInput('messages.0.content', { refs: true })).toEqual({ kind: 'ref', ref: 'messages.0.content' })
    expect(parseValueInput('  1.2.3  ', { refs: true })).toEqual({ kind: 'ref', ref: '1.2.3' })
    // 含引号只能是合法 JSON 字符串，否则仍 invalid，不当变量
    expect(parseValueInput('"unterminated', { refs: true })).toEqual({ kind: 'invalid' })
    expect(parseValueInput('a"b', { refs: true })).toEqual({ kind: 'invalid' })
  })

  it('literals=false：数字 / true 等 token 不再是字面量', () => {
    expect(parseValueInput('123', { literals: false, refs: true })).toEqual({ kind: 'ref', ref: '123' })
    expect(parseValueInput('true', { literals: false, refs: true })).toEqual({ kind: 'ref', ref: 'true' })
    expect(parseValueInput('"123"', { literals: false, refs: true })).toEqual({ kind: 'string', value: '123' })
  })
})

describe('value convention helpers', () => {
  it('set 模式走引号约定，其余模式不走', () => {
    expect(valueConventionActive(makeAction({ mode: 'set', scope: 'body' }))).toBe(true)
    expect(valueConventionActive(makeAction({ mode: 'set', scope: 'header' }))).toBe(true)
    expect(valueConventionActive(makeAction({ mode: 'append', scope: 'body' }))).toBe(false)
    expect(valueConventionActive(makeAction({ mode: '', scope: 'body' }))).toBe(false)
  })

  it('只有 body scope 解析 JSON 字面量（header 值是字符串）', () => {
    expect(allowJsonLiterals(makeAction({ mode: 'set', scope: 'body' }))).toBe(true)
    expect(allowJsonLiterals(makeAction({ mode: 'set', scope: 'header' }))).toBe(false)
  })
})

describe('action value round-trip（引号约定）', () => {
  it('字符串加载为带引号文本，保存回字符串', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'stream', value: 'hello', scope: 'body' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('"hello"')
    expect(serializeRule(form)).toBe(script)
  })

  it('true 加载为 true token，保存回原生 true', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'flag', value: true, scope: 'body' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('true')
    expect(serializeRule(form)).toBe(script)
  })

  it('数字加载为数字 token，保存回原生 number', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'temperature', value: 0.7, scope: 'body' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('0.7')
    expect(serializeRule(form)).toBe(script)
  })

  it('null 加载为 null token，保存回原生 null', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'tool_calls', value: null, scope: 'body' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('null')
    expect(serializeRule(form)).toBe(script)
  })

  it('表单里带引号输入 → 序列化为字符串内容', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'name', value: '"hello"' })])
    expect(serializeRule(form)).toBe(
      JSON.stringify([{ mode: 'set', path: 'name', value: 'hello', scope: 'body' }]),
    )
  })

  it('表单里 token 输入 → 序列化为原生 JSON', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'flag', value: 'true' })])
    expect(serializeRule(form)).toBe(
      JSON.stringify([{ mode: 'set', path: 'flag', value: true, scope: 'body' }]),
    )
  })

  it('{"ref":"..."} 加载为裸变量名，保存回引用对象', () => {
    const script = JSON.stringify([
      { mode: 'set', path: 'header.x-opencode-session', value: { ref: 'X-Session-Id' }, scope: 'header' },
    ])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('X-Session-Id')
    expect(serializeRule(form)).toBe(script)
  })

  it('表单里写裸变量名 → 序列化为 {"ref":"..."}', () => {
    const form = makeForm([
      makeAction({ mode: 'set', path: 'x-opencode-session', value: 'X-Session-Id', scope: 'header' }),
    ])
    expect(serializeRule(form)).toBe(
      JSON.stringify([
        { mode: 'set', path: 'header.x-opencode-session', value: { ref: 'X-Session-Id' }, scope: 'header' },
      ]),
    )
  })

  it('body scope 的裸文本同样是引用（同域）', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'target', value: 'source.path' })])
    expect(serializeRule(form)).toBe(
      JSON.stringify([{ mode: 'set', path: 'target', value: { ref: 'source.path' }, scope: 'body' }]),
    )
  })
})

describe('invalid value 丢弃', () => {
  it('set 模式裸文本现在是变量引用，合法', () => {
    const action = makeAction({ mode: 'set', path: 'x', value: 'hello' })
    expect(isActionValid(action)).toBe(true)
    expect(serializeRule(makeForm([action]))).toBe(
      JSON.stringify([{ mode: 'set', path: 'x', value: { ref: 'hello' }, scope: 'body' }]),
    )
  })

  it('set 模式空 value 不合法', () => {
    expect(isActionValid(makeAction({ mode: 'set', path: 'x', value: '' }))).toBe(false)
  })

  it('坏引号 value 不合法且被序列化丢弃', () => {
    const action = makeAction({ mode: 'set', path: 'x', value: '"oops' })
    expect(isActionValid(action)).toBe(false)
    expect(serializeRule(makeForm([action]))).toBe('[]')
  })

  it('条件裸文本 value 仍然不合法且被序列化丢弃', () => {
    const cond = makeCondition({ value: 'abc' })
    expect(isConditionValid(cond)).toBe(false)
    const form: RuleForm = {
      blocks: [{ id: 'rule-1', conditions: [cond], actions: [makeAction({ mode: 'set', path: 'x', value: '1' })] }],
    }
    expect(serializeRule(form)).toBe(
      JSON.stringify([{ mode: 'set', path: 'x', value: 1, scope: 'body' }]),
    )
  })
})

describe('非 set 模式保持纯字符串语义', () => {
  it('append 的 value 不解析约定，原样作为字符串输出', () => {
    for (const v of ['true', 'hello', '0.7']) {
      const action = makeAction({ mode: 'append', path: 'x', value: v })
      expect(isActionValid(action)).toBe(true)
      expect(serializeRule(makeForm([action]))).toBe(
        JSON.stringify([{ mode: 'append', path: 'x', value: v, scope: 'body' }]),
      )
    }
  })
})

describe('header 作用域', () => {
  it('路径自动补 header. 前缀；不加引号的值是变量', () => {
    const action = makeAction({ mode: 'set', path: 'x-opencode-session', value: 'X-Session-Id', scope: 'header' })
    expect(isActionValid(action)).toBe(true)
    expect(serializeRule(makeForm([action]))).toBe(
      JSON.stringify([
        { mode: 'set', path: 'header.x-opencode-session', value: { ref: 'X-Session-Id' }, scope: 'header' },
      ]),
    )
  })

  it('header 的固定字符串需带引号，round-trip 无损', () => {
    const script = JSON.stringify([{ mode: 'set', path: 'header.X-Foo', value: 'bar', scope: 'header' }])
    const form = parseRule(script)
    expect(form.blocks[0].actions[0].value).toBe('"bar"')
    expect(serializeRule(form)).toBe(script)
  })

  it('header 的不加引号数字也是变量名（不当字面量）', () => {
    const form = makeForm([makeAction({ mode: 'set', path: 'X-Code', value: '123', scope: 'header' })])
    expect(serializeRule(form)).toBe(
      JSON.stringify([{ mode: 'set', path: 'header.X-Code', value: { ref: '123' }, scope: 'header' }]),
    )
  })

  it('条件路径同样按 scope 剥 / 补前缀', () => {
    const script = JSON.stringify([
      {
        mode: 'set',
        path: 'x',
        value: '1',
        scope: 'body',
        conditions: [{ path: 'header.X-Tenant', op: 'neq', value: '"free"', scope: 'header' }],
      },
    ])
    const form = parseRule(script)
    expect(form.blocks[0].conditions[0]).toMatchObject({ path: 'X-Tenant', scope: 'header' })
    expect(serializeRule(form)).toBe(script)
  })
})

describe('历史 scope=all 数据按路径前缀推断', () => {
  it('header. 前缀 → header，其余 → body；重新保存时显式写 scope', () => {
    const legacy = JSON.stringify([
      { mode: 'set', path: 'header.X-Foo', value: 'v' },
      { mode: 'set', path: 'model', value: 'gpt-4' },
    ])
    const form = parseRule(legacy)
    expect(form.blocks[0].actions[0]).toMatchObject({ path: 'X-Foo', scope: 'header' })
    expect(form.blocks[0].actions[1]).toMatchObject({ path: 'model', scope: 'body' })
    expect(serializeRule(form)).toBe(
      JSON.stringify([
        { mode: 'set', path: 'header.X-Foo', value: 'v', scope: 'header' },
        { mode: 'set', path: 'model', value: 'gpt-4', scope: 'body' },
      ]),
    )
  })
})

describe('条件值约定', () => {
  it('原生 number/boolean 条件值加载为 token 并保存回原生', () => {
    const script = JSON.stringify([
      { mode: 'set', path: 'x', value: '1', scope: 'body', conditions: [{ path: 'n', op: 'gt', value: 5, scope: 'body' }] },
    ])
    const form = parseRule(script)
    expect(form.blocks[0].conditions[0]).toMatchObject({ value: '5' })
    expect(serializeRule(form)).toBe(script)
  })

  it('字符串条件值加载为带引号文本并保存回字符串', () => {
    const script = JSON.stringify([
      { mode: 'set', path: 'x', value: '1', scope: 'body', conditions: [{ path: 'a', op: 'eq', value: '1', scope: 'body' }] },
    ])
    const form = parseRule(script)
    expect(form.blocks[0].conditions[0]).toMatchObject({ value: '"1"' })
    expect(serializeRule(form)).toBe(script)
  })

  it('缺失条件值加载为空文本', () => {
    const conds = parseRule(
      JSON.stringify([{ mode: 'set', path: 'x', value: '1', scope: 'body', conditions: [{ path: 'a', op: 'eq' }] }]),
    ).blocks[0].conditions
    expect(conds[0]).toMatchObject({ value: '' })
  })
})

describe('replace 模式（from/to 字符串，不用 value）', () => {
  it('from/to 仍为字符串语义', () => {
    const form = makeForm([makeAction({ mode: 'replace', path: 'a', from: 'foo', to: 'bar', value: 'unused' })])
    const script = serializeRule(form)
    expect(script).toBe(
      JSON.stringify([{ mode: 'replace', path: 'a', from: 'foo', to: 'bar', scope: 'body' }]),
    )
  })
})

describe('嵌套 AND/OR 条件 round-trip', () => {
  const cases: [string, string][] = [
    ['单层 OR 组', JSON.stringify([{ mode: 'set', path: 'model', value: 'x', scope: 'body', conditions: [{ logic: 'OR', children: [{ path: 'a', op: 'eq', value: '1', scope: 'body' }, { path: 'b', op: 'eq', value: '2', scope: 'body' }] }] }])],
    ['双层嵌套', JSON.stringify([{ mode: 'set', path: 'model', value: 'x', scope: 'body', conditions: [{ logic: 'AND', children: [{ path: 'a', op: 'eq', value: '1', scope: 'body' }, { logic: 'OR', children: [{ path: 'b', op: 'eq', value: '2', scope: 'body' }, { path: 'c', op: 'eq', value: '3', scope: 'body' }] }] }] }])],
  ]
  for (const [name, script] of cases) {
    it(`${name} 无损往返`, () => {
      expect(serializeRule(parseRule(script))).toBe(script)
    })
  }

  it('顶层单层 OR 组拆为 conditionLogic + 平铺叶子', () => {
    const form = parseRule(JSON.stringify([{ mode: 'set', path: 'p', value: 'v', scope: 'body', conditions: [{ logic: 'OR', children: [{ path: 'a', op: 'eq', value: '1', scope: 'body' }] }] }]))
    expect(form.blocks[0].conditionLogic).toBe('OR')
    expect(form.blocks[0].conditions).toHaveLength(1)
    expect(form.blocks[0].conditions[0]).toMatchObject({ path: 'a', op: 'eq' })
  })

  it('嵌套在组内的逻辑组保持组合节点', () => {
    const form = parseRule(JSON.stringify([{ mode: 'set', path: 'p', value: 'v', scope: 'body', conditions: [{ logic: 'AND', children: [{ path: 'a', op: 'eq', value: '1', scope: 'body' }, { logic: 'OR', children: [{ path: 'b', op: 'eq', value: '2', scope: 'body' }] }] }] }]))
    const cond = form.blocks[0].conditions[0]
    expect(cond).toMatchObject({ logic: 'AND' })
    expect('children' in cond && cond.children).toHaveLength(2)
  })
})
