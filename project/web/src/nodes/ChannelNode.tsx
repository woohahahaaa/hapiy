import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'

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
  const { label, baseURLCount = 0, keyCount = 0, modelCount = 0, models = [], active = true, onToggle } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models, updateNodeInternals])

  // Calculate handle positions for models
  const n = models.length
  const segH = 20
  const gap = -2
  const total = n * segH + (n - 1) * gap
  const start = -(total / 2)

  return (
    <div
      className={cn(
        'w-48 rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        !active && 'opacity-60'
      )}
    >
      {/* Target handles for each model */}
      {models.map((m, i) => (
        <Handle
          key={m}
          type="target"
          position={Position.Left}
          id={m}
          className="!size-3 !rounded-full !border-2 !border-border !bg-background"
          style={{
            top: `calc(50% + ${start + i * (segH + gap)}px)`,
            height: segH,
            transform: 'translate(-50%, 0)',
          }}
        />
      ))}
      
      {/* Source handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3 !rounded-full !border-2 !border-border !bg-background"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{label || 'Channel'}</span>
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          className="scale-75"
        />
      </div>

      {/* Body */}
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
