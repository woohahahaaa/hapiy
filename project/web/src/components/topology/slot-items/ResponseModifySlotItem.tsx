import type { ResponseRewriteRule } from '@/lib/dashboard-api'
import { SlotItemCard } from './SlotItemCard'
import { RuleSelect } from './RuleSelect'
import type { ResponseModifySlotEntry } from './types'

interface ResponseModifySlotItemProps {
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
}: ResponseModifySlotItemProps) {
  const selected = rules.find((r) => r.id === entry.ruleId) ?? null
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground">改写规则</span>
        <RuleSelect
          value={entry.ruleId}
          options={rules.map((r) => ({ id: r.id, label: r.name }))}
          placeholder="选择规则"
          onChange={(id) => onChange({ ...entry, ruleId: id })}
        />
      </div>
      {selected && (
        <pre className="max-h-16 overflow-hidden rounded bg-muted px-1.5 py-1 font-mono text-[10px] leading-tight text-muted-foreground">
          {selected.script.slice(0, 80)}
          {selected.script.length > 80 && '…'}
        </pre>
      )}
    </SlotItemCard>
  )
}