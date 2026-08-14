// 改写规则编辑器 — 表单状态与 script JSON 数组的双向转换。
//
// 契约：
//   - 表单 blocks 是"组"，每组自带 conditions；序列化时把组内 conditions 合并到每条 action.conditions。
//   - 路径字段在表单里不带 `header.` 前缀：当 scope=header 时，序列化时补上、反序列化时剥掉；
//     scope=body 或 scope=all 时路径原样保留（允许用户在 all 模式下手动写 `header.X-Foo`）。
//   - 空 / 不合法的 action 在序列化时被丢弃；空的 block 也丢弃；最终空数组输出为 "[]"。
//   - 不合法的 script（顶层不是数组、解析失败）反序列化时回退到一个空 block。
//
// 后端契约在 project/backend/internal/relay/rewrite.go 的 compileRewriteChain / applyRewriteChains。

import { MODE_BY_VALUE, type ModeName, type Scope } from './modes'

export type Condition = {
  path: string
  op: string
  value: string
  invert: boolean
  scope: Scope
}

export type Action = {
  mode: ModeName | ''
  path: string
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
  conditions: Condition[]
  actions: Action[]
}

export type RuleForm = {
  blocks: Block[]
}

export const HEADER_PREFIX = 'header.'

// ── Form factory ──

export function emptyAction(): Action {
  return { mode: '', path: '', value: '', from: '', to: '', dst: '', scope: 'all' }
}

export function emptyCondition(): Condition {
  return { path: '', op: 'contains', value: '', invert: false, scope: 'all' }
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
    if (f === 'value' && !a.value.trim()) return false
    if (f === 'from' && !a.from.trim()) return false
    if (f === 'to' && !a.to.trim()) return false
    if (f === 'dst' && !a.dst.trim()) return false
  }
  return true
}

export function isConditionValid(c: Condition): boolean {
  return Boolean(c.path.trim()) && Boolean(c.op.trim())
}

// ── Serialize: form → script JSON array string ──

export function serializeRule(form: RuleForm): string {
  const out: JsonObject[] = []
  for (const block of form.blocks) {
    const blockConds = block.conditions.filter(isConditionValid).map(conditionToJson)
    const blockCondsKey = JSON.stringify(blockConds)
    const validActions = block.actions.filter(isActionValid)
    if (validActions.length === 0) continue
    for (const a of validActions) {
      out.push(actionToJson(a, blockCondsKey ? blockConds : []))
    }
  }
  return JSON.stringify(out)
}

function conditionToJson(c: Condition): JsonObject {
  const o: JsonObject = { path: withHeaderPrefix(c.path.trim(), c.scope), op: c.op.trim(), value: c.value }
  if (c.invert) o.invert = true
  if (c.scope !== 'all') o.scope = c.scope
  return o
}

function actionToJson(a: Action, conditions: JsonObject[]): JsonObject {
  const mode = a.mode.trim() as ModeName
  const op: JsonObject = { mode, path: withHeaderPrefix(a.path.trim(), a.scope) }
  const spec = MODE_BY_VALUE.get(mode)!
  for (const f of spec.needs) {
    op[f] = a[f].trim()
  }
  if (a.scope !== 'all') op.scope = a.scope
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
    const key = JSON.stringify(conds)
    if (currentBlock && key === currentKey) {
      currentBlock.actions.push(action)
    } else {
      seq += 1
      currentBlock = { id: `rule-${seq}`, conditions: conds, actions: [action] }
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
  const scope = parseScope(op.scope)
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
    a[f] = typeof op[f] === 'string' ? op[f] : ''
  }
  return a
}

function parseScope(v: unknown): Scope {
  if (v === 'header' || v === 'body') return v
  return 'all'
}

function stripHeaderPrefix(path: string, scope: Scope): string {
  if (scope === 'header' && path.startsWith(HEADER_PREFIX)) {
    return path.slice(HEADER_PREFIX.length)
  }
  return path
}

function conditionsFromJson(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return []
  const out: Condition[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const c = item as JsonObject
    const op = typeof c.op === 'string' ? c.op : ''
    // 嵌套 AND/OR 节点只展示在「编辑 JSON」中，结构化编辑器扁平化跳过。
    if ('logic' in c || !op) continue
    const scope = parseScope(c.scope)
    out.push({
      path: stripHeaderPrefix(typeof c.path === 'string' ? c.path : '', scope),
      op,
      value: typeof c.value === 'string' ? c.value : '',
      invert: c.invert === true,
      scope,
    })
  }
  return out
}

// ── Helpers ──

type JsonObject = Record<string, unknown>