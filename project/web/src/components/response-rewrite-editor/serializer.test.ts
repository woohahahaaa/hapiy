import { describe, expect, it } from 'vitest'
import {
  isActionValid,
  parseRule,
  serializeRule,
  type Action,
  type Block,
  type RuleForm,
} from './serializer'

function makeAction(partial: Partial<Action>): Action {
  return { mode: 'move', path: '', value: '', ...partial }
}

function makeBlock(actions: Action[]): Block {
  return { id: 'rule-test', conditions: [], actions }
}

describe('response-rewrite serializer — round-trip', () => {
  it('rename (move) → script → rename', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: 'move', path: 'messages.0.content', value: 'messages.0.text' }),
        ]),
      ],
    }
    const script = serializeRule(form)
    expect(script).toBe('[{"mode":"move","path":"messages.0.content","dst":"messages.0.text"}]')
    const parsed = parseRule(script)
    expect(parsed.blocks).toHaveLength(1)
    const a = parsed.blocks[0].actions[0]
    expect(a.mode).toBe('move')
    expect(a.path).toBe('messages.0.content')
    expect(a.value).toBe('messages.0.text')
  })

  it('prefix (first_prepend) → script → prefix', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: 'first_prepend', path: 'choices.0.message.content', value: '\n<think>' }),
        ]),
      ],
    }
    const script = serializeRule(form)
    expect(script).toBe('[{"mode":"first_prepend","path":"choices.0.message.content","value":"\\n<think>"}]')
    const parsed = parseRule(script)
    const a = parsed.blocks[0].actions[0]
    expect(a.mode).toBe('first_prepend')
    expect(a.value).toBe('\n<think>')
  })

  it('suffix (last_append) → script → suffix', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: 'last_append', path: 'choices.0.message.content', value: '\n</think>' }),
        ]),
      ],
    }
    const script = serializeRule(form)
    expect(script).toBe('[{"mode":"last_append","path":"choices.0.message.content","value":"\\n</think>"}]')
    const parsed = parseRule(script)
    const a = parsed.blocks[0].actions[0]
    expect(a.mode).toBe('last_append')
    expect(a.value).toBe('\n</think>')
  })

  it('delete → script → delete (value ignored)', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: 'delete', path: 'choices.0.finish_reason', value: 'should-be-ignored' }),
        ]),
      ],
    }
    const script = serializeRule(form)
    expect(script).toBe('[{"mode":"delete","path":"choices.0.finish_reason"}]')
    const parsed = parseRule(script)
    const a = parsed.blocks[0].actions[0]
    expect(a.mode).toBe('delete')
    expect(a.path).toBe('choices.0.finish_reason')
    expect(a.value).toBe('')
  })

  it('multiple actions within one block preserve order', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: 'first_prepend', path: 'choices.0.message.content', value: 'A' }),
          makeAction({ mode: 'last_append', path: 'choices.0.message.content', value: 'Z' }),
          makeAction({ mode: 'delete', path: 'choices.0.finish_reason' }),
        ]),
      ],
    }
    const parsed = parseRule(serializeRule(form))
    expect(parsed.blocks[0].actions.map((a) => a.mode)).toEqual([
      'first_prepend',
      'last_append',
      'delete',
    ])
  })

  it('multiple blocks flatten into one block on parse (script is a flat array)', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([makeAction({ mode: 'first_prepend', path: 'a', value: 'X' })]),
        makeBlock([makeAction({ mode: 'delete', path: 'b' })]),
      ],
    }
    const script = serializeRule(form)
    expect(JSON.parse(script)).toHaveLength(2)
    const parsed = parseRule(script)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].actions).toHaveLength(2)
    expect(parsed.blocks[0].actions.map((a) => a.mode)).toEqual(['first_prepend', 'delete'])
  })
})

describe('response-rewrite serializer — validation', () => {
  it('incomplete action is dropped on serialize', () => {
    const form: RuleForm = {
      blocks: [
        makeBlock([
          makeAction({ mode: '', path: '', value: '' }),                                 // empty
          makeAction({ mode: 'first_prepend', path: 'foo', value: '' }),                 // empty value
          makeAction({ mode: 'move', path: 'foo', value: '' }),                            // empty value (=dst)
          makeAction({ mode: 'delete', path: 'foo' }),                                    // valid
        ]),
      ],
    }
    expect(serializeRule(form)).toBe('[{"mode":"delete","path":"foo"}]')
  })

  it('isActionValid reflects required fields', () => {
    expect(isActionValid(makeAction({ mode: '' }))).toBe(false)
    expect(isActionValid(makeAction({ mode: 'move', path: '', value: '' }))).toBe(false)
    expect(isActionValid(makeAction({ mode: 'move', path: 'foo', value: '' }))).toBe(false)
    expect(isActionValid(makeAction({ mode: 'move', path: 'foo', value: 'bar' }))).toBe(true)
    expect(isActionValid(makeAction({ mode: 'first_prepend', path: 'foo', value: '' }))).toBe(false)
    expect(isActionValid(makeAction({ mode: 'first_prepend', path: 'foo', value: 'x' }))).toBe(true)
    expect(isActionValid(makeAction({ mode: 'delete', path: 'foo' }))).toBe(true)
    expect(isActionValid(makeAction({ mode: 'delete', path: '' }))).toBe(false)
  })
})

describe('response-rewrite serializer — legacy script parsing', () => {
  it('parses existing first_prepend / last_append / move / delete scripts', () => {
    const script = JSON.stringify([
      { mode: 'move', path: 'a', dst: 'b' },
      { mode: 'first_prepend', path: 'c', value: 'v1' },
      { mode: 'last_append', path: 'd', value: 'v2' },
      { mode: 'delete', path: 'e' },
    ])
    const parsed = parseRule(script)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].actions.map((a) => a.mode)).toEqual([
      'move',
      'first_prepend',
      'last_append',
      'delete',
    ])
    expect(parsed.blocks[0].actions[0].value).toBe('b')
    expect(parsed.blocks[0].actions[1].value).toBe('v1')
  })

  it('unknown modes are silently skipped; parseRule returns fallback empty block', () => {
    const script = JSON.stringify([
      { mode: 'ensure_prefix', path: 'foo', value: 'bar' },
      { mode: 'replace', path: 'foo', from: 'a', to: 'b' },
    ])
    const parsed = parseRule(script)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].actions).toHaveLength(1)
    expect(parsed.blocks[0].actions[0].mode).toBe('move')
    expect(parsed.blocks[0].actions[0].path).toBe('')
    expect(parsed.blocks[0].actions[0].value).toBe('')
  })

  it('empty / invalid input returns fallback empty rule', () => {
    expect(parseRule('').blocks[0].actions).toEqual([makeAction({})])
    expect(parseRule('not json').blocks[0].actions).toEqual([makeAction({})])
    expect(parseRule('{}').blocks[0].actions).toEqual([makeAction({})])
    expect(parseRule('[]').blocks[0].actions).toEqual([makeAction({})])
  })
})

describe('response-rewrite serializer — conditions round-trip', () => {
  it('嵌套 AND/OR 条件无损往返', () => {
    const script = JSON.stringify([{ mode: 'delete', path: 'a', conditions: [{ logic: 'OR', children: [{ path: 'b', op: 'eq', value: '1' }, { path: 'c', op: 'eq', value: '2' }] }] }])
    expect(serializeRule(parseRule(script))).toBe(script)
  })

  it('顶层 OR 包装还原为 conditionLogic 再序列化回单组', () => {
    const script = JSON.stringify([{ mode: 'delete', path: 'a', conditions: [{ logic: 'OR', children: [{ path: 'b', op: 'eq', value: '1' }] }] }])
    const parsed = parseRule(script)
    expect(parsed.blocks[0].conditionLogic).toBe('OR')
    expect(serializeRule(parsed)).toBe(script)
  })
})