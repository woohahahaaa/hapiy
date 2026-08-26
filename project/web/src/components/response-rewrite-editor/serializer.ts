// 响应改写规则编辑器 — 表单状态与 script JSON 数组的双向转换。
//
// 契约（与请求改写 serializer 同形态，conditions 结构与后端
// rewrite.go 的 compileConditions 一致，支持嵌套 AND/OR）：
//   - 表单 blocks 是"规则组"，每组带 conditions + actions。
//   - 空 / 不合法的 action 在序列化时被丢弃；空的 block 也丢弃；最终空数组输出为 "[]"。
//   - 不合法的 script（顶层不是数组、解析失败）反序列化时回退到一个空 block。
//
// 后端契约在 project/backend/internal/relay/rewrite.go 的 compileRewriteChain /
// applyRewriteChains。流式首尾注入由 stream_rewrite.go 的 first_prepend / last_append
// 自动覆盖。

import { MODE_BY_VALUE, type ModeName } from './modes'
import {
  type Condition,
  type ConditionGroup,
  type LeafCondition,
  conditionToJson,
  conditionsFromJson,
  emptyCondition,
  emptyConditionGroup,
  isConditionValid,
} from '../rewrite-rule-editor/serializer'

export type { Condition, ConditionGroup, LeafCondition }

export type Action = {
  mode: ModeName | ''
  path: string
  value: string
}

export type Block = {
  id: string
  conditionLogic?: 'AND' | 'OR'
  conditions: Condition[]
  actions: Action[]
}

export type RuleForm = {
  blocks: Block[]
}

// ── Form factory ──

export function emptyAction(): Action {
  return { mode: 'move', path: '', value: '' }
}

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

export function isActionValid(a: Action): boolean {
  const mode = a.mode.trim()
  if (!mode || !MODE_BY_VALUE.has(mode as ModeName)) return false
  if (!a.path.trim()) return false
  const spec = MODE_BY_VALUE.get(mode as ModeName)!
  for (const f of spec.needs) {
    if (!a[f].trim()) return false
  }
  return true
}

export function hasAnyCompleteBlock(blocks: readonly Block[]): boolean {
  return blocks.some((b) => b.actions.some(isActionValid))
}

// ── Serialize: form → script JSON array string ──

type JsonObject = Record<string, unknown>

function actionToJson(a: Action, conditions: JsonObject[]): JsonObject {
  const mode = a.mode.trim() as ModeName
  const op: JsonObject = { mode, path: a.path.trim() }
  if (mode === 'delete') {
    // no-op
  } else if (mode === 'move') {
    op.dst = a.value
  } else {
    op.value = a.value
  }
  if (conditions.length > 0) op.conditions = conditions
  return op
}

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
    for (const a of validActions) {
      out.push(actionToJson(a, blockCondsKey ? emittedConds : []))
    }
  }
  return JSON.stringify(out)
}

// ── Parse: script JSON array string → form ──

export function parseRule(script: string): RuleForm {
  const fallback = emptyRule()
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
  let currentBlock: Block | null = null
  let currentKey: string | null = null
  let seq = 0

  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const op = raw as JsonObject
    const action = actionFromJson(op)
    if (!action) continue
    const conds = conditionsFromJson(op.conditions)
    let conditionLogic: 'AND' | 'OR' | undefined
    let blockConds = conds
    if (conds.length === 1 && 'children' in conds[0]) {
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
  const mode = typeof op.mode === 'string' ? op.mode.trim().toLowerCase() : ''
  if (!mode || !MODE_BY_VALUE.has(mode as ModeName)) return null
  const typedMode = mode as ModeName
  const path = typeof op.path === 'string' ? op.path : ''
  if (!path) return null
  const raw = typedMode === 'move'
    ? (typeof op.dst === 'string' ? op.dst : '')
    : (typeof op.value === 'string' ? op.value : '')
  return { mode: typedMode, path, value: raw }
}