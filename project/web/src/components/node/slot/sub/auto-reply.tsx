import { SlotContainer } from '@/components/topology/SlotContainer'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, AutoReplySlotEntry } from '@/components/topology/slot-items'
import type { HeartbeatRule } from '@/lib/dashboard-api'
import { NodeExecutorAutoReply } from '@/components/node/executor/sub/auto-reply'

export interface NodeSlotAutoReplyProps {
  title: string
  entries: readonly AutoReplySlotEntry[]
  rules: readonly HeartbeatRule[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: AutoReplySlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
}

// 心跳回复插槽节点：心跳业务条目列表。
export function NodeSlotAutoReply({
  title,
  entries,
  rules,
  flashLayers,
  dragProps,
  onChangeEntry,
  onDeleteEntry,
  onAddEntry,
  externallyDisabled,
}: NodeSlotAutoReplyProps) {
  return (
    <SlotContainer
      title={title}
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorAutoReply
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