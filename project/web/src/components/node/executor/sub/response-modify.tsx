import { ResponseModifySlotItem } from '@/components/topology/slot-items'
import type { ResponseModifySlotEntry, SlotItemDragProps } from '@/components/topology/slot-items'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'

export interface NodeExecutorResponseModifyProps extends SlotItemDragProps {
  entry: ResponseModifySlotEntry
  rules: readonly ResponseRewriteRule[]
  onChange: (next: ResponseModifySlotEntry) => void
  onDelete: () => void
}

// 响应改写业务节点：槽位内的一条响应改写条目。
export function NodeExecutorResponseModify({ entry, rules, onChange, onDelete, ...drag }: NodeExecutorResponseModifyProps) {
  return <ResponseModifySlotItem entry={entry} rules={rules} onChange={onChange} onDelete={onDelete} {...drag} />
}