import type { ConcurrencyRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { ConcurrencySlotEntry } from './types'

const SCOPE_LABELS: Record<ConcurrencyRule['scope'], string> = {
  global: '全局',
  per_user: '每用户',
  per_token: '每令牌',
}

interface ConcurrencySlotItemProps {
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
}: ConcurrencySlotItemProps) {
  const selected = rules.find((r) => r.id === entry.ruleId) ?? null
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">并发规则</span>
        <RuleSelect
          value={entry.ruleId}
          options={rules.map((r) => ({ id: r.id, label: r.name }))}
          placeholder="选择规则"
          onChange={(id) => onChange({ ...entry, ruleId: id })}
        />
      </div>
      {selected && (
        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span>
            <span className="text-foreground/70">作用域：</span>
            {SCOPE_LABELS[selected.scope]}
          </span>
          <span>
            <span className="text-foreground/70">最大并发：</span>
            {selected.maxConcurrent}
            <span className="ml-2 text-foreground/70">排队：</span>
            {selected.queueEnabled ? '是' : '否'}
          </span>
        </div>
      )}
    </SlotItemCard>
  )
}