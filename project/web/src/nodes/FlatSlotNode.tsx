import { Handle, Position } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { SlotErrorBox } from '@/components/topology/SlotErrorBox'
import { SlotItemCard } from '@/components/topology/slot-items/SlotItemCard'
import { AppIcon } from '@/components/AppIcon'
import { topologyConfig } from '@/config/topology-config'
import { cn } from '@/lib/utils'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type {
  RequestModifySlotEntry,
  ResponseModifySlotEntry,
  SlotEntry,
  SlotRuleMap,
  SlotType,
} from '@/components/topology/slot-items'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface FlatProviderChild {
  readonly id: string
  readonly label: string
  readonly baseURLCount: number
  readonly keyCount: number
  readonly modelCount: number
  readonly enabled: boolean
  readonly providerStatus: boolean
  readonly autoDisabled: boolean
}

type ProviderStrategy = 'sequential' | 'random' | 'roundRobin'

interface FlatSlotNodeData {
  title: string
  slotType: string
  isProviderSlot?: boolean
  externallyDisabled?: boolean
  enabled?: boolean
  children?: readonly FlatProviderChild[]
  providers?: readonly string[]
  strategy?: ProviderStrategy
  onCycleStrategy?: () => void
  providerFlashLayers?: ReadonlyMap<string, readonly FlowLayerOverlay[]>
  flashLayers?: readonly FlowLayerOverlay[]
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
  logDeadlineAt?: number | null
  onToggleLog?: (enabled: boolean) => void
  onSetLogDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
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
    strategy: strategyProp,
    onCycleStrategy,
    providerFlashLayers,
    flashLayers,
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
    logDeadlineAt,
    onToggleLog,
    onSetLogDeadline,
    onStartCapture,
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
    .filter((e): e is RequestModifySlotEntry | ResponseModifySlotEntry =>
      'ruleId' in e && (slotType === 'requestModify' || slotType === 'responseModify'),
    )
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

  const strategy = strategyProp ?? 'sequential'
  const strategyLabel = {
    sequential: '按顺序',
    random: '随机',
    roundRobin: '轮询',
  } as const

  const isRequestResponseModify = !isProviderSlot && (slotType === 'requestModify' || slotType === 'responseModify')
  const isLogOutputSlot = !isProviderSlot && slotType === 'logOutput'
  const titleBadge = isProviderSlot ? (
    <div className="flex items-center justify-between">
      <span>{title}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCycleStrategy?.() }}
        className="nodrag nopan flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {strategyLabel[strategy]}
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
  ) : isLogOutputSlot ? (
    <LogOutputSlotHeader
      title={title}
      enabled={data.enabled ?? false}
      deadlineAt={logDeadlineAt ?? null}
      onToggle={(next) => onToggleLog?.(next)}
      onSetDeadline={onSetLogDeadline}
      onStartCapture={onStartCapture}
      onAutoClose={onAutoCloseEntry}
    />
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
              flashLayers={providerFlashLayers?.get(child.id)}
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
          dimChildren={isLogOutputSlot && !data.enabled}
        >
          {entries.map((entry) =>
            renderItem(
              entry,
              slotRules,
              onChangeEntry,
              onDeleteEntry,
              entryDragProps(entry.index),
              flashLayers,
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
  flashLayers?: readonly FlowLayerOverlay[]
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onToggle: (enabled: boolean) => void
  onSelect: (name: string) => void
  onDelete: () => void
}

function ProviderCard({ index, child, providers, takenLabels, flashLayers, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onToggle, onSelect, onDelete }: ProviderCardProps) {
  const filteredProviders = providers.filter((n) => n === child.label || !takenLabels.has(n))
  const state = child.autoDisabled ? 'auto-disabled' : child.providerStatus ? 'enabled' : 'disabled'
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
      flashLayers={flashLayers}
      className={cn(
        state === 'disabled' && 'opacity-60',
        state === 'auto-disabled' && 'opacity-60',
      )}
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
          state !== 'enabled' ? (
            <span
              className={cn(
                'pl-2.5 text-xs font-medium',
                state === 'disabled' ? 'text-destructive' : 'text-warning',
              )}
            >
              {state === 'disabled' ? '禁用' : '自动禁用'}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{child.baseURLCount} URL{child.baseURLCount !== 1 ? 's' : ''}</span>
              <span>{child.keyCount} Key{child.keyCount !== 1 ? 's' : ''}</span>
              <span>{child.modelCount} 模型</span>
            </div>
          )
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
  flashLayers?: readonly FlowLayerOverlay[],
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
            flashLayers={flashLayers}
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
            flashLayers={flashLayers}
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
            flashLayers={flashLayers}
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
            flashLayers={flashLayers}
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
            flashLayers={flashLayers}
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
            flashLayers={flashLayers}
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

interface LogOutputSlotHeaderProps {
  readonly title: string
  readonly enabled: boolean
  readonly deadlineAt: number | null
  readonly onToggle?: (enabled: boolean) => void
  readonly onSetDeadline?: (deadlineAt: number | null) => void
  readonly onStartCapture?: (deadlineAt: number) => void
  readonly onAutoClose?: () => void
}

function LogOutputSlotHeader({
  title,
  enabled,
  deadlineAt,
  onToggle,
  onStartCapture,
  onAutoClose,
}: LogOutputSlotHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('5')
  const [seconds, setSeconds] = useState('0')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineAt === null || !enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [deadlineAt, enabled])

  const capturing = enabled && deadlineAt !== null && deadlineAt > now

  useEffect(() => {
    if (!enabled || deadlineAt === null) return
    if (now < deadlineAt) return
    onToggle?.(false)
    onAutoClose?.()
  }, [deadlineAt, enabled, now, onToggle, onAutoClose])

  const totalSeconds =
    (Number.isNaN(Number(hours)) ? 0 : Number(hours)) * 3600 +
    (Number.isNaN(Number(minutes)) ? 0 : Number(minutes)) * 60 +
    (Number.isNaN(Number(seconds)) ? 0 : Number(seconds))

  const handleConfirm = () => {
    if (totalSeconds <= 0) return
    setDialogOpen(false)
    onStartCapture?.(Date.now() + totalSeconds * 1000)
  }

  const remaining = capturing && deadlineAt !== null ? Math.max(0, deadlineAt - now) : 0
  const remainingHours = Math.floor(remaining / 3600000)
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000)
  const remainingSeconds = Math.floor((remaining % 60000) / 1000)

  const buttonClass =
    'nodrag nopan inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground'

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {capturing && (
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              剩余 {remainingHours}小时{remainingMinutes}分{remainingSeconds}秒
            </span>
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={(e) => {
              e.stopPropagation()
              if (capturing) {
                onToggle?.(false)
              } else {
                setDialogOpen(true)
              }
            }}
          >
            {capturing ? '关闭' : '开启'}
          </button>
        </div>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>设置开启时长</DialogTitle>
          </DialogHeader>
          <div className="flex items-end justify-center gap-2">
            <TimeField label="时" value={hours} onChange={setHours} />
            <TimeField label="分" value={minutes} onChange={setMinutes} />
            <TimeField label="秒" value={seconds} onChange={setSeconds} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={totalSeconds <= 0} onClick={handleConfirm}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        max={999}
        step={1}
        className="w-16 text-center"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}