import type { HeartbeatRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { AutoReplySlotEntry, SlotItemDragProps } from './types'

interface AutoReplySlotItemProps extends SlotItemDragProps {
  entry: AutoReplySlotEntry
  rules: readonly HeartbeatRule[]
  onChange: (next: AutoReplySlotEntry) => void
  onDelete: () => void
}

export function AutoReplySlotItem({
  entry,
  rules,
  onChange,
  onDelete,
  ...drag
}: AutoReplySlotItemProps) {
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
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