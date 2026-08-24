import type { FailoverRule } from '@/lib/dashboard-api'
import { Link } from 'react-router-dom'
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
  const rule = rules.find((candidate) => candidate.id === entry.ruleId)
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      {...drag}
    >
      {rule && (
        <Link to={`/policy/failover?edit=${encodeURIComponent(rule.id)}`} className="-m-1 block rounded-sm p-1 text-sm font-medium hover:text-primary" aria-label={`编辑自动禁用规则 ${rule.name}`}>{rule.name}</Link>
      )}
      {!rule && <RuleSelect value={entry.ruleId} options={rules.map((candidate) => ({ id: candidate.id, label: candidate.name }))} placeholder="选择规则" onChange={(id) => onChange({ ...entry, ruleId: id })} />}
    </SlotItemCard>
  )
}
