import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'

interface AutoSwitchNodeData {
  label?: string
  slots?: Array<{ key?: string; provider?: string; baseURL?: string }>
  count?: number
  sourceIds?: string[]
}

interface AutoSwitchNodeProps {
  data: AutoSwitchNodeData
  id: string
}

export function AutoSwitchNode({ data, id }: AutoSwitchNodeProps) {
  const { label = '故障转移', slots = [], count, sourceIds = [] } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(sourceIds.length)

  useEffect(() => {
    if (sourceIds.length !== lenRef.current) {
      lenRef.current = sourceIds.length
      updateNodeInternals(id)
    }
  }, [id, sourceIds, updateNodeInternals])

  // Calculate handle positions
  const n = sourceIds.length
  const segH = 20
  const gap = -2
  const total = n * segH + (n - 1) * gap
  const start = -(total / 2)

  return (
    <div className="w-48 rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      {/* Target handles */}
      {sourceIds.map((src, i) => (
        <Handle
          key={src}
          type="target"
          position={Position.Left}
          id={src}
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
      <div className="border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
      </div>

      {/* Body */}
      <div className="space-y-1 p-3">
        {slots.length > 0 ? (
          slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px]">
                {slot.key ?? `Slot ${i + 1}`}
              </Badge>
              <span className="text-muted-foreground">{slot.provider || '—'}</span>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No slots configured</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        {count ?? slots.length ?? 0} rules
      </div>
    </div>
  )
}
