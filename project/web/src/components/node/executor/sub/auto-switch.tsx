import { Link } from 'react-router-dom'
import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import type { AutoSwitchSlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { FailoverRule } from '@/lib/dashboard-api'

export interface NodeExecutorAutoSwitchProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: AutoSwitchSlotEntry
  rules: readonly FailoverRule[]
  onChange: (next: AutoSwitchSlotEntry) => void
  onDelete: () => void
}

// 自动禁用业务节点：槽位内的一条自动禁用（故障转移）规则条目。
export function NodeExecutorAutoSwitch({ entry, rules, onChange, onDelete, token, picked, onPickToken, ...drag }: NodeExecutorAutoSwitchProps) {
  const rule = rules.find((candidate) => candidate.id === entry.ruleId)
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
      {rule && (
        <Link to={`/policy/failover?edit=${encodeURIComponent(rule.id)}`} className="-m-1 block rounded-sm p-1 text-sm font-medium hover:text-primary" aria-label={`编辑自动禁用规则 ${rule.name}`}>{rule.name}</Link>
      )}
      {!rule && <RuleSelect value={entry.ruleId} options={rules.map((candidate) => ({ id: candidate.id, label: candidate.name }))} placeholder="选择规则" onChange={(id) => onChange({ ...entry, ruleId: id })} />}
    </SlotItemCard>
  )
}