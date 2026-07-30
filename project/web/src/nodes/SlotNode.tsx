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
    onChangeEntry(makePlaceholder(slotType, entries.length + 1))
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
        style={{ width: topologyConfig.nodeDimensions.slot.width }}
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

function makePlaceholder(slotType: keyof SlotEntryMap, index: number): SlotEntry {
  switch (slotType) {
    case 'requestModify':
      return { slotType, index, ruleId: null, enabled: true }
    case 'responseModify':
      return { slotType, index, ruleId: null, enabled: true }
    case 'autoReply':
      return { slotType, index, ruleId: null, enabled: true }
    case 'concurrency':
      return { slotType, index, ruleId: null, enabled: true }
    case 'autoSwitch':
      return { slotType, index, ruleId: null, enabled: true }
    case 'logOutput':
      return {
        slotType,
        index,
        enabled: true,
        logTarget: 'file',
        logLevel: 'info',
        logPath: '',
        recordRequestBefore: true,
        recordRequestAfter: true,
        recordResponseBefore: true,
        recordResponseAfter: true,
      }
  }
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
          key={entry.index}
          entry={entry}
          rules={rules.requestModify}
          onChange={change}
          onDelete={onDelete}
        />
      )
    case 'responseModify':
      return (
        <ResponseModifySlotItem
          key={entry.index}
          entry={entry}
          rules={rules.responseModify}
          onChange={change}
          onDelete={onDelete}
        />
      )
    case 'autoReply':
      return (
        <AutoReplySlotItem
          key={entry.index}
          entry={entry}
          rules={rules.autoReply}
          onChange={change}
          onDelete={onDelete}
        />
      )
    case 'concurrency':
      return (
        <ConcurrencySlotItem
          key={entry.index}
          entry={entry}
          rules={rules.concurrency}
          onChange={change}
          onDelete={onDelete}
        />
      )
    case 'autoSwitch':
      return (
        <AutoSwitchSlotItem
          key={entry.index}
          entry={entry}
          rules={rules.autoSwitch}
          onChange={change}
          onDelete={onDelete}
        />
      )
    case 'logOutput':
      return (
        <LogOutputSlotItem
          key={entry.index}
          entry={entry}
          onChange={change}
          onDelete={onDelete}
          hasRequestRewrite={hasRequestRewrite}
          hasResponseRewrite={hasResponseRewrite}
        />
      )
  }
}