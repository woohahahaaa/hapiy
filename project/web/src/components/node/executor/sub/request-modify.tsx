import { RequestModifySlotItem } from '@/components/topology/slot-items'
import type { RequestModifySlotEntry, SlotItemDragProps } from '@/components/topology/slot-items'
import type { RewriteRule } from '@/lib/dashboard-api'

export interface NodeExecutorRequestModifyProps extends SlotItemDragProps {
  entry: RequestModifySlotEntry
  rules: readonly RewriteRule[]
  onChange: (next: RequestModifySlotEntry) => void
  onDelete: () => void
}

// 请求改写业务节点：槽位内的一条请求改写条目。
export function NodeExecutorRequestModify({ entry, rules, onChange, onDelete, ...drag }: NodeExecutorRequestModifyProps) {
  return <RequestModifySlotItem entry={entry} rules={rules} onChange={onChange} onDelete={onDelete} {...drag} />
}