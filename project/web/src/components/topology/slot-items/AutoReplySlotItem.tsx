import type { HeartbeatRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { AutoReplySlotEntry } from './types'

interface AutoReplySlotItemProps {
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
}: AutoReplySlotItemProps) {
  const selected = rules.find((r) => r.id === entry.ruleId) ?? null
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">心跳规则</span>
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
            <span className="text-foreground/70">匹配：</span>
            {selected.matchCondition}
          </span>
          <span className="truncate">
            <span className="text-foreground/70">超时：</span>
            {selected.timeout}s
          </span>
        </div>
      )}
    </SlotItemCard>
  )
}