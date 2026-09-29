// 改写规则编辑器 — 操作模式与条件运算符的元数据。
// 与 project/backend/internal/relay/rewrite.go 的 compileRewriteOp / compileConditionLeaf
// 字段集合保持一致：新增 mode 或 op 必须后端先支持，这里才能暴露。

import { i18n } from '@/i18n/i18n'

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
  { value: 'set', label: i18n.t('rewrite:mode.set'), needs: ['value'] },
  { value: 'delete', label: i18n.t('rewrite:mode.delete'), needs: [] },
  { value: 'append', label: i18n.t('rewrite:mode.append'), needs: ['value'] },
  { value: 'prepend', label: i18n.t('rewrite:mode.prepend'), needs: ['value'] },
  { value: 'first_prepend', label: i18n.t('rewrite:mode.firstPrepend'), needs: ['value'] },
  { value: 'last_append', label: i18n.t('rewrite:mode.lastAppend'), needs: ['value'] },
  { value: 'trim_prefix', label: i18n.t('rewrite:mode.trimPrefix'), needs: ['value'] },
  { value: 'trim_suffix', label: i18n.t('rewrite:mode.trimSuffix'), needs: ['value'] },
  { value: 'ensure_prefix', label: i18n.t('rewrite:mode.ensurePrefix'), needs: ['value'] },
  { value: 'ensure_suffix', label: i18n.t('rewrite:mode.ensureSuffix'), needs: ['value'] },
  { value: 'trim_space', label: i18n.t('rewrite:mode.trimSpace'), needs: [] },
  { value: 'to_lower', label: i18n.t('rewrite:mode.toLower'), needs: [] },
  { value: 'to_upper', label: i18n.t('rewrite:mode.toUpper'), needs: [] },
  { value: 'replace', label: i18n.t('rewrite:mode.replace'), needs: ['from', 'to'] },
  { value: 'regex_replace', label: i18n.t('rewrite:mode.regexReplace'), needs: ['from', 'to'] },
  { value: 'move', label: i18n.t('rewrite:mode.move'), needs: ['dst'] },
  { value: 'copy', label: i18n.t('rewrite:mode.copy'), needs: ['dst'] },
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
  { value: 'contains', label: i18n.t('rewrite:condOp.contains') },
  { value: 'prefix', label: i18n.t('rewrite:condOp.prefix') },
  { value: 'suffix', label: i18n.t('rewrite:condOp.suffix') },
  { value: 'eq', label: i18n.t('rewrite:condOp.eq') },
  { value: 'neq', label: i18n.t('rewrite:condOp.neq') },
  { value: 'gt', label: i18n.t('rewrite:condOp.gt') },
  { value: 'gte', label: i18n.t('rewrite:condOp.gte') },
  { value: 'lt', label: i18n.t('rewrite:condOp.lt') },
  { value: 'lte', label: i18n.t('rewrite:condOp.lte') },
  { value: 'matches', label: i18n.t('rewrite:condOp.matches') },
]

// 作用域二选一：header 或 body。不做合并模式（路径会分不清域）；
// 后端仍兼容历史数据的 scope="all" / 缺省，加载时按路径的 header. 前缀推断。
export type Scope = 'header' | 'body'

export const SCOPE_OPTIONS: ReadonlyArray<{ value: Scope; label: string }> = [
  { value: 'header', label: 'header' },
  { value: 'body', label: 'body' },
]