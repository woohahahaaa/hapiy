import type { RewriteRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { RequestModifySlotEntry, SlotItemDragProps } from './types'

interface RequestModifySlotItemProps extends SlotItemDragProps {
  entry: RequestModifySlotEntry
  rules: readonly RewriteRule[]
  onChange: (next: RequestModifySlotEntry) => void
  onDelete: () => void
}

export function RequestModifySlotItem({
  entry,
  rules,
  onChange,
  onDelete,
  ...drag
}: RequestModifySlotItemProps) {
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