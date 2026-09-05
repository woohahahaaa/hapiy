import { Handle, Position, useNodeId, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { SlotErrorBox } from '@/components/node/slot/slot-error-box'
import { HandlesRail } from '@/components/node/handles-rail'
import { topologyConfig } from '@/config/topology-config'
import type {
  RequestModifySlotEntry,
  ResponseModifySlotEntry,
  AutoReplySlotEntry,
  ConcurrencySlotEntry,
  AutoSwitchSlotEntry,
  LogOutputSlotEntry,
  SlotEntry,
  SlotRuleMap,
  SlotType,
  SlotItemDragProps,
} from '@/components/node/slot/items'
import { makeEmptyEntry } from '@/components/node/slot/items'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import type { FlatProviderChild, ProviderOption } from '@/components/node/executor/sub/provider'
import type { SlotRuleKey, SlotRuleStatusMap } from '@/components/node/executor/use-slot-rules'
import { NodeSlotProvider, type ProviderStrategy } from './sub/provider'
import { NodeSlotRequestModify } from './sub/request-modify'
import { NodeSlotResponseModify } from './sub/response-modify'
import { NodeSlotAutoReply } from './sub/auto-reply'
import { NodeSlotConcurrency } from './sub/concurrency'
import { NodeSlotAutoSwitch } from './sub/auto-switch'
import { NodeSlotLogOutput } from './sub/log-output'

export type { ProviderStrategy, FlatProviderChild }

export interface NodeSlotData {
  title: string
  slotType: string
  isProviderSlot?: boolean
  /** 连进本节点的线数（驱动左侧 handlebar 长度）；缺省 1 */
  connectionCount?: number
  externallyDisabled?: boolean
  enabled?: boolean
  children?: readonly FlatProviderChild[]
  providers?: readonly ProviderOption[]
  strategy?: ProviderStrategy
  onCycleStrategy?: () => void
  providerFlashLayers?: ReadonlyMap<string, readonly FlowLayerOverlay[]>
  flashLayers?: readonly FlowLayerOverlay[]
  onAddProvider?: () => void
  onSelectProvider?: (nodeId: string, providerId: string) => void
  onToggleProvider?: (providerId: string, enabled: boolean) => void
  onDeleteProvider?: (providerId: string) => void
  onReorderProvider?: (fromIndex: number, toIndex: number) => void
  entries?: SlotEntry[]
  rules?: SlotRuleMap
  // A-group wiring: 绑定下拉框按类型读取 加载中/加载失败 状态并支持打开时刷新。
  ruleStatus?: SlotRuleStatusMap
  refreshRuleType?: (key: SlotRuleKey) => void
  onChangeEntry?: (next: SlotEntry) => void
  onDeleteEntry?: (index: number) => void
  onReorderEntries?: (fromIndex: number, toIndex: number) => void
  onAutoCloseEntry?: () => void
  deadlineAt?: number | null
  onToggleEnabled?: (enabled: boolean) => void
  onSetDeadline?: (deadlineAt: number | null) => void
  onStartCapture?: (deadlineAt: number) => void
  onSelectExecutor?: (token: string | null) => void
  selectedExecutorToken?: string | null
}

interface NodeSlotProps {
  data: NodeSlotData
}

const EMPTY_RULES: SlotRuleMap = {
  requestModify: [],
  responseModify: [],
  autoReply: [],
  concurrency: [],
  autoSwitch: [],
}

const noop = () => {}

// 插槽节点外壳：连线 Handle、flash 注入、拖动排序状态，以及按插槽类型分发到
// node-slot/sub 下对应的"业务细分插槽节点"。
export function NodeSlot({ data }: NodeSlotProps) {
  const {
    title,
    slotType,
    isProviderSlot,
    connectionCount,
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
    ruleStatus,
    refreshRuleType,
    onChangeEntry,
    onDeleteEntry,
    onReorderEntries,
    onAutoCloseEntry,
    deadlineAt,
    onToggleEnabled,
    onSetDeadline,
    onStartCapture,
    onSelectExecutor,
    selectedExecutorToken,
  } = data
  const entries = entriesProp ?? []
  const slotRules = rules ?? EMPTY_RULES
  // 已占用检测按键 = 真实供应商 ID（旧数据缺 providerId 时按名称兜底），
  // 供应商重命名不会破坏去重。
  const takenLabels = new Set(children.map((c) => c.providerId || c.label).filter(Boolean))
  const strategy = strategyProp ?? 'sequential'

  // 节点高度测量：左侧 handlebar 需要跟随节点高度（与入口节点一致）。
  const nodeId = useNodeId() ?? ''
  const measureRef = useRef<HTMLDivElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const lastHeightRef = useRef(0)
  const [nodeHeight, setNodeHeight] = useState(0)

  useEffect(() => {
    const el = measureRef.current
    if (!el) return

    let rafId: number | null = null
    const applySize = () => {
      rafId = null
      const height = el.offsetHeight
      if (Math.abs(height - lastHeightRef.current) <= 1) return
      lastHeightRef.current = height
      setNodeHeight(height)
      updateNodeInternals(nodeId)
    }
    const ro = new ResizeObserver(() => {
      if (rafId === null) rafId = requestAnimationFrame(applySize)
    })
    ro.observe(el)
    applySize()
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [nodeId, updateNodeInternals])

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [entryDragIndex, setEntryDragIndex] = useState<number | null>(null)
  const [entryOverIndex, setEntryOverIndex] = useState<number | null>(null)

  const handleDrop = (entryIndex: number) => {
    if (dragIndex !== null && dragIndex !== entryIndex) {
      onReorderProvider?.(dragIndex, entryIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const handleAddEntry = () => {
    onChangeEntry?.(makeEmptyEntry(slotType as SlotType, entries.length + 1))
  }

  const entryDragProps = (entryIndex: number): SlotItemDragProps => ({
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

  const body = isProviderSlot ? (
    <NodeSlotProvider
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      children={children}
      providers={providers}
      takenLabels={takenLabels}
      providerFlashLayers={providerFlashLayers}
      strategy={strategy}
      onCycleStrategy={onCycleStrategy}
      onAddProvider={onAddProvider}
      onSelectProvider={onSelectProvider}
      onToggleProvider={onToggleProvider}
      onDeleteProvider={onDeleteProvider}
      externallyDisabled={externallyDisabled}
      dragIndex={dragIndex}
      overIndex={overIndex}
      onDragStart={(i) => setDragIndex(i)}
      onDragOver={(i) => setOverIndex(i)}
      onDrop={(i) => handleDrop(i)}
    />
  ) : slotType === 'requestModify' ? (
    <NodeSlotRequestModify
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      entries={entries as RequestModifySlotEntry[]}
      rules={slotRules.requestModify}
      ruleStatus={ruleStatus?.requestModify}
      onRefreshRules={() => refreshRuleType?.('requestModify')}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
    />
  ) : slotType === 'responseModify' ? (
    <NodeSlotResponseModify
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      entries={entries as ResponseModifySlotEntry[]}
      rules={slotRules.responseModify}
      ruleStatus={ruleStatus?.responseModify}
      onRefreshRules={() => refreshRuleType?.('responseModify')}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
    />
  ) : slotType === 'autoReply' ? (
    <NodeSlotAutoReply
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      entries={entries as AutoReplySlotEntry[]}
      rules={slotRules.autoReply}
      ruleStatus={ruleStatus?.autoReply}
      onRefreshRules={() => refreshRuleType?.('autoReply')}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
    />
  ) : slotType === 'concurrency' ? (
    <NodeSlotConcurrency
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      entries={entries as ConcurrencySlotEntry[]}
      rules={slotRules.concurrency}
      ruleStatus={ruleStatus?.concurrency}
      onRefreshRules={() => refreshRuleType?.('concurrency')}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
    />
  ) : slotType === 'autoSwitch' ? (
    <NodeSlotAutoSwitch
      title={title}
      enabled={data.enabled ?? true}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      onToggleEnabled={onToggleEnabled}
      entries={entries as AutoSwitchSlotEntry[]}
      rules={slotRules.autoSwitch}
      ruleStatus={ruleStatus?.autoSwitch}
      onRefreshRules={() => refreshRuleType?.('autoSwitch')}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
    />
  ) : slotType === 'logOutput' ? (
    <NodeSlotLogOutput
      title={title}
      enabled={data.enabled ?? false}
      onSelectExecutor={onSelectExecutor}
      selectedExecutorToken={selectedExecutorToken}
      entries={entries as LogOutputSlotEntry[]}
      flashLayers={flashLayers}
      dragProps={entryDragProps}
      onChangeEntry={(next) => onChangeEntry?.(next)}
      onDeleteEntry={onDeleteEntry ?? noop}
      onAddEntry={handleAddEntry}
      externallyDisabled={externallyDisabled}
      deadlineAt={deadlineAt ?? null}
      onToggleEnabled={onToggleEnabled}
      onSetDeadline={onSetDeadline}
      onStartCapture={onStartCapture}
      onAutoCloseEntry={onAutoCloseEntry}
    />
  ) : null

  return (
    <>
      <HandlesRail
        height={nodeHeight}
        segmentCount={connectionCount ?? 1}
        flashLayers={flashLayers}
        fillBgClass="bg-background"
      />
      <div ref={measureRef} className="w-fit">{body}</div>
      {!isProviderSlot && <SlotErrorBox error={null} />}
      <Handle
        type="source"
        position={Position.Right}
        className="!rounded-[4px] !border-border !bg-card"
        style={{
          width: topologyConfig.handles.slot.source.width,
          height: topologyConfig.handles.slot.source.height,
          borderWidth: topologyConfig.handles.slot.source.borderWidth,
        }}
      />
    </>
  )
}