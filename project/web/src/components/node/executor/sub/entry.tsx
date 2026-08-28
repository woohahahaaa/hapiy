import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { createDebouncedCommit, type DebouncedCommit } from './debounce'
import { WEIGHT_DEBOUNCE_MS, clampWeight } from './weight'

// ReactFlow 节点 data 载荷：由 TopologyPage 组装传入（label/enabled/weight/
// models/flashLayers/onChange*）。此前引用了一个无定义的幽灵类型 NodeExecutorData，
// tsc -b 一直报 TS2304；这里显式声明并在组件中使用。
interface NodeExecutorEntryData {
  label: string
  enabled: boolean
  weight: number
  accentColor?: string
  models?: Array<{ id: string; label: string; active: boolean }>
  flashLayers?: readonly FlowLayerOverlay[]
  onChangeEnabled: (enabled: boolean) => void
  onChangeWeight: (weight: number) => void
}

interface NodeExecutorEntryProps {
  data: NodeExecutorEntryData
  id: string
}

export function NodeExecutorEntry({ data, id }: NodeExecutorEntryProps) {
  const { label, enabled, weight, onChangeEnabled, onChangeWeight, models = [] } = data
  const flashLayers = data.flashLayers ?? []
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastHeightRef = useRef(0)
  const [nodeHeight, setNodeHeight] = useState(0)
  const [weightText, setWeightText] = useState(() => String(Number.isFinite(weight) ? weight : 1))

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  // rAF-coalesced: rapid ResizeObserver callbacks collapse into one per frame,
  // and updateNodeInternals only fires when the height really changed >1px.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    let rafId: number | null = null
    const applySize = () => {
      rafId = null
      const height = el.offsetHeight
      if (Math.abs(height - lastHeightRef.current) <= 1) return
      lastHeightRef.current = height
      setNodeHeight(height)
      updateNodeInternals(id)
    }
    const ro = new ResizeObserver(() => {
      if (rafId === null) {
        rafId = requestAnimationFrame(applySize)
      }
    })
    ro.observe(el)
    applySize()
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [id, updateNodeInternals])

  const targetHandle = topologyConfig.handles.provider.target
  const sourceHandle = topologyConfig.handles.slot.source
  const baseSegH = targetHandle.height
  const baseGap = topologyConfig.handles.provider.segmentGap
  const baseTotal = models.length * baseSegH + Math.max(0, models.length - 1) * baseGap
  // 上下留 padding（原 8px 的 3 倍），shrink 到节点高度内
  const maxTotal = nodeHeight > 0 ? nodeHeight - 24 : 0
  const scale = maxTotal > 0 && baseTotal > maxTotal ? maxTotal / baseTotal : 1
  const segH = baseSegH * scale
  const gap = baseGap * scale
  const total = baseTotal * scale
  const start = -(total / 2)

  const onChangeWeightRef = useRef(onChangeWeight)
  useEffect(() => {
    onChangeWeightRef.current = onChangeWeight
  })

  const weightDebouncerRef = useRef<DebouncedCommit<number> | null>(null)
  useEffect(() => {
    weightDebouncerRef.current = createDebouncedCommit<number>(WEIGHT_DEBOUNCE_MS, (value) => {
      onChangeWeightRef.current(value)
    })
    return () => {
      weightDebouncerRef.current?.dispose()
      weightDebouncerRef.current = null
    }
  }, [])

  const [prevWeight, setPrevWeight] = useState(weight)
  if (prevWeight !== weight) {
    setPrevWeight(weight)
    setWeightText(String(Number.isFinite(weight) ? weight : 1))
  }

  const commitWeightOnBlur = () => {
    weightDebouncerRef.current?.flush()
    if (clampWeight(weightText) === null) {
      setWeightText(String(Number.isFinite(weight) ? weight : 1))
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative rounded-lg border bg-card text-card-foreground',
        data.accentColor ? 'border-[var(--node-accent)]' : 'border-border',
        !enabled && 'opacity-60',
      )}
      style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
    >{flashLayers.map((layer) => (
        <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} className="rounded-lg" />
      ))}      {models.map((m, i) => (
        <Handle
          key={m.id}
          type="target"
          position={Position.Left}
          id={m.id}
          style={{
            top: `calc(50% + ${start + i * (segH + gap)}px)`,
            width: targetHandle.width,
            height: segH,
            transform: 'translate(-50%, 0)',
            background: 'transparent',
            border: 'none',
            opacity: 0,
          }}
        />
      ))}
      {models.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-border bg-background"
          style={{
            width: targetHandle.width,
            height: total,
          }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: sourceHandle.width,
          height: sourceHandle.height,
          borderWidth: sourceHandle.borderWidth,
        }}
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className={cn('flex min-w-0 items-center gap-1.5')}>
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', enabled ? 'bg-[var(--node-accent,var(--color-primary))]' : 'bg-muted-foreground/50')}
          />
          <span className={cn('truncate text-sm font-medium', data.accentColor && 'text-[var(--node-accent)]')}>{label || '请求入口'}</span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={() => onChangeEnabled(!enabled)}
          aria-label={enabled ? `${label} 已启用，点击关闭` : `${label} 已停用，点击启用`}
          className="nodrag nopan"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>

      <div className={cn('flex flex-col gap-1 p-3')}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px]">权重</span>
          <Input
            type="number"
            size="sm"
            min={0}
            max={1}
            step={0.01}
            value={weightText}
            onChange={(e) => {
              setWeightText(e.target.value)
              const next = clampWeight(e.target.value)
              if (next !== null) weightDebouncerRef.current?.schedule(next)
            }}
            onBlur={commitWeightOnBlur}
            onKeyDown={(e) => e.stopPropagation()}
            className="nodrag nopan w-full px-1 py-0 text-left"
          />
        </div>
      </div>
    </div>
  )
}