import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'

interface ConcurrencyNodeData {
  label?: string
  ruleItems?: Array<{ name: string; scope: string; max: number }>
  count?: number
  sourceIds?: string[]
}

interface ConcurrencyNodeProps {
  data: ConcurrencyNodeData
  id: string
}

export function ConcurrencyNode({ data, id }: ConcurrencyNodeProps) {
  const { label = '并发控制', ruleItems = [], count, sourceIds = [] } = data
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
    <div className="w-48 rounded-lg border bg-card shadow-sm">
      {/* Target handles */}
      {sourceIds.map((src, i) => (
        <Handle
          key={src}
          type="target"
          position={Position.Left}
          id={src}
          className="!w-3 !h-3 !rounded-full !border-2 !bg-background"
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
        className="!w-3 !h-3 !rounded-full !border-2 !bg-background"
      />

      {/* Header */}
      <div className="border-b px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
      </div>

      {/* Body */}
      <div className="space-y-1 p-3">
        {ruleItems.length > 0 ? (
          ruleItems.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span>{r.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {r.scope} / {r.max}
              </span>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No rules</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {count ?? ruleItems.length ?? 0} rules
      </div>
    </div>
  )
}
