import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ModelHubNodeData {
  models?: Array<{ id: string; label: string; disabled?: boolean }>
}

interface ModelHubNodeProps {
  data: ModelHubNodeData
  id: string
}

export function ModelHubNode({ data, id }: ModelHubNodeProps) {
  const models = data.models || []
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  return (
    <div className="w-56 rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="border-b px-3 py-2">
        <span className="text-sm font-medium">模型中心</span>
      </div>

      {/* Model list */}
      <div className="divide-y">
        {models.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-xs',
              m.disabled && 'opacity-40'
            )}
          >
            <span className="h-2 w-2 rounded-full bg-primary/70" />
            <span>{m.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={m.id}
              className="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-background"
            />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {models.length} models
      </div>
    </div>
  )
}
