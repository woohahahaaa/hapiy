import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { RuleTypeStatus } from '../use-slot-rules'
import type { ConcurrencySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { ConcurrencyRule } from '@/lib/dashboard-api'

export interface NodeExecutorConcurrencyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ConcurrencySlotEntry
  rules: readonly ConcurrencyRule[]
  // 该类型规则列表的加载状态与打开时刷新回调（由 useSlotRules 透传下来）。
  ruleStatus?: RuleTypeStatus
  onRefreshRules?: () => void
  onChange: (next: ConcurrencySlotEntry) => void
  onDelete: () => void
}

// 并发控制业务节点：槽位内的一条并发控制条目（绑定并发规则）。
export function NodeExecutorConcurrency({ entry, rules, onChange, onDelete, token, picked, onPickToken, ruleStatus, onRefreshRules, ...drag }: NodeExecutorConcurrencyProps) {
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
        placeholder="请选择"
        loading={ruleStatus?.loading}
        error={ruleStatus?.error ?? null}
        onOpenRefresh={onRefreshRules}
        onChange={(id) => onChange({ ...entry, ruleId: id })}
      />
    </SlotItemCard>
  )
}