import { SlotContainer } from '@/components/topology/SlotContainer'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, ConcurrencySlotEntry } from '@/components/topology/slot-items'
import type { ConcurrencyRule } from '@/lib/dashboard-api'
import { NodeExecutorConcurrency } from '@/components/node/executor/sub/concurrency'

export interface NodeSlotConcurrencyProps {
  title: string
  entries: readonly ConcurrencySlotEntry[]
  rules: readonly ConcurrencyRule[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: ConcurrencySlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
}

// 并发控制插槽节点：并发业务条目列表。
export function NodeSlotConcurrency({
  title,
  entries,
  rules,
  flashLayers,
  dragProps,
  onChangeEntry,
  onDeleteEntry,
  onAddEntry,
  externallyDisabled,
}: NodeSlotConcurrencyProps) {
  return (
    <SlotContainer
      title={title}
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorConcurrency
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