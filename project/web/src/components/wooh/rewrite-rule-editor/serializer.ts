// 改写规则编辑器 — 表单状态与 script JSON 数组的双向转换。
//
// 契约：
//   - 表单 blocks 是"组"，每组自带 conditions；序列化时把组内 conditions 合并到每条 action.conditions。
//   - 路径字段在表单里不带 `header.` 前缀：scope=header 时序列化补上、反序列化剥掉。
//     历史数据里的 scope="all" / 缺省按路径前缀推断（`header.` → header，否则 body）。
//   - 空 / 不合法的 action 在序列化时被丢弃；空的 block 也丢弃；最终空数组输出为 "[]"。
//   - set 的 value 遵循「引号约定」：true/false/null/数字（仅 body scope）是原生 JSON
//     字面量；不带引号的其余裸文本是变量引用（原始请求里的同域值）；字符串必须写成带
//     引号的 JSON 形式（如 "hello"）。引用在脚本里存成 {"ref":"<name>"}。详见 parseValueInput。
//   - 条件值沿用旧约定：字面量 + 带引号字符串，裸文本不合法、序列化时丢弃。
//   - 不合法的 script（顶层不是数组、解析失败）反序列化时回退到一个空 block。
//
// 后端契约在 project/backend/internal/relay/rewrite.go 的 compileRewriteChain / applyRewriteChains。

import { MODE_BY_VALUE, type ModeName, type Scope } from './modes'

export type LeafCondition = {
  path: string
  op: string
  value: string
  invert: boolean
  scope: Scope
}

export type ConditionGroup = {
  logic: 'AND' | 'OR'
  children: Condition[]
}

// conditions 数组元素：叶子（path/op/value）或组合节点（logic + children）。
// 组合节点对应后端 {"logic":"AND"|"OR","children":[...]}，可任意嵌套。
export type Condition = LeafCondition | ConditionGroup

export type Action = {
  mode: ModeName | ''
  path: string
  /** 原始输入文本；语义由 parseValueInput 按约定解析（字面量 / 带引号字符串 / 不合法）。 */
  value: string
  from: string
  to: string
  dst: string
  scope: Scope
}

export type Block = {
  /** 客户端稳定 ID，格式 `rule-N`（N 是创建序号）；用于绑定 UI 显示的「规则 N」标签，
   * 拖拽重排后 ID 跟随原 block，不随位置变化。 */
  id: string
  /** 顶层条件的连接方式。序列化时 OR 会包装成 {"logic":"OR","children":[...]} 单组；
   * AND 保持平铺数组（后端数组即 AND 语义）。 */
  conditionLogic?: 'AND' | 'OR'
  conditions: Condition[]
  actions: Action[]
}

export type RuleForm = {
  blocks: Block[]
}

export const HEADER_PREFIX = 'header.'

// ── Value input convention ──

export type ParsedValueInput =
  | { kind: 'literal'; json: boolean | number | null }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; ref: string }
  | { kind: 'invalid' }

export type ValueInputOptions = {
  /** true/false/null/数字 token 是否按原生 JSON 字面量解析（默认 true）。 */
  literals?: boolean
  /** 不带引号的裸文本是否按变量引用解析（默认 false）。 */
  refs?: boolean
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

// 引号约定：
//   - true/false/null/数字 token（literals=true 时）→ 原生 JSON 字面量
//   - 裸文本（refs=true 时）→ 变量引用，引用原始请求里的同域值
//   - 带引号且能 JSON.parse 出字符串的 token（如 "hello"）→ 固定字符串（去引号）
//   - 其余（空文本 / 含引号但不合法）→ invalid
export function parseValueInput(text: string, opts: ValueInputOptions = {}): ParsedValueInput {
  const literals = opts.literals ?? true
  const refs = opts.refs ?? false
  const t = text.trim()
  if (literals) {
    if (t === 'true') return { kind: 'literal', json: true }
    if (t === 'false') return { kind: 'literal', json: false }
    if (t === 'null') return { kind: 'literal', json: null }
    if (NUMBER_PATTERN.test(t)) return { kind: 'literal', json: Number(t) }
  }
  if (t.includes('"')) {
    // 含引号即视为「想写字符串」：必须是合法的带引号 JSON 字符串，否则 invalid。
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        const v: unknown = JSON.parse(t)
        if (typeof v === 'string') return { kind: 'string', value: v }
      } catch {
        // 引号包裹但不是合法 JSON 字符串 → 落到 invalid
      }
    }
    return { kind: 'invalid' }
  }
  if (refs && t !== '') return { kind: 'ref', ref: t }
  return { kind: 'invalid' }
}

// set 模式且值走引号约定；其余模式（append/replace 等）保持纯字符串语义。
export function valueConventionActive(a: Action): boolean {
  return a.mode === 'set'
}

// header 的值本质是字符串，不解析 JSON 字面量（不带引号的 123 也是变量名）。
export function allowJsonLiterals(a: Action): boolean {
  return a.scope === 'body'
}

// action set 值的解析入口：refs 恒可用，字面量由 scope 决定。
export function parseActionValue(a: Action, text: string): ParsedValueInput {
  return parseValueInput(text, { literals: allowJsonLiterals(a), refs: true })
}

// ── Form factory ──

export function emptyAction(): Action {
  return { mode: 'set', path: '', value: '', from: '', to: '', dst: '', scope: 'body' }
}

export function emptyCondition(): LeafCondition {
  return { path: '', op: 'contains', value: '', invert: false, scope: 'body' }
}

export function emptyConditionGroup(): ConditionGroup {
  return { logic: 'AND', children: [emptyCondition()] }
}

// 计算下一个可用的 rule-N ID：扫一遍已有 blocks，找最大的 N，N+1 返回。
// 同时容忍旧 blocks 没有 id 字段（兜底返回 rule-1）。
function nextRuleId(blocks: readonly Block[]): string {
  let max = 0
  for (const b of blocks) {
    const m = /^rule-(\d+)$/.exec(b.id)
    if (m) {
      const n = Number(m[1])
      if (n > max) max = n
    }
  }
  return `rule-${max + 1}`
}

export function emptyBlock(existing: readonly Block[] = []): Block {
  return { id: nextRuleId(existing), conditions: [], actions: [emptyAction()] }
}

export function emptyRule(): RuleForm {
  return { blocks: [emptyBlock()] }
}

// ── Validate ──

// action 是否携带足够信息以被序列化进 script；用于过滤空行 / 半填行。
export function isActionValid(a: Action): boolean {
  const mode = a.mode.trim()
  if (!mode || !MODE_BY_VALUE.has(mode as ModeName)) return false
  if (!a.path.trim()) return false
  const spec = MODE_BY_VALUE.get(mode as ModeName)!
  for (const f of spec.needs) {
    if (f === 'value') {
      if (valueConventionActive(a)) {
        // 引号约定：非空且能解析（字面量 / 固定字符串 / 变量引用）。
        if (!a.value.trim() || parseActionValue(a, a.value).kind === 'invalid') return false
      } else if (!a.value.trim()) {
        // 非 set 模式：纯字符串语义，非空即可。
        return false
      }
    } else if (f === 'from' && !a.from.trim()) {
      return false
    } else if (f === 'to' && !a.to.trim()) {
      return false
    } else if (f === 'dst' && !a.dst.trim()) {
      return false
    }
  }
  return true
}

export function isConditionValid(c: Condition): boolean {
  if ('children' in c) {
    if (c.children.length === 0) return false
    return c.children.some(isConditionValid)
  }
  // 条件值永远走字面量约定：必须非空且可解析（parseValueInput 对空文本返回 invalid）。
  return Boolean(c.path.trim()) && Boolean(c.op.trim()) && parseValueInput(c.value).kind !== 'invalid'
}

export function isConditionLeaf(c: Condition): c is LeafCondition {
  return !('children' in c)
}

// ── Serialize: form → script JSON array string ──

export function serializeRule(form: RuleForm): string {
  const out: JsonObject[] = []
  for (const block of form.blocks) {
    const blockConds = block.conditions.filter(isConditionValid).map(conditionToJson)
    let emittedConds = blockConds
    if (block.conditionLogic === 'OR' && blockConds.length > 0) {
      emittedConds = [{ logic: 'OR', children: blockConds }]
    }
    const blockCondsKey = JSON.stringify(emittedConds)
    const validActions = block.actions.filter(isActionValid)
    if (validActions.length === 0) continue
    for (const a of validActions) {
      out.push(actionToJson(a, blockCondsKey ? emittedConds : []))
    }
  }
  return JSON.stringify(out)
}

export function conditionToJson(c: Condition): JsonObject {
  if ('children' in c) {
    const children = c.children.filter(isConditionValid).map(conditionToJson)
    const o: JsonObject = { logic: c.logic }
    if (children.length > 0) o.children = children
    return o
  }
  // 条件值永远走字面量约定：字面量 → 原生 JSON，带引号字符串 → 去引号内容。
  const o: JsonObject = { path: withHeaderPrefix(c.path.trim(), c.scope), op: c.op.trim() }
  const parsed = parseValueInput(c.value)
  if (parsed.kind === 'literal') {
    o.value = parsed.json
  } else if (parsed.kind === 'string') {
    o.value = parsed.value
  } else {
    // invalid：isConditionValid 已过滤，这里兜底保持原文本。
    o.value = c.value
  }
  if (c.invert) o.invert = true
  o.scope = c.scope
  return o
}

function actionToJson(a: Action, conditions: JsonObject[]): JsonObject {
  const mode = a.mode.trim() as ModeName
  const op: JsonObject = { mode, path: withHeaderPrefix(a.path.trim(), a.scope) }
  const spec = MODE_BY_VALUE.get(mode)!
  for (const f of spec.needs) {
    if (f === 'value' && valueConventionActive(a)) {
      const parsed = parseActionValue(a, a.value)
      if (parsed.kind === 'literal') {
        op.value = parsed.json
      } else if (parsed.kind === 'string') {
        op.value = parsed.value
      } else if (parsed.kind === 'ref') {
        op.value = { ref: parsed.ref }
      } else {
        // invalid/空：isActionValid 已过滤，这里兜底原文本。
        op.value = a.value.trim()
      }
    } else {
      op[f] = a[f].trim()
    }
  }
  op.scope = a.scope
  if (conditions.length > 0) op.conditions = conditions
  return op
}

function withHeaderPrefix(path: string, scope: Scope): string {
  if (scope !== 'header') return path
  if (path.startsWith(HEADER_PREFIX)) return path
  return HEADER_PREFIX + path
}

// ── Parse: script JSON array string → form ──

export function parseRule(script: string): RuleForm {
  const fallback: RuleForm = emptyRule()
  const trimmed = (script || '').trim()
  if (!trimmed) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return fallback
  }
  if (!Array.isArray(parsed)) return fallback

  const blocks: Block[] = []
  let currentKey: string | null = null
  let currentBlock: Block | null = null
  let seq = 0

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const op = raw as JsonObject
    const action = actionFromJson(op)
    if (!action) continue
    const conds = conditionsFromJson(op.conditions)
    // 顶层 OR 包装（单组）拆回 conditionLogic，让 UI 显示为顶层 AND/OR 切换；
    // AND 包装保留为组卡片，避免拆开后丢失包装结构。
    let conditionLogic: 'AND' | 'OR' | undefined
    let blockConds = conds
    if (conds.length === 1 && 'children' in conds[0] && conds[0].logic === 'OR') {
      conditionLogic = conds[0].logic
      blockConds = conds[0].children
    }
    const key = JSON.stringify(blockConds)
    if (currentBlock && key === currentKey) {
      currentBlock.actions.push(action)
    } else {
      seq += 1
      currentBlock = { id: `rule-${seq}`, conditionLogic, conditions: blockConds, actions: [action] }
      blocks.push(currentBlock)
      currentKey = key
    }
  }

  if (blocks.length === 0) return fallback
  return { blocks }
}

function actionFromJson(op: JsonObject): Action | null {
  const mode = typeof op.mode === 'string' ? op.mode.trim() : ''
  if (!mode || !MODE_BY_VALUE.has(mode as ModeName)) return null
  const typedMode = mode as ModeName
  const rawPath = typeof op.path === 'string' ? op.path : ''
  const scope = inferScope(op.scope, rawPath)
  const path = stripHeaderPrefix(rawPath, scope)
  const spec = MODE_BY_VALUE.get(typedMode)!
  const a: Action = {
    mode: typedMode,
    path,
    value: '',
    from: '',
    to: '',
    dst: '',
    scope,
  }
  for (const f of spec.needs) {
    if (f === 'value' && valueConventionActive(a)) {
      a.value = actionValueDisplay(op.value)
    } else {
      a[f] = typeof op[f] === 'string' ? op[f] : ''
    }
  }
  return a
}

// JSON value → 输入框显示文本：字符串带引号显示（round-trip 后仍按约定识别为字符串），
// {"ref":"..."} 显示为裸变量名，boolean/number/null 用 token 文本，
// 其余（缺失/对象/数组）留空。
function actionValueDisplay(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as JsonObject
    const ref = o.ref
    if (typeof ref === 'string' && Object.keys(o).length === 1) return ref
    return ''
  }
  return literalValueDisplay(v)
}

// JSON value → 条件值显示文本：字符串带引号显示，boolean/number/null 用 token 文本，
// 其余（缺失/对象/数组）留空。
function literalValueDisplay(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (v === null) return 'null'
  return ''
}

// scope 解析：显式的 header/body 直接用；历史数据（"all" / 缺省 / 未知）按路径
// 的 header. 前缀推断——去掉 all 之后，域完全由 scope 决定。
function inferScope(v: unknown, path: string): Scope {
  if (v === 'header' || v === 'body') return v
  return path.startsWith(HEADER_PREFIX) ? 'header' : 'body'
}

function stripHeaderPrefix(path: string, scope: Scope): string {
  if (scope === 'header' && path.startsWith(HEADER_PREFIX)) {
    return path.slice(HEADER_PREFIX.length)
  }
  return path
}

export function conditionsFromJson(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return []
  const out: Condition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const c = item as JsonObject
    // 组合节点：{"logic":"AND"|"OR","children":[...]}，递归解析子条件。
    if (typeof c.logic === 'string') {
      const logic = c.logic.toUpperCase()
      if (logic !== 'AND' && logic !== 'OR') continue
      const children = conditionsFromJson(c.children)
      if (children.length === 0) continue
      out.push({ logic, children })
      continue
    }
    const op = typeof c.op === 'string' ? c.op : ''
    if (!op) continue
    const rawPath = typeof c.path === 'string' ? c.path : ''
    const scope = inferScope(c.scope, rawPath)
    out.push({
      path: stripHeaderPrefix(rawPath, scope),
      op,
      value: literalValueDisplay(c.value),
      invert: c.invert === true,
      scope,
    })
  }
  return out
}

// ── Helpers ──

type JsonObject = Record<string, unknown>