import { AutoReplySlotItem } from '@/components/topology/slot-items'
import type { AutoReplySlotEntry, SlotItemDragProps } from '@/components/topology/slot-items'
import type { HeartbeatRule } from '@/lib/dashboard-api'

export interface NodeExecutorAutoReplyProps extends SlotItemDragProps {
  entry: AutoReplySlotEntry
  rules: readonly HeartbeatRule[]
  onChange: (next: AutoReplySlotEntry) => void
  onDelete: () => void
}

// 心跳回复业务节点：槽位内的一条心跳回复条目。
export function NodeExecutorAutoReply({ entry, rules, onChange, onDelete, ...drag }: NodeExecutorAutoReplyProps) {
  return <AutoReplySlotItem entry={entry} rules={rules} onChange={onChange} onDelete={onDelete} {...drag} />
}