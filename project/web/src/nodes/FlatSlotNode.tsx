import { Handle, Position } from '@xyflow/react'
import { useCallback, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { SlotErrorBox } from '@/components/topology/SlotErrorBox'
import { SlotItemCard } from '@/components/topology/slot-items/SlotItemCard'
import { AppIcon } from '@/components/AppIcon'
import { topologyConfig } from '@/config/topology-config'
import type { SlotEntry, SlotRuleMap, SlotType } from '@/components/topology/slot-items'
import {
  RequestModifySlotItem,
  ResponseModifySlotItem,
  AutoReplySlotItem,
  ConcurrencySlotItem,
  AutoSwitchSlotItem,
  LogOutputSlotItem,
  makeEmptyEntry,
} from '@/components/topology/slot-items'
import { RewriteTestDialog } from '@/components/RewriteTestDialog'

export interface FlatProviderChild {
  readonly id: string
  readonly label: string
  readonly baseURLCount: number
  readonly keyCount: number
  readonly modelCount: number
  readonly enabled: boolean
  readonly providerStatus: boolean
}

interface FlatSlotNodeData {
  title: string
  slotType: string
  isProviderSlot?: boolean
  externallyDisabled?: boolean
  children?: readonly FlatProviderChild[]
  providers?: readonly string[]
  onAddProvider?: () => void
  onSelectProvider?: (providerId: string, name: string) => void
  onToggleProvider?: (providerId: string, enabled: boolean) => void
  onDeleteProvider?: (providerId: string) => void
  onReorderProvider?: (fromIndex: number, toIndex: number) => void
  entries?: SlotEntry[]
  rules?: SlotRuleMap
  onChangeEntry?: (next: SlotEntry) => void
  onDeleteEntry?: (index: number) => void
  onReorderEntries?: (fromIndex: number, toIndex: number) => void
  onAutoCloseEntry?: () => void
}

interface FlatSlotNodeProps {
  data: FlatSlotNodeData
}

const EMPTY_RULES: SlotRuleMap = {
  requestModify: [],
  responseModify: [],
  autoReply: [],
  concurrency: [],
  autoSwitch: [],
}

export function FlatSlotNode({ data }: FlatSlotNodeProps) {
  const {
    title,
    slotType,
    isProviderSlot,
    externallyDisabled = false,
    children = [],
    providers = [],
    onAddProvider,
    onSelectProvider,
    onToggleProvider,
    onDeleteProvider,
    onReorderProvider,
    entries: entriesProp,
    rules,
    onChangeEntry,
    onDeleteEntry,
    onReorderEntries,
    onAutoCloseEntry,
  } = data
  const entries = entriesProp ?? []
  const slotRules = rules ?? EMPTY_RULES
  const takenLabels = new Set(children.map((c) => c.label).filter(Boolean))

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [entryDragIndex, setEntryDragIndex] = useState<number | null>(null)
  const [entryOverIndex, setEntryOverIndex] = useState<number | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  // Collect all bound rewrite entries in index order for sequential testing.
  const boundEntries = entries
    .filter((e) => e.ruleId && (slotType === 'requestModify' || slotType === 'responseModify'))
    .sort((a, b) => a.index - b.index)

  const rewriteRules = slotType === 'requestModify'
    ? (slotRules.requestModify as readonly { id: string; name: string; script: string; status: boolean }[])
    : (slotRules.responseModify as readonly { id: string; name: string; script: string; status: boolean }[])

  const testRules = boundEntries
    .map((e) => rewriteRules.find((r) => r.id === e.ruleId))
    .filter((r): r is { id: string; name: string; script: string; status: boolean } => r != null && r.status)

  const handleDrop = (entryIndex: number) => {
    if (dragIndex !== null && dragIndex !== entryIndex) {
      onReorderProvider?.(dragIndex, entryIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleAdd = () => {
    if (isProviderSlot) onAddProvider?.()
  }

  const handleAddEntry = () => {
    onChangeEntry?.(makeEmptyEntry(slotType as SlotType, entries.length + 1))
  }

  const entryDragProps = (entryIndex: number): DragProps => ({
    isDragging: entryDragIndex === entryIndex,
    isDragOver: entryOverIndex === entryIndex && entryDragIndex !== null && entryDragIndex !== entryIndex,
    onDragStart: () => setEntryDragIndex(entryIndex),
    onDragOver: () => setEntryOverIndex(entryIndex),
      onDrop: () => {
      if (entryDragIndex !== null && entryDragIndex !== entryIndex) {
        onReorderEntries?.(entryDragIndex, entryIndex)
      }
      setEntryDragIndex(null)
      setEntryOverIndex(null)
    },
  })

  const [providerStrategy, setProviderStrategy] = useState<'sequential' | 'random' | 'roundRobin'>('sequential')
  const strategyCycle = useCallback(() => {
    setProviderStrategy((s) => {
      if (s === 'sequential') return 'random'
      if (s === 'random') return 'roundRobin'
      return 'sequential'
    })
  }, [])

  const strategyLabel = {
    sequential: '按顺序',
    random: '随机',
    roundRobin: '轮询',
  } as const

  const isRequestResponseModify = !isProviderSlot && (slotType === 'requestModify' || slotType === 'responseModify')
  const titleBadge = isProviderSlot ? (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); strategyCycle() }}
        className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {strategyLabel[providerStrategy]}
        <AppIcon name="refresh" size={10} />
      </button>
    </div>
  ) : isRequestResponseModify ? (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <button
        type="button"
        className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); setTestOpen(true); }}
      >
        测试
      </button>
    </div>
  ) : (
    <span>{title}</span>
  )

  const targetHandle = topologyConfig.handles.provider.target
  const segH = targetHandle.height
  const total = segH
  const start = -(total / 2)

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          top: `calc(50% + ${start}px)`,
          width: targetHandle.width,
          height: segH,
          transform: 'translate(-50%, 0)',
          background: 'transparent',
          border: 'none',
          opacity: 0,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-border bg-background"
        style={{
          width: targetHandle.width,
          height: total,
        }}
      />
      {isProviderSlot ? (
        <SlotContainer
          title={titleBadge}
          onAddNode={handleAdd}
          style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
          externallyDisabled={externallyDisabled}
        >
          {children.map((child, i) => (
            <ProviderCard
              key={child.id}
              index={i + 1}
              child={child}
              providers={providers}
              takenLabels={takenLabels}
              isDragging={dragIndex === i}
              isDragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
              onDragStart={() => setDragIndex(i)}
              onDragOver={() => setOverIndex(i)}
              onDrop={() => handleDrop(i)}
              onToggle={(enabled) => onToggleProvider?.(child.id, enabled)}
              onSelect={(name) => onSelectProvider?.(child.id, name)}
              onDelete={() => onDeleteProvider?.(child.id)}
            />
          ))}
        </SlotContainer>
      ) : (
        <SlotContainer
          title={titleBadge}
          onAddNode={handleAddEntry}
          style={{ minWidth: topologyConfig.render.slot.shellMinWidth }}
          externallyDisabled={externallyDisabled}
        >
          {entries.map((entry) =>
            renderItem(
              entry,
              slotRules,
              onChangeEntry,
              onDeleteEntry,
              entryDragProps(entry.index),
              onAutoCloseEntry,
            ),
          )}
        </SlotContainer>
      )}
      {!isProviderSlot && <SlotErrorBox error={null} />}
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

interface ProviderCardProps {
  index: number
  child: FlatProviderChild
  providers: readonly string[]
  takenLabels: Set<string>
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: (enabled: boolean) => void
  onSelect: (name: string) => void
  onDelete: () => void
}

function ProviderCard({ index, child, providers, takenLabels, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onToggle, onSelect, onDelete }: ProviderCardProps) {
  const filteredProviders = providers.filter((n) => n === child.label || !takenLabels.has(n))
  return (
    <SlotItemCard
      index={index}
      enabled={child.enabled}
      onToggleEnabled={onToggle}
      onDelete={onDelete}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      isDragging={isDragging}
      isDragOver={isDragOver}
    >
      <div className="space-y-1.5">
        <Select value={child.label ?? ''} onValueChange={(value) => value && onSelect(value)}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="选择供应商" />
          </SelectTrigger>
          <SelectContent>
            {filteredProviders.map((name) => (
              <SelectItem key={name} value={name} disabled={name !== child.label && takenLabels.has(name)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {child.label && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{child.baseURLCount} URL{child.baseURLCount !== 1 ? 's' : ''}</span>
            <span>{child.keyCount} Key{child.keyCount !== 1 ? 's' : ''}</span>
            <span>{child.modelCount} 模型</span>
          </div>
        )}
      </div>
    </SlotItemCard>
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
  onChangeEntry: ((next: SlotEntry) => void) | undefined,
  onDeleteEntry: ((index: number) => void) | undefined,
  drag: DragProps,
  onAutoCloseEntry?: () => void,
) {
  const onDelete = () => onDeleteEntry?.(entry.index)
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