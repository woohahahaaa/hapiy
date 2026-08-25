import { ConcurrencySlotItem } from '@/components/topology/slot-items'
import type { ConcurrencySlotEntry, SlotItemDragProps } from '@/components/topology/slot-items'
import type { ConcurrencyRule } from '@/lib/dashboard-api'

export interface NodeExecutorConcurrencyProps extends SlotItemDragProps {
  entry: ConcurrencySlotEntry
  rules: readonly ConcurrencyRule[]
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

// 并发控制业务节点：槽位内的一条并发控制条目。
export function NodeExecutorConcurrency({ entry, rules, onChange, onDelete, ...drag }: NodeExecutorConcurrencyProps) {
  return <ConcurrencySlotItem entry={entry} rules={rules} onChange={onChange} onDelete={onDelete} {...drag} />
}