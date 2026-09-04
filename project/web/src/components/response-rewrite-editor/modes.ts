// 响应改写编辑器 — 操作模式元数据。
//
// 与 project/backend/internal/relay/rewrite.go 的 compileRewriteOp 字段集合保持一致：
// move / first_prepend / last_append / delete 这 4 个 mode 把后端已支持的
// 流式首尾注入逻辑暴露给表单，不需要新增后端 mode。
//
// 请求改写的完整 mode 集在 src/components/rewrite-rule-editor/modes.ts 里。

export type ModeName = 'move' | 'first_prepend' | 'last_append' | 'delete'

export type ModeField = 'value'

export type ModeSpec = {
  readonly value: ModeName
  readonly label: string
  readonly needs: readonly ModeField[]
}

export const MODES: readonly ModeSpec[] = [
  { value: 'move', label: '重命名字段 (move)', needs: ['value'] },
  { value: 'first_prepend', label: '加前缀 (first_prepend)', needs: ['value'] },
  { value: 'last_append', label: '加后缀 (last_append)', needs: ['value'] },
  { value: 'delete', label: '删除字段 (delete)', needs: [] },
]

export const MODE_BY_VALUE: ReadonlyMap<ModeName, ModeSpec> = new Map(
  MODES.map((m) => [m.value, m]),
)