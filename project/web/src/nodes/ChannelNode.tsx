import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { topologyConfig } from '@/config/topology-config'

interface ChannelNodeData {
  label: string
  baseURLCount?: number
  keyCount?: number
  modelCount?: number
  models?: string[]
  active?: boolean
  onToggle?: () => void
}

interface ChannelNodeProps {
  data: ChannelNodeData
  id: string
}

export function ChannelNode({ data, id }: ChannelNodeProps) {
  const { label, baseURLCount = 0, keyCount = 0, modelCount = 0, models = [], onToggle } = data
  const dataActive = data.active ?? true
  const [optimisticActive, setOptimisticActive] = useState<boolean | null>(null)
  const active = optimisticActive ?? dataActive
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)

  useEffect(() => {
    setOptimisticActive(null)
  }, [dataActive])

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models, updateNodeInternals])

  const n = models.length
  const targetHandle = topologyConfig.handles.channel.target
  const gap = topologyConfig.handles.channel.segmentGap
  const sourceHandle = topologyConfig.handles.channel.source
  const segH = targetHandle.height
  const total = n * segH + (n - 1) * gap
  const start = -(total / 2)

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setOptimisticActive(!active)
    onToggle?.()
  }
  const stopPointer = (e: ReactPointerEvent<HTMLButtonElement>) => e.stopPropagation()

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        !active && 'opacity-60'
      )}
      style={{ width: topologyConfig.nodeDimensions.channel.width }}
    >
      {models.map((m, i) => (
        <Handle
          key={m}
          type="target"
          position={Position.Left}
          id={m}
          className="!rounded-full !border-border !bg-background"
          style={{
            top: `calc(50% + ${start + i * (segH + gap)}px)`,
            width: targetHandle.width,
            height: targetHandle.height,
            borderWidth: targetHandle.borderWidth,
            transform: 'translate(-50%, 0)',
          }}
        />
      ))}

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

      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{label || 'Channel'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={active ? `${label} 当前启用，点击关闭` : `${label} 当前关闭，点击启用`}
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
