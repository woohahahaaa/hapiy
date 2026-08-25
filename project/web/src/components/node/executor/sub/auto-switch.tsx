import { AutoSwitchSlotItem } from '@/components/topology/slot-items'
import type { AutoSwitchSlotEntry, SlotItemDragProps } from '@/components/topology/slot-items'
import type { FailoverRule } from '@/lib/dashboard-api'

export interface NodeExecutorAutoSwitchProps extends SlotItemDragProps {
  entry: AutoSwitchSlotEntry
  rules: readonly FailoverRule[]
  onChange: (next: AutoSwitchSlotEntry) => void
  onDelete: () => void
}

// 自动禁用业务节点：槽位内的一条自动禁用（故障转移）规则条目。
export function NodeExecutorAutoSwitch({ entry, rules, onChange, onDelete, ...drag }: NodeExecutorAutoSwitchProps) {
  return <AutoSwitchSlotItem entry={entry} rules={rules} onChange={onChange} onDelete={onDelete} {...drag} />
}