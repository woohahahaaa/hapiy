// 响应改写规则编辑器 — 表单状态与 script JSON 数组的双向转换。
//
// 表单只暴露 4 个高层操作 (rename / prefix / suffix / delete)，
// 内部把它们映射到后端 compileRewriteOp / compileRewriteChains 已经支持的
// mode：
//   - rename → mode=move        （move: 拷贝值到 dst，自动删除原 key）
//   - prefix → mode=first_prepend（流式首段前置；非流式由 applyRewriteOp 走
//                                  prepend 分支，行为等价）
//   - suffix → mode=last_append （流式末段追加；非流式走 append 分支）
//   - delete → mode=delete
//
// 后端契约在 project/backend/internal/relay/rewrite.go 的 compileRewriteChain /
// applyRewriteChains，以及 stream_rewrite.go 的 first_prepend/last_append
// 流式处理。脚本存储在 ResponseRewriteRule.script，仍是 JSON 数组字符串，
// 与请求改写脚本同形态。
//
// 旧规则里如果出现以上 4 类之外的 mode (set / ensure_prefix / trim_*
// 等)，仍允许加载但用 "raw" 类型呈现，用户编辑后会被原样回写。

export type SimpleOpType = 'rename' | 'prefix' | 'suffix' | 'delete'

export type RenameOp = {
  readonly type: 'rename'
  readonly id: string
  path: string
  newName: string
}

export type PrefixOp = {
  readonly type: 'prefix'
  readonly id: string
  path: string
  value: string
}

export type SuffixOp = {
  readonly type: 'suffix'
  readonly id: string
  path: string
  value: string
}

export type DeleteOp = {
  readonly type: 'delete'
  readonly id: string
  path: string
}

// 旧 / 高阶 op 的占位符：mode 不在 4 个简单类型里时使用，保留所有字段原样回写。
export type RawOp = {
  readonly type: 'raw'
  readonly id: string
  mode: string
  path: string
  value: string
  from: string
  to: string
  dst: string
}

export type Op = RenameOp | PrefixOp | SuffixOp | DeleteOp | RawOp

export type RuleForm = {
  ops: Op[]
}

// ── Factories ──

function makeId(): string {
  return `op-${Math.random().toString(36).slice(2, 10)}`
}

export function newOp(type: SimpleOpType): Op {
  switch (type) {
    case 'rename': return { type, id: makeId(), path: '', newName: '' }
    case 'prefix': return { type, id: makeId(), path: '', value: '' }
    case 'suffix': return { type, id: makeId(), path: '', value: '' }
    case 'delete': return { type, id: makeId(), path: '' }
  }
}

export function emptyRule(): RuleForm {
  return { ops: [] }
}

// ── Validate ──

export function isOpComplete(op: Op): boolean {
  if (!op.path.trim()) return false
  switch (op.type) {
    case 'rename': return op.newName.trim().length > 0
    case 'prefix':
    case 'suffix': return op.value.trim().length > 0
    case 'delete': return true
    case 'raw': return false // raw op 不参与保存（仅展示）
  }
}

export function hasAnyCompleteOp(ops: readonly Op[]): boolean {
  return ops.some(isOpComplete)
}

// ── Serialize ──

type JsonObject = Record<string, unknown>

function withHeaderPrefixStripped(path: string): string {
  // 响应改写只作用在 body，不支持 header. 前缀；保留原样即可。
  return path.trim()
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf('.')
  if (idx < 0) return ''
  return path.slice(0, idx)
}

function renameDst(path: string, newName: string): string {
  const parent = parentPath(path)
  return parent ? `${parent}.${newName}` : newName
}

function opToJson(op: Op): JsonObject | null {
  switch (op.type) {
    case 'rename': {
      if (!op.path.trim() || !op.newName.trim()) return null
      return { mode: 'move', path: withHeaderPrefixStripped(op.path), dst: renameDst(op.path.trim(), op.newName.trim()) }
    }
    case 'prefix': {
      if (!op.path.trim() || !op.value.trim()) return null
      return { mode: 'first_prepend', path: withHeaderPrefixStripped(op.path), value: op.value }
    }
    case 'suffix': {
      if (!op.path.trim() || !op.value.trim()) return null
      return { mode: 'last_append', path: withHeaderPrefixStripped(op.path), value: op.value }
    }
    case 'delete': {
      if (!op.path.trim()) return null
      return { mode: 'delete', path: withHeaderPrefixStripped(op.path) }
    }
    case 'raw': {
      // raw 不写入（用户必须显式转换为简单 op 后才能保存）
      return null
    }
  }
}

export function serializeRule(form: RuleForm): string {
  const out: JsonObject[] = []
  for (const op of form.ops) {
    const json = opToJson(op)
    if (json) out.push(json)
  }
  return JSON.stringify(out)
}

// ── Parse ──

function opFromJson(raw: unknown): Op | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as JsonObject
  const mode = typeof o.mode === 'string' ? o.mode.trim().toLowerCase() : ''
  const path = typeof o.path === 'string' ? o.path : ''
  if (!mode) return null

  switch (mode) {
    case 'move': {
      const dst = typeof o.dst === 'string' ? o.dst : ''
      if (!dst || dst === path) {
        return { type: 'raw', id: makeId(), mode, path, value: '', from: '', to: '', dst }
      }
      const parent = parentPath(path)
      const newName = parent
        ? (dst.startsWith(parent + '.') ? dst.slice(parent.length + 1) : '')
        : dst.includes('.') ? '' : dst
      if (!newName) {
        return { type: 'raw', id: makeId(), mode, path, value: '', from: '', to: '', dst }
      }
      return { type: 'rename', id: makeId(), path, newName }
    }
    case 'first_prepend':
      return { type: 'prefix', id: makeId(), path, value: typeof o.value === 'string' ? o.value : '' }
    case 'last_append':
      return { type: 'suffix', id: makeId(), path, value: typeof o.value === 'string' ? o.value : '' }
    case 'delete':
      return { type: 'delete', id: makeId(), path }
    default:
      return {
        type: 'raw',
        id: makeId(),
        mode,
        path,
        value: typeof o.value === 'string' ? o.value : '',
        from: typeof o.from === 'string' ? o.from : '',
        to: typeof o.to === 'string' ? o.to : '',
        dst: typeof o.dst === 'string' ? o.dst : '',
      }
  }
}

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

  const ops: Op[] = []
  for (const raw of parsed) {
    const op = opFromJson(raw)
    if (op) ops.push(op)
  }
  return { ops }
}

// ── Display ──

export const OP_TYPE_LABEL: Readonly<Record<SimpleOpType | 'raw', string>> = {
  rename: '重命名字段',
  prefix: '加前缀',
  suffix: '加后缀',
  delete: '删除字段',
  raw: '高级 / 旧操作',
}

export const SIMPLE_OP_TYPES: readonly SimpleOpType[] = ['rename', 'prefix', 'suffix', 'delete']