import type { FailoverRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { AutoSwitchSlotEntry, SlotItemDragProps } from './types'

interface AutoSwitchSlotItemProps extends SlotItemDragProps {
  entry: AutoSwitchSlotEntry
  rules: readonly FailoverRule[]
  onChange: (next: AutoSwitchSlotEntry) => void
  onDelete: () => void
}

export function AutoSwitchSlotItem({
  entry,
  rules,
  onChange,
  onDelete,
  ...drag
}: AutoSwitchSlotItemProps) {
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