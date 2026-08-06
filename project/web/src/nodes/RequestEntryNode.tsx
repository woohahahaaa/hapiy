import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { Input } from '@/components/ui/input'

interface RequestEntryNodeData {
  label: string
  enabled: boolean
  weight: number
  models?: Array<{ id: string; label: string; active: boolean }>
  onChangeEnabled: (enabled: boolean) => void
  onChangeWeight: (weight: number) => void
}

interface RequestEntryNodeProps {
  data: RequestEntryNodeData
  id: string
}

export function RequestEntryNode({ data, id }: RequestEntryNodeProps) {
  const { label, enabled, weight, onChangeEnabled, onChangeWeight, models = [] } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const [nodeHeight, setNodeHeight] = useState(0)

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setNodeHeight(el.offsetHeight)
      updateNodeInternals(id)
    })
    ro.observe(el)
    setNodeHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [id, updateNodeInternals])

  const targetHandle = topologyConfig.handles.provider.target
  const sourceHandle = topologyConfig.handles.slot.source
  const baseSegH = targetHandle.height
  const baseGap = topologyConfig.handles.provider.segmentGap
  const baseTotal = models.length * baseSegH + Math.max(0, models.length - 1) * baseGap
  const maxTotal = nodeHeight > 0 ? nodeHeight - 8 : 0
  const scale = maxTotal > 0 && baseTotal > maxTotal ? maxTotal / baseTotal : 1
  const segH = baseSegH * scale
  const gap = baseGap * scale
  const total = baseTotal * scale
  const start = -(total / 2)

  const handleWeight = (raw: string) => {
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    const clamped = Math.min(1, Math.max(0, parsed))
    onChangeWeight(Math.round(clamped * 100) / 100)
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        !enabled && 'opacity-60',
      )}
      style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
    >
      {models.map((m, i) => (
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', enabled ? 'bg-primary' : 'bg-muted-foreground/50')}
          />
          <span className="truncate text-sm font-medium">{label || '请求入口'}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? `${label} 已启用，点击关闭` : `${label} 已停用，点击启用`}
          data-no-drag="true"
          onClick={(e) => {
            e.stopPropagation()
            onChangeEnabled(!enabled)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'nodrag nopan relative inline-flex h-5 w-9 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors',
            'border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring',
            enabled ? 'bg-primary' : 'bg-secondary',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1 p-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">权重</span>
          <Input
            type="number"
            size="sm"
            min={0}
            max={1}
            step={0.01}
            value={Number.isFinite(weight) ? weight : 1}
            onChange={(e) => handleWeight(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="nodrag nopan w-full px-1 py-0 text-left"
          />
        </div>
      </div>
    </div>
  )
}
