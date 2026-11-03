// React Flow 把「选中」记在节点/边对象自身的 selected 字段上，页面重建
// baseNodes / displayEdges 时这些字段会丢。拓扑刷新（状态轮询等）不该
// 清空用户已经做好的选择，所以重建后按当前选中的 id 重新打标。
type Selectable = { id: string; selected?: boolean }

export function withPreservedSelection<T extends Selectable>(
  next: T[],
  selectedIds: ReadonlySet<string>
): T[] {
  if (selectedIds.size === 0) return next
  return next.map((item) =>
    item.selected || !selectedIds.has(item.id)
      ? item
      : { ...item, selected: true }
  )
}
