import type { FailoverRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { AutoSwitchSlotEntry } from './types'

const CONDITION_LABELS: Record<FailoverRule['condition'], string> = {
  timeout: '超时',
  error: '错误',
  rate_limit: '限流',
}

interface AutoSwitchSlotItemProps {
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
}: AutoSwitchSlotItemProps) {
  const selected = rules.find((r) => r.id === entry.ruleId) ?? null
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">故障转移规则</span>
        <RuleSelect
          value={entry.ruleId}
          options={rules.map((r) => ({ id: r.id, label: r.name }))}
          placeholder="选择规则"
          onChange={(id) => onChange({ ...entry, ruleId: id })}
        />
      </div>
      {selected && (
        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span className="truncate">
            <span className="text-foreground/70">主：</span>
            {selected.primaryChannel || '—'}
          </span>
          <span className="truncate">
            <span className="text-foreground/70">备：</span>
            {selected.fallbackChannel || '—'}
          </span>
          <span>
            <span className="text-foreground/70">触发：</span>
            {CONDITION_LABELS[selected.condition]}
          </span>
        </div>
      )}
    </SlotItemCard>
  )
}