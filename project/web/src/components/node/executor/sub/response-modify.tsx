import { SlotItemCard } from '@/components/node/slot/items/SlotItemCard'
import { RuleSelect } from '../rule-select'
import { useTranslation } from 'react-i18next'
import type { RuleTypeStatus } from '../use-slot-rules'
import type { ResponseModifySlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import type { ResponseRewriteRule } from '@/lib/dashboard-api'

export interface NodeExecutorResponseModifyProps extends SlotItemDragProps {
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
  entry: ResponseModifySlotEntry
  rules: readonly ResponseRewriteRule[]
  // 该类型规则列表的加载状态与打开时刷新回调（由 useSlotRules 透传下来）。
  ruleStatus?: RuleTypeStatus
  onRefreshRules?: () => void
  onChange: (next: ResponseModifySlotEntry) => void
  onDelete: () => void
}

// 响应改写业务节点：槽位内的一条响应改写条目（绑定响应改写规则）。
export function NodeExecutorResponseModify({ entry, rules, onChange, onDelete, token, picked, onPickToken, ruleStatus, onRefreshRules, ...drag }: NodeExecutorResponseModifyProps) {
  const { t } = useTranslation('node')
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
        placeholder={t('ruleSelect.placeholder')}
        loading={ruleStatus?.loading}
        error={ruleStatus?.error ?? null}
        onOpenRefresh={onRefreshRules}
        onChange={(id) => onChange({ ...entry, ruleId: id })}
      />
    </SlotItemCard>
  )
}