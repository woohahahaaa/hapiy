import { SlotContainer } from '@/components/node/slot/slot-container'
import { slotNodeActive } from '@/components/node/effectiveness'
import { SlotEnableControl } from '@/components/node/slot/slot-enable-control'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { LogOutputSlotEntry, SlotItemDragProps } from '@/components/node/slot/items'
import { NodeExecutorLogOutputItem } from '@/components/node/executor/sub/log-output'

export interface NodeSlotLogOutputProps {
  title: string
  enabled: boolean
  entries: readonly LogOutputSlotEntry[]
  flashLayers?: readonly FlowLayerOverlay[]
  dragProps: (entryIndex: number) => SlotItemDragProps
  onChangeEntry: (next: LogOutputSlotEntry) => void
  onDeleteEntry: (index: number) => void
  onAddEntry: () => void
  externallyDisabled?: boolean
  deadlineAt: number | null
  onToggleEnabled?: (enabled: boolean) => void
  onSetDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onAutoCloseEntry?: () => void
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
}

export function NodeSlotLogOutput({
  title,
  enabled,
  entries,
  flashLayers,
  dragProps,
  onChangeEntry,
  onDeleteEntry,
  onAddEntry,
  externallyDisabled,
  deadlineAt,
  onToggleEnabled,
  onSetDeadline,
  onStartCapture,
  onAutoCloseEntry,
  onSelectExecutor,
  selectedExecutorToken,
}: NodeSlotLogOutputProps) {
  const titleBadge = (
    <div className="flex items-center justify-between gap-2">
      <span>{title}</span>
      <SlotEnableControl
        variant="countdown"
        enabled={enabled}
        deadlineAt={deadlineAt}
        onToggle={onToggleEnabled ?? (() => {})}
        onSetDeadline={onSetDeadline ?? (() => {})}
        onStartCapture={onStartCapture}
        onAutoClose={onAutoCloseEntry}
      />
    </div>
  )
    const active = slotNodeActive(enabled, deadlineAt, externallyDisabled ?? false)
  return (
    <SlotContainer
      title={titleBadge}
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
      active={active}
      onExecutorPick={onSelectExecutor}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <NodeExecutorLogOutputItem
          key={entry.id}
          token={entry.id}
          picked={selectedExecutorToken === entry.id}
          onPickToken={onSelectExecutor}
          entry={entry}
          onChange={onChangeEntry}
          onDelete={() => onDeleteEntry(entry.index)}
          flashLayers={flashLayers}
          {...dragProps(entry.index)}
        />
      ))}
    </SlotContainer>
  )
}