import { describe, expect, it } from 'vitest'
import {
  isOpComplete,
  parseRule,
  serializeRule,
  type DeleteOp,
  type PrefixOp,
  type RenameOp,
  type RuleForm,
  type SuffixOp,
} from './serializer'

function makeId(op: { type: string }): string {
  // 序列化不依赖 id；为了比较我们重置 id。
  void op
  return 'op-test'
}

describe('response-rewrite serializer — round-trip', () => {
  it('rename → move → rename (nested path)', () => {
    const original: RuleForm = {
      ops: [
        { type: 'rename', id: makeId({ type: 'rename' }), path: 'messages.0.content', newName: 'text' } as RenameOp,
      ],
    }
    const script = serializeRule(original)
    expect(script).toBe('[{"mode":"move","path":"messages.0.content","dst":"messages.0.text"}]')
    const parsed = parseRule(script)
    expect(parsed.ops).toHaveLength(1)
    const op = parsed.ops[0] as RenameOp
    expect(op.type).toBe('rename')
    expect(op.path).toBe('messages.0.content')
    expect(op.newName).toBe('text')
  })

  it('rename at root level', () => {
    const original: RuleForm = {
      ops: [
        { type: 'rename', id: makeId({ type: 'rename' }), path: 'model', newName: 'model_name' } as RenameOp,
      ],
    }
    const script = serializeRule(original)
    expect(script).toBe('[{"mode":"move","path":"model","dst":"model_name"}]')
    const parsed = parseRule(script)
    const op = parsed.ops[0] as RenameOp
    expect(op.type).toBe('rename')
    expect(op.newName).toBe('model_name')
  })

  it('prefix → first_prepend → prefix', () => {
    const original: RuleForm = {
      ops: [
        { type: 'prefix', id: makeId({ type: 'prefix' }), path: 'choices.0.message.content', value: '\n<think>' } as PrefixOp,
      ],
    }
    const script = serializeRule(original)
    expect(script).toBe('[{"mode":"first_prepend","path":"choices.0.message.content","value":"\\n<think>"}]')
    const parsed = parseRule(script)
    const op = parsed.ops[0] as PrefixOp
    expect(op.type).toBe('prefix')
    expect(op.path).toBe('choices.0.message.content')
    expect(op.value).toBe('\n<think>')
  })

  it('suffix → last_append → suffix', () => {
    const original: RuleForm = {
      ops: [
        { type: 'suffix', id: makeId({ type: 'suffix' }), path: 'choices.0.message.content', value: '\n</think>' } as SuffixOp,
      ],
    }
    const script = serializeRule(original)
    expect(script).toBe('[{"mode":"last_append","path":"choices.0.message.content","value":"\\n</think>"}]')
    const parsed = parseRule(script)
    const op = parsed.ops[0] as SuffixOp
    expect(op.type).toBe('suffix')
    expect(op.value).toBe('\n</think>')
  })

  it('delete → delete → delete', () => {
    const original: RuleForm = {
      ops: [
        { type: 'delete', id: makeId({ type: 'delete' }), path: 'choices.0.finish_reason' } as DeleteOp,
      ],
    }
    const script = serializeRule(original)
    expect(script).toBe('[{"mode":"delete","path":"choices.0.finish_reason"}]')
    const parsed = parseRule(script)
    const op = parsed.ops[0] as DeleteOp
    expect(op.type).toBe('delete')
    expect(op.path).toBe('choices.0.finish_reason')
  })

  it('multiple ops preserve order', () => {
    const original: RuleForm = {
      ops: [
        { type: 'prefix', id: makeId({ type: 'p' }), path: 'choices.0.message.content', value: 'A' } as PrefixOp,
        { type: 'suffix', id: makeId({ type: 's' }), path: 'choices.0.message.content', value: 'Z' } as SuffixOp,
        { type: 'delete', id: makeId({ type: 'd' }), path: 'choices.0.finish_reason' } as DeleteOp,
      ],
    }
    const parsed = parseRule(serializeRule(original))
    expect(parsed.ops.map((o) => o.type)).toEqual(['prefix', 'suffix', 'delete'])
  })
})

describe('response-rewrite serializer — partial inputs', () => {
  it('incomplete op is dropped on serialize', () => {
    const form: RuleForm = {
      ops: [
        { type: 'rename', id: makeId({ type: 'r' }), path: '', newName: '' } as RenameOp, // empty
        { type: 'prefix', id: makeId({ type: 'p' }), path: 'foo', value: '' } as PrefixOp, // empty value
        { type: 'delete', id: makeId({ type: 'd' }), path: 'foo' } as DeleteOp, // valid
      ],
    }
    expect(serializeRule(form)).toBe('[{"mode":"delete","path":"foo"}]')
  })

  it('isOpComplete reflects required fields', () => {
    expect(isOpComplete({ type: 'rename', id: 'a', path: '', newName: '' })).toBe(false)
    expect(isOpComplete({ type: 'rename', id: 'a', path: 'foo', newName: '' })).toBe(false)
    expect(isOpComplete({ type: 'rename', id: 'a', path: 'foo', newName: 'bar' })).toBe(true)
    expect(isOpComplete({ type: 'prefix', id: 'a', path: 'foo', value: '' })).toBe(false)
    expect(isOpComplete({ type: 'suffix', id: 'a', path: 'foo', value: 'x' })).toBe(true)
    expect(isOpComplete({ type: 'delete', id: 'a', path: 'foo' })).toBe(true)
    expect(isOpComplete({ type: 'delete', id: 'a', path: '' })).toBe(false)
  })
})

describe('response-rewrite serializer — legacy script parsing', () => {
  it('parses existing move script from before refactor', () => {
    const script = '[{"mode":"move","path":"choices.0.message.content","dst":"choices.0.message.text"}]'
    const parsed = parseRule(script)
    const op = parsed.ops[0] as RenameOp
    expect(op.type).toBe('rename')
    expect(op.path).toBe('choices.0.message.content')
    expect(op.newName).toBe('text')
  })

  it('unknown modes fall back to raw op', () => {
    const script = '[{"mode":"set","path":"foo","value":"bar"}]'
    const parsed = parseRule(script)
    expect(parsed.ops[0].type).toBe('raw')
  })

  it('empty / invalid input returns empty form', () => {
    expect(parseRule('').ops).toEqual([])
    expect(parseRule('not json').ops).toEqual([])
    expect(parseRule('{}').ops).toEqual([])
    expect(parseRule('[]').ops).toEqual([])
  })
})