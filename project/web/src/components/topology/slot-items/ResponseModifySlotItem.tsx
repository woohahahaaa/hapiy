import type { ResponseRewriteRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { ResponseModifySlotEntry, SlotItemDragProps } from './types'

interface ResponseModifySlotItemProps extends SlotItemDragProps {
  entry: ResponseModifySlotEntry
  rules: readonly ResponseRewriteRule[]
  onChange: (next: ResponseModifySlotEntry) => void
  onDelete: () => void
}

export function ResponseModifySlotItem({
  entry,
  rules,
  onChange,
  onDelete,
  ...drag
}: ResponseModifySlotItemProps) {
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