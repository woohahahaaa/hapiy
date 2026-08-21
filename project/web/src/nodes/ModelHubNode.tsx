import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'
import { toast } from '@/components/ui/toast'
import { buildFlashKeyframes, flashKeyframeName, type ProviderFlashPayload } from '@/edges/FlowLightEdge'

interface ModelHubNodeData {
  models?: Array<{ id: string; label: string; disabled?: boolean; color?: string }>
  simplified?: boolean
  flash?: ProviderFlashPayload
  flashes?: readonly ProviderFlashPayload[]
}

interface ModelHubNodeProps {
  data: ModelHubNodeData
  id: string
}

export function ModelHubNode({ data, id }: ModelHubNodeProps) {
  const models = data.models || []
  const simplified = data.simplified === true
  const allFlashes = data.flashes && data.flashes.length > 0 ? data.flashes : data.flash ? [data.flash] : []
  const updateNodeInternals = useUpdateNodeInternals()
  const lenRef = useRef(models.length)

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length
      updateNodeInternals(id)
    }
  }, [id, models.length, updateNodeInternals])

  const pad = topologyConfig.render.modelHub
  const flashAnim: CSSProperties | undefined =
    allFlashes.length > 0
      ? {
          animationName: allFlashes.map((f) => flashKeyframeName(f)).join(', '),
          animationDuration: allFlashes.map((f) => `${f.cycleMs}ms`).join(', '),
          animationTimingFunction: allFlashes.map(() => 'linear').join(', '),
          animationIterationCount: allFlashes.map(() => 'infinite').join(', '),
          animationFillMode: allFlashes.map(() => 'forwards').join(', '),
        }
      : undefined

  return (
    <div
      className="rounded-lg border border-border bg-card text-card-foreground"
      style={{
        width: 'fit-content',
        ...(flashAnim ?? {}),
      }}
    >
      {allFlashes.map((f) => (
        <style key={flashKeyframeName(f)}>{buildFlashKeyframes(flashKeyframeName(f), f)}</style>
      ))}
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
          <div
            key={m.id}
            className={cn(
              'flex items-center gap-2 text-base text-card-foreground',
              m.disabled && 'opacity-60'
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
          className="border-t border-border text-[10px] text-muted-foreground"
          style={{ padding: `${pad.paddingY}px ${pad.paddingX}px` }}
        >
          {models.length} models
        </div>
      )}
    </div>
  )
}
