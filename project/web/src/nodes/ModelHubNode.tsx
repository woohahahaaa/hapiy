import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { toast } from '@/components/ui/toast'

interface ModelHubNodeData {
  models?: Array<{ id: string; label: string; disabled?: boolean; color?: string }>
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

  const pad = topologyConfig.render.modelHub

  return (
    <div
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      style={{
        width: 'fit-content',
      }}
    >
      {!simplified && (
        <div
          className="border-b border-border"
          style={{ padding: `${pad.paddingY + 2}px ${pad.paddingX}px` }}
        >
          <span className="text-sm font-medium">模型中心</span>
        </div>
      )}

      <div className={cn(simplified ? 'p-0' : 'divide-y divide-border')}>
        {models.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(m.label).then(() => {
                toast(`已复制模型名：${m.label}`)
              })
            }}
            className={cn(
              'nodrag nopan flex w-full cursor-pointer items-center gap-2 text-left text-base text-card-foreground transition-colors hover:bg-muted/50',
              m.disabled && 'opacity-60'
            )}
            style={{ padding: `${pad.paddingY}px ${pad.paddingX}px` }}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: m.color ?? 'var(--primary)' }} />
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
          </button>
        ))}
      </div>

      {!simplified && (
        <div
          className="border-t border-border text-[10px] text-muted-foreground"
          style={{ padding: `${pad.paddingY}px ${pad.paddingX}px` }}
        >
          {models.length} models
        </div>
      )}
    </div>
  )
}
