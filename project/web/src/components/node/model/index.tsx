import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { toast } from '@/components/ui/toast'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'

interface NodeModelData {
  models?: Array<{ id: string; label: string; disabled?: boolean; color?: string }>
  simplified?: boolean
  flashLayers?: readonly FlowLayerOverlay[]
}

interface NodeModelProps {
  data: NodeModelData
  id: string
}

export function NodeModel({ data, id }: NodeModelProps) {
  const models = data.models || []
  const simplified = data.simplified === true
  const flashLayers = data.flashLayers ?? []
  const allDisabled = models.length > 0 && models.every((m) => m.disabled)
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
      className={cn(
        'relative rounded-lg border border-border bg-card text-card-foreground',
        allDisabled && 'opacity-60',
      )}
      style={{
        width: 'fit-content',
      }}
    >{flashLayers.map((layer) => (
        <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} className="rounded-lg" />
      ))}      {!simplified && (
        <div
          className="border-b border-border"
          style={{ padding: `${pad.paddingY + 2}px ${pad.paddingX}px` }}
        >
          <span className="text-sm font-medium">模型中心</span>
        </div>
      )}

      <div className={cn(simplified ? 'p-0' : 'divide-y divide-border')}>
        {models.map((m) => (
          <div
            key={m.id}
            className={cn(
              'flex items-center gap-2 text-base text-card-foreground',
              m.disabled && !allDisabled && 'opacity-60'
            )}
            style={{ padding: `${pad.paddingY}px ${pad.paddingX}px` }}
          >
            <span className="size-3 rounded-[2px]" style={{ backgroundColor: m.color ?? 'var(--primary)' }} />
            <button
              type="button"
              title="点击复制模型名"
              onClick={() => {
                void navigator.clipboard.writeText(m.label).then(() => {
                  toast(`已复制模型名：${m.label}`)
                })
              }}
              className="nodrag nopan min-w-0 cursor-pointer truncate text-left transition-colors hover:underline"
            >
              {m.label}
            </button>
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
        <div
          className="border-t border-border text-[10px]"
          style={{ padding: `${pad.paddingY}px ${pad.paddingX}px` }}
        >
          {models.length} models
        </div>
      )}
    </div>
  )
}
