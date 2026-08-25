import { SlotContainer } from '@/components/node/slot/slot-container'
import { topologyConfig } from '@/config/topology-config'
import { SlotEnableControl } from '@/components/node/slot/slot-enable-control'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { SlotItemDragProps, AutoReplySlotEntry } from '@/components/node/slot/items'
import type { HeartbeatRule } from '@/lib/dashboard-api'
import { NodeExecutorAutoReply } from '@/components/node/executor/sub/auto-reply'

export interface NodeSlotAutoReplyProps {
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
  title: string
  entries: readonly AutoReplySlotEntry[]
  rules: readonly HeartbeatRule[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: AutoReplySlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
  enabled: boolean
  onToggleEnabled?: (enabled: boolean) => void
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
  enabled,
  onToggleEnabled,
  onSelectExecutor,
  selectedExecutorToken,
}: NodeSlotAutoReplyProps) {
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
      onExecutorPick={onSelectExecutor}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorAutoReply
          key={entry.id}
          token={entry.id}
          picked={selectedExecutorToken === entry.id}
          onPickToken={onSelectExecutor}
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