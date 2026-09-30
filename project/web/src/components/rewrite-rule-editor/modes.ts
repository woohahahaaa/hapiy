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
  { value: 'set', get label() { return i18n.t('rewrite:mode.set') }, needs: ['value'] },
  { value: 'delete', get label() { return i18n.t('rewrite:mode.delete') }, needs: [] },
  { value: 'append', get label() { return i18n.t('rewrite:mode.append') }, needs: ['value'] },
  { value: 'prepend', get label() { return i18n.t('rewrite:mode.prepend') }, needs: ['value'] },
  { value: 'first_prepend', get label() { return i18n.t('rewrite:mode.firstPrepend') }, needs: ['value'] },
  { value: 'last_append', get label() { return i18n.t('rewrite:mode.lastAppend') }, needs: ['value'] },
  { value: 'trim_prefix', get label() { return i18n.t('rewrite:mode.trimPrefix') }, needs: ['value'] },
  { value: 'trim_suffix', get label() { return i18n.t('rewrite:mode.trimSuffix') }, needs: ['value'] },
  { value: 'ensure_prefix', get label() { return i18n.t('rewrite:mode.ensurePrefix') }, needs: ['value'] },
  { value: 'ensure_suffix', get label() { return i18n.t('rewrite:mode.ensureSuffix') }, needs: ['value'] },
  { value: 'trim_space', get label() { return i18n.t('rewrite:mode.trimSpace') }, needs: [] },
  { value: 'to_lower', get label() { return i18n.t('rewrite:mode.toLower') }, needs: [] },
  { value: 'to_upper', get label() { return i18n.t('rewrite:mode.toUpper') }, needs: [] },
  { value: 'replace', get label() { return i18n.t('rewrite:mode.replace') }, needs: ['from', 'to'] },
  { value: 'regex_replace', get label() { return i18n.t('rewrite:mode.regexReplace') }, needs: ['from', 'to'] },
  { value: 'move', get label() { return i18n.t('rewrite:mode.move') }, needs: ['dst'] },
  { value: 'copy', get label() { return i18n.t('rewrite:mode.copy') }, needs: ['dst'] },
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
  { value: 'contains', get label() { return i18n.t('rewrite:condOp.contains') } },
  { value: 'prefix', get label() { return i18n.t('rewrite:condOp.prefix') } },
  { value: 'suffix', get label() { return i18n.t('rewrite:condOp.suffix') } },
  { value: 'eq', get label() { return i18n.t('rewrite:condOp.eq') } },
  { value: 'neq', get label() { return i18n.t('rewrite:condOp.neq') } },
  { value: 'gt', get label() { return i18n.t('rewrite:condOp.gt') } },
  { value: 'gte', get label() { return i18n.t('rewrite:condOp.gte') } },
  { value: 'lt', get label() { return i18n.t('rewrite:condOp.lt') } },
  { value: 'lte', get label() { return i18n.t('rewrite:condOp.lte') } },
  { value: 'matches', get label() { return i18n.t('rewrite:condOp.matches') } },
]

// 作用域二选一：header 或 body。不做合并模式（路径会分不清域）；
// 后端仍兼容历史数据的 scope="all" / 缺省，加载时按路径的 header. 前缀推断。
export type Scope = 'header' | 'body'

export const SCOPE_OPTIONS: ReadonlyArray<{ value: Scope; label: string }> = [
  { value: 'header', label: 'header' },
  { value: 'body', label: 'body' },
]