import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { RuleTypeStatus } from '../use-slot-rules'
import type { AutoSwitchSlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { FailoverRule } from '@/lib/dashboard-api'

export interface NodeExecutorAutoSwitchProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: AutoSwitchSlotEntry
  rules: readonly FailoverRule[]
  // 该类型规则列表的加载状态与打开时刷新回调（由 useSlotRules 透传下来）。
  ruleStatus?: RuleTypeStatus
  onRefreshRules?: () => void
  onChange: (next: AutoSwitchSlotEntry) => void
  onDelete: () => void
}

// 自动禁用业务节点：槽位内的一条自动禁用（故障转移）规则条目。
// 与并发控制保持一致：无论是否已绑定规则都渲染 RuleSelect，
// 已绑定时同样可以随时下拉更换规则，而不是只能跳去编辑页。
export function NodeExecutorAutoSwitch({ entry, rules, onChange, onDelete, token, picked, onPickToken, ruleStatus, onRefreshRules, ...drag }: NodeExecutorAutoSwitchProps) {
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