import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { SlotErrorBox } from '@/components/topology/SlotErrorBox'
import { topologyConfig } from '@/config/topology-config'
import type {
  SlotEntry,
  SlotEntryMap,
  SlotRuleMap,
} from '@/components/topology/slot-items'
import {
  RequestModifySlotItem,
  ResponseModifySlotItem,
  AutoReplySlotItem,
  ConcurrencySlotItem,
  AutoSwitchSlotItem,
  LogOutputSlotItem,
} from '@/components/topology/slot-items'
import { makeEmptyEntry } from '@/components/topology/slot-items'

interface SlotNodeData {
  slotType: keyof SlotEntryMap
  providerId: string
  title: string
  entries: SlotEntry[]
  rules: SlotRuleMap
  enabled?: boolean
  onChangeEntry: (next: SlotEntry) => void
  onDeleteEntry: (index: number) => void
  onReorderEntries: (fromIndex: number, toIndex: number) => void
}

interface SlotNodeProps {
  data: SlotNodeData
  id: string
}

export function SlotNode({ data }: SlotNodeProps) {
  const { title, entries, slotType, rules, onChangeEntry, onDeleteEntry, onReorderEntries } = data

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  function handleAdd() {
    onChangeEntry(makeEmptyEntry(slotType, entries.length + 1))
  }

  const dragProps = (entryIndex: number) => ({
    isDragging: dragIndex === entryIndex,
    isDragOver: overIndex === entryIndex && dragIndex !== null && dragIndex !== entryIndex,
    onDragStart: () => setDragIndex(entryIndex),
    onDragOver: () => setOverIndex(entryIndex),
    onDrop: () => {
      if (dragIndex !== null && dragIndex !== entryIndex) {
        onReorderEntries(dragIndex, entryIndex)
      }
      setDragIndex(null)
      setOverIndex(null)
    },
  })

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.target.width,
          height: topologyConfig.handles.slot.target.height,
          borderWidth: topologyConfig.handles.slot.target.borderWidth,
        }}
      />
      <SlotContainer
        title={title}
        onAddNode={handleAdd}
        style={{
          width: 'fit-content',
          // Shell minimum is decoupled from `nodeRenderBounds` (the 200/300
          // range reserved for Provider + slot inner items). This keeps
          // populated and empty slots equal-width without applying the
          // 200/300 bound to the SlotContainer outer shell.
          minWidth: topologyConfig.render.slot.shellMinWidth,
        }}
      >
        {entries.map((entry) =>
          renderItem(
            entry,
            rules,
            onChangeEntry,
            onDeleteEntry,
            dragProps(entry.index),
          ),
        )}
      </SlotContainer>
      <SlotErrorBox error={null} />
      <Handle
        type="source"
        position={Position.Right}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.source.width,
          height: topologyConfig.handles.slot.source.height,
          borderWidth: topologyConfig.handles.slot.source.borderWidth,
        }}
      />
    </>
  )
}

interface DragProps {
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
}

function renderItem(
  entry: SlotEntry,
  rules: SlotRuleMap,
  onChangeEntry: (next: SlotEntry) => void,
  onDeleteEntry: (index: number) => void,
  drag: DragProps,
) {
  const onDelete = () => onDeleteEntry(entry.index)
  const change = onChangeEntry as (e: SlotEntry) => void
  switch (entry.slotType) {
    case 'requestModify':
      return (
        <RequestModifySlotItem
          key={entry.id}
          entry={entry}
          rules={rules.requestModify}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
    case 'responseModify':
      return (
        <ResponseModifySlotItem
          key={entry.id}
          entry={entry}
          rules={rules.responseModify}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
    case 'autoReply':
      return (
        <AutoReplySlotItem
          key={entry.id}
          entry={entry}
          rules={rules.autoReply}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
    case 'concurrency':
      return (
        <ConcurrencySlotItem
          key={entry.id}
          entry={entry}
          rules={rules.concurrency}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
    case 'autoSwitch':
      return (
        <AutoSwitchSlotItem
          key={entry.id}
          entry={entry}
          rules={rules.autoSwitch}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
    case 'logOutput':
      return (
        <LogOutputSlotItem
          key={entry.id}
          entry={entry}
          onChange={change}
          onDelete={onDelete}
          {...drag}
        />
      )
  }
}
