// 改写规则编辑器 — 操作模式与条件运算符的元数据。
// 与 project/backend/internal/relay/rewrite.go 的 compileRewriteOp / compileConditionLeaf
// 字段集合保持一致：新增 mode 或 op 必须后端先支持，这里才能暴露。

export type ModeName =
  | 'set'
  | 'delete'
  | 'append'
  | 'prepend'
  | 'first_prepend'
  | 'last_append'
  | 'trim_prefix'
  | 'trim_suffix'
  | 'ensure_prefix'
  | 'ensure_suffix'
  | 'trim_space'
  | 'to_lower'
  | 'to_upper'
  | 'replace'
  | 'regex_replace'
  | 'move'
  | 'copy'

export type ModeField = 'value' | 'from' | 'to' | 'dst'

export type ModeSpec = {
  readonly value: ModeName
  readonly label: string
  readonly needs: readonly ModeField[]
}

export const MODES: readonly ModeSpec[] = [
  { value: 'set', label: '设置值 (set)', needs: ['value'] },
  { value: 'delete', label: '删除字段 (delete)', needs: [] },
  { value: 'append', label: '追加字符串 (append)', needs: ['value'] },
  { value: 'prepend', label: '前置字符串 (prepend)', needs: ['value'] },
  { value: 'first_prepend', label: '流式首段前置 (first_prepend)', needs: ['value'] },
  { value: 'last_append', label: '流式末段追加 (last_append)', needs: ['value'] },
  { value: 'trim_prefix', label: '去除前缀 (trim_prefix)', needs: ['value'] },
  { value: 'trim_suffix', label: '去除后缀 (trim_suffix)', needs: ['value'] },
  { value: 'ensure_prefix', label: '确保前缀 (ensure_prefix)', needs: ['value'] },
  { value: 'ensure_suffix', label: '确保后缀 (ensure_suffix)', needs: ['value'] },
  { value: 'trim_space', label: '去首尾空白 (trim_space)', needs: [] },
  { value: 'to_lower', label: '转小写 (to_lower)', needs: [] },
  { value: 'to_upper', label: '转大写 (to_upper)', needs: [] },
  { value: 'replace', label: '字符串替换 (replace)', needs: ['from', 'to'] },
  { value: 'regex_replace', label: '正则替换 (regex_replace)', needs: ['from', 'to'] },
  { value: 'move', label: '重命名/移动 (move)', needs: ['dst'] },
  { value: 'copy', label: '复制 (copy)', needs: ['dst'] },
]

export const MODE_BY_VALUE: ReadonlyMap<ModeName, ModeSpec> = new Map(
  MODES.map((m) => [m.value, m]),
)

export type CondOpName =
  | 'contains'
  | 'prefix'
  | 'suffix'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'matches'

export const COND_OPS: ReadonlyArray<{ value: CondOpName; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'prefix', label: '以前缀开头' },
  { value: 'suffix', label: '以后缀结尾' },
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'matches', label: '正则匹配' },
]

// 作用域二选一：header 或 body。不做合并模式（路径会分不清域）；
// 后端仍兼容历史数据的 scope="all" / 缺省，加载时按路径的 header. 前缀推断。
export type Scope = 'header' | 'body'

export const SCOPE_OPTIONS: ReadonlyArray<{ value: Scope; label: string }> = [
  { value: 'header', label: 'header' },
  { value: 'body', label: 'body' },
]