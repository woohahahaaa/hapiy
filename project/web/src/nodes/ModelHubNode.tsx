import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'

interface ModelHubNodeData {
  models?: Array<{ id: string; label: string; disabled?: boolean }>
  simplified?: boolean
}

interface ModelHubNodeProps {
  data: ModelHubNodeData
  id: string
}

export function ModelHubNode({ data, id }: ModelHubNodeProps) {
  const models = data.models || []
  const simplified = data.simplified === true
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  return (
    <div
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      style={{
        width: 'fit-content',
        minWidth: topologyConfig.nodeDimensions.modelHub.minWidth,
        maxWidth: topologyConfig.nodeDimensions.modelHub.maxWidth,
      }}
    >
      {!simplified && (
        <div className="border-b border-border px-3 py-2">
          <span className="text-sm font-medium">模型中心</span>
        </div>
      )}

      <div className={cn(simplified ? 'p-0' : 'divide-y divide-border')}>
        {models.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-xs text-card-foreground',
              m.disabled && 'opacity-40'
            )}
          >
            <span className="size-2 rounded-full bg-primary" />
            <span>{m.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={m.id}
              className="!rounded-full !border-border !bg-background"
              style={{
                width: topologyConfig.handles.modelHub.source.width,
                height: topologyConfig.handles.modelHub.source.height,
                borderWidth: topologyConfig.handles.modelHub.source.borderWidth,
              }}
            />
          </div>
        ))}
      </div>

      {!simplified && (
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {models.length} models
        </div>
      )}
    </div>
  )
}
