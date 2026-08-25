import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { ConcurrencySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { ConcurrencyRule } from '@/lib/dashboard-api'

export interface NodeExecutorConcurrencyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ConcurrencySlotEntry
  rules: readonly ConcurrencyRule[]
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

// 并发控制业务节点：槽位内的一条并发控制条目（绑定并发规则）。
export function NodeExecutorConcurrency({ entry, rules, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorConcurrencyProps) {
  return (
    <SlotItemCard
      index={entry.index}
      enabled={entry.enabled}
      onToggleEnabled={(v) => onChange({ ...entry, enabled: v })}
      onDelete={onDelete}
      token={token}
      picked={picked}
      onPickToken={onPickToken}
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