import { SlotContainer } from '@/components/topology/SlotContainer'
import { topologyConfig } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { LogOutputSlotItem, type LogOutputSlotEntry, type SlotItemDragProps } from '@/components/topology/slot-items'
import { NodeExecutorLogOutput } from '@/components/node/executor/sub/log-output'

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
  onToggleLog?: (enabled: boolean) => void
  onSetLogDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onAutoCloseEntry?: () => void
}

// 日志抓取插槽节点：日志业务标题栏（开启/关闭 + 时长） + 日志条目列表。
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
  onToggleLog,
  onSetLogDeadline,
  onStartCapture,
  onAutoCloseEntry,
}: NodeSlotLogOutputProps) {
  const titleBadge = (
    <NodeExecutorLogOutput
      title={title}
      enabled={enabled}
      deadlineAt={deadlineAt}
      onToggle={onToggleLog}
      onSetDeadline={onSetLogDeadline}
      onStartCapture={onStartCapture}
      onAutoClose={onAutoCloseEntry}
    />
  )
  return (
    <SlotContainer
      title={titleBadge}
      onAddNode={onAddEntry}
      style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
      externallyDisabled={externallyDisabled}
      dimChildren={!enabled}
    >
      {[...entries].sort((left, right) => left.index - right.index).map((entry) => (
        <LogOutputSlotItem
          key={entry.id}
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