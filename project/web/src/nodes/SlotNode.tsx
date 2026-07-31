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
  onChangeEntry: (next: SlotEntry) => void
  onDeleteEntry: (index: number) => void
}

interface SlotNodeProps {
  data: SlotNodeData
  id: string
}

export function SlotNode({ data }: SlotNodeProps) {
  const { title, entries, slotType, rules, onChangeEntry, onDeleteEntry } = data
  const hasRequestRewrite = slotType === 'requestModify' && entries.length > 0
  const hasResponseRewrite = slotType === 'responseModify' && entries.length > 0

  function handleAdd() {
    onChangeEntry(makeEmptyEntry(slotType, entries.length + 1))
  }

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
          minWidth: topologyConfig.nodeDimensions.slot.minWidth,
          maxWidth: topologyConfig.nodeDimensions.slot.maxWidth,
        }}
      >
        {entries.map((entry) =>
          renderItem(
            entry,
            rules,
            hasRequestRewrite,
            hasResponseRewrite,
            onChangeEntry,
            onDeleteEntry,
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

function renderItem(
  entry: SlotEntry,
  rules: SlotRuleMap,
  hasRequestRewrite: boolean,
  hasResponseRewrite: boolean,
  onChangeEntry: (next: SlotEntry) => void,
  onDeleteEntry: (index: number) => void,
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
        />
      )
    case 'logOutput':
      return (
        <LogOutputSlotItem
          key={entry.id}
          entry={entry}
          onChange={change}
          onDelete={onDelete}
          hasRequestRewrite={hasRequestRewrite}
          hasResponseRewrite={hasResponseRewrite}
        />
      )
  }
}
