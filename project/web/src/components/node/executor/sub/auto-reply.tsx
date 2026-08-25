import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { AutoReplySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { HeartbeatRule } from '@/lib/dashboard-api'

export interface NodeExecutorAutoReplyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: AutoReplySlotEntry
  rules: readonly HeartbeatRule[]
  onChange: (next: AutoReplySlotEntry) => void
  onDelete: () => void
}

// 心跳回复业务节点：槽位内的一条心跳回复条目（绑定心跳规则）。
export function NodeExecutorAutoReply({ entry, rules, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorAutoReplyProps) {
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      token={token}
      picked={picked}
      onPickToken={onPickToken}
      {...drag}
    >
      <RuleSelect
        value={entry.ruleId}
        options={rules.map((r) => ({ id: r.id, label: r.name }))}
        placeholder="选择规则"
        onChange={(id) => onChange({ ...entry, ruleId: id })}
      />
    </SlotItemCard>
  )
}