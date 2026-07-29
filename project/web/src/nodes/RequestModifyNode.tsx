import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'

interface RequestModifyNodeData {
  label?: string
  transforms?: Array<{ field?: string; action?: string }>
  count?: number
  sourceIds?: string[]
}

interface RequestModifyNodeProps {
  data: RequestModifyNodeData
  id: string
}

export function RequestModifyNode({ data, id }: RequestModifyNodeProps) {
  const { label = '请求改写', transforms = [], count, sourceIds = [] } = data
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
        {transforms.length > 0 ? (
          transforms.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[10px] text-muted-foreground">
                {t.field ?? '—'}
              </span>
              <span className="text-muted-foreground">{t.action ?? '—'}</span>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No transforms configured</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        {count ?? transforms.length ?? 0} rules
      </div>
    </div>
  )
}
