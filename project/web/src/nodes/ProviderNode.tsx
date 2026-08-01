import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { topologyConfig, nodeRenderBounds } from '@/config/topology-config'

interface ProviderNodeData {
  label: string
  baseURLCount?: number
  keyCount?: number
  modelCount?: number
  models?: string[]
  active?: boolean
  onToggle?: () => void
}

interface ProviderNodeProps {
  data: ProviderNodeData
  id: string
}

export function ProviderNode({ data, id }: ProviderNodeProps) {
  const { label, baseURLCount = 0, keyCount = 0, modelCount = 0, models = [], onToggle } = data
  const dataActive = data.active ?? true
  const [optimisticActive, setOptimisticActive] = useState<boolean | null>(null)
  const active = optimisticActive ?? dataActive
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const [nodeHeight, setNodeHeight] = useState(0)

  useEffect(() => {
    setOptimisticActive(null)
  }, [dataActive])

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setNodeHeight(el.offsetHeight))
    ro.observe(el)
    setNodeHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  const targetHandle = topologyConfig.handles.provider.target
  const sourceHandle = topologyConfig.handles.provider.source
  const baseSegH = targetHandle.height
  const baseGap = topologyConfig.handles.provider.segmentGap
  const baseTotal = models.length * baseSegH + Math.max(0, models.length - 1) * baseGap
  const maxTotal = nodeHeight > 0 ? nodeHeight - 8 : 0
  const scale = maxTotal > 0 && baseTotal > maxTotal ? maxTotal / baseTotal : 1
  const segH = baseSegH * scale
  const gap = baseGap * scale
  const total = baseTotal * scale
  const start = -(total / 2)

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const next = !active
    setOptimisticActive(next)
    void Promise.resolve()
      .then(() => onToggle?.())
      .catch(() => setOptimisticActive(null))
  }
  const stopPointer = (e: ReactPointerEvent<HTMLButtonElement>) => e.stopPropagation()

  return (
    <div
      ref={rootRef}
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        !active && 'opacity-60'
      )}
      style={{
        width: 'fit-content',
        minWidth: nodeRenderBounds.minWidth,
        maxWidth: nodeRenderBounds.maxWidth,
      }}
    >
      {models.map((m, i) => (
        <Handle
          key={m}
          type="target"
          position={Position.Left}
          id={m}
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

      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-border bg-background"
        style={{
          width: targetHandle.width,
          height: total,
        }}
      />

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
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label || 'Provider'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={active ? `${label} 工作流已启用，点击关闭` : `${label} 工作流已停用，点击启用`}
          data-no-drag="true"
          onClick={handleClick}
          onPointerDown={stopPointer}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={cn(
            'nodrag nopan relative inline-flex h-5 w-9 shrink-0 cursor-pointer touch-manipulation items-center rounded-full transition-colors',
            'border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active ? 'bg-primary' : 'bg-input'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow transition-transform',
              active ? 'translate-x-4' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1 p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {baseURLCount} URLs
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {keyCount} Keys
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {modelCount} Models
          </Badge>
        </div>
      </div>
    </div>
  )
}
