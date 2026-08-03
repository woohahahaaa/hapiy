import type { ConcurrencyRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { ConcurrencySlotEntry, SlotItemDragProps } from './types'

interface ConcurrencySlotItemProps extends SlotItemDragProps {
  entry: ConcurrencySlotEntry
  rules: readonly ConcurrencyRule[]
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

export function ConcurrencySlotItem({
  entry,
  rules,
  onChange,
  onDelete,
  ...drag
}: ConcurrencySlotItemProps) {
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