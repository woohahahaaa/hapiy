import { useState, useCallback } from 'react'
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
import { RewriteTestDialog } from '@/components/RewriteTestDialog'

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
  onAutoCloseEntry?: () => void
}

interface SlotNodeProps {
  data: SlotNodeData
  id: string
}

export function SlotNode({ data }: SlotNodeProps) {
  const { title, entries, slotType, rules, onChangeEntry, onDeleteEntry, onReorderEntries, onAutoCloseEntry } = data

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [testOpen, setTestOpen] = useState(false)

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

  // Collect all slot entries that have a ruleId bound, in index order.
  const boundEntries = entries
    .filter((e) => e.ruleId && (slotType === 'requestModify' || slotType === 'responseModify'))
    .sort((a, b) => a.index - b.index)

  // Resolve rule objects from bound entry ruleIds.
  const slotRules = slotType === 'requestModify'
    ? (rules.requestModify as readonly { id: string; name: string; script: string; status: boolean }[])
    : (rules.responseModify as readonly { id: string; name: string; script: string; status: boolean }[])

  const testRules = boundEntries
    .map((e) => slotRules.find((r) => r.id === e.ruleId))
    .filter((r): r is { id: string; name: string; script: string; status: boolean } => r != null && r.status)

  const slotTitle = slotType === 'requestModify' || slotType === 'responseModify' ? (
    <span className="flex items-center gap-2">
      <span>{title}</span>
      <button
        type="button"
        className="nodrag nopan inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); setTestOpen(true); }}
      >
        测试
      </button>
    </span>
  ) : title

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
        title={slotTitle}
        onAddNode={handleAdd}
        style={{
          width: 'fit-content',
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
            onAutoCloseEntry,
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
      {testOpen && (
        <RewriteTestDialog
          open={testOpen}
          onClose={() => setTestOpen(false)}
          rules={testRules}
          type={slotType === 'requestModify' ? 'rewrite' : 'rewrite-response'}
          preselectedRuleId={null}
          readonlyRule={true}
          showSelector={false}
        />
      )}
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
  onAutoCloseEntry?: () => void,
) {
  const onDelete = () => onDeleteEntry(entry.index)
  const change = onChangeEntry as (e: SlotEntry) => void
  const content = (() => {
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
            onAutoClose={onAutoCloseEntry}
            {...drag}
          />
        )
    }
  })()
  if (entry.slotType !== 'logOutput' && entry.ruleId === null) {
    const ruleList = rules[entry.slotType as keyof SlotRuleMap]
    if (ruleList && ruleList.length > 0) {
      return <div key={entry.id} className="opacity-50">{content}</div>
    }
  }
  return content
}