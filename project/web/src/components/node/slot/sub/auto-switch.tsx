import { SlotContainer } from '@/components/node/slot/slot-container'
import { slotNodeActive } from '@/components/node/effectiveness'
import { topologyConfig } from '@/config/topology-config'
import { SlotEnableControl } from '@/components/node/slot/slot-enable-control'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, AutoSwitchSlotEntry } from '@/components/node/slot/items'
import type { FailoverRule } from '@/lib/dashboard-api'
import { NodeExecutorAutoSwitch } from '@/components/node/executor/sub/auto-switch'
import type { RuleTypeStatus } from '@/components/node/executor/use-slot-rules'

export interface NodeSlotAutoSwitchProps {
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
  title: string
  entries: readonly AutoSwitchSlotEntry[]
  rules: readonly FailoverRule[]
  // 该类型规则列表的加载状态与打开时刷新回调（由 useSlotRules 透传下来）。
  ruleStatus?: RuleTypeStatus
  onRefreshRules?: () => void
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: AutoSwitchSlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
  enabled: boolean
  onToggleEnabled?: (enabled: boolean) => void
}

// 自动禁用插槽节点：自动禁用（故障转移）业务条目列表。
export function NodeSlotAutoSwitch({
  title,
  entries,
  rules,
  flashLayers,
  dragProps,
  onChangeEntry,
  onDeleteEntry,
  onAddEntry,
  externallyDisabled,
  enabled,
  onToggleEnabled,
  onSelectExecutor,
  selectedExecutorToken,
  ruleStatus,
  onRefreshRules,
}: NodeSlotAutoSwitchProps) {
    const active = slotNodeActive(enabled, undefined, externallyDisabled ?? false)
  return (
    <SlotContainer
      title={
        <div className="flex items-center justify-between gap-2">
          <span>{title}</span>
          <SlotEnableControl
            variant="switch"
            enabled={enabled}
            onToggle={onToggleEnabled ?? (() => {})}
          />
        </div>
      }
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
      active={active}
      onExecutorPick={onSelectExecutor}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorAutoSwitch
          key={entry.id}
          token={entry.id}
          picked={selectedExecutorToken === entry.id}
          onPickToken={onSelectExecutor}
          entry={entry}
          rules={rules}
          ruleStatus={ruleStatus}
          onRefreshRules={onRefreshRules}
          onChange={onChangeEntry}
          onDelete={() => onDeleteEntry(entry.index)}
          flashLayers={flashLayers}
          {...dragProps(entry.index)}
        />
      ))}
    </SlotContainer>
  )
}