import { SlotContainer } from '@/components/topology/SlotContainer'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, AutoSwitchSlotEntry } from '@/components/topology/slot-items'
import type { FailoverRule } from '@/lib/dashboard-api'
import { NodeExecutorAutoSwitch } from '@/components/node/executor/sub/auto-switch'

export interface NodeSlotAutoSwitchProps {
  title: string
  entries: readonly AutoSwitchSlotEntry[]
  rules: readonly FailoverRule[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: AutoSwitchSlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
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
}: NodeSlotAutoSwitchProps) {
  return (
    <SlotContainer
      title={title}
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorAutoSwitch
          key={entry.id}
          entry={entry}
          rules={rules}
          onChange={onChangeEntry}
          onDelete={() => onDeleteEntry(entry.index)}
          flashLayers={flashLayers}
          {...dragProps(entry.index)}
        />
      ))}
    </SlotContainer>
  )
}