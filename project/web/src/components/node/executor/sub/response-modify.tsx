import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { ResponseModifySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'

export interface NodeExecutorResponseModifyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ResponseModifySlotEntry
  rules: readonly ResponseRewriteRule[]
  onChange: (next: ResponseModifySlotEntry) => void
  onDelete: () => void
}

// 响应改写业务节点：槽位内的一条响应改写条目（绑定响应改写规则）。
export function NodeExecutorResponseModify({ entry, rules, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorResponseModifyProps) {
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