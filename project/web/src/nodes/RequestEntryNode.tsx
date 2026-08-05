import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { topologyConfig } from '@/config/topology-config'

interface RequestEntryNodeData {
  label: string
  enabled: boolean
  weight: number
  onChangeEnabled: (enabled: boolean) => void
  onChangeWeight: (weight: number) => void
}

interface RequestEntryNodeProps {
  data: RequestEntryNodeData
}

export function RequestEntryNode({ data }: RequestEntryNodeProps) {
  const { label, enabled, weight, onChangeEnabled, onChangeWeight } = data

  const handleWeight = (raw: string) => {
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) return
    const clamped = Math.min(1, Math.max(0, parsed))
    onChangeWeight(Math.round(clamped * 100) / 100)
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        !enabled && 'opacity-60',
      )}
      style={{ width: 'fit-content', minWidth: topologyConfig.render.node.minWidth }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.target.width,
          height: topologyConfig.handles.slot.target.height,
          borderWidth: topologyConfig.handles.slot.target.borderWidth,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.source.width,
          height: topologyConfig.handles.slot.source.height,
          borderWidth: topologyConfig.handles.slot.source.borderWidth,
        }}
      />

      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? `${label} 已启用，点击关闭` : `${label} 已停用，点击启用`}
          data-no-drag="true"
          onClick={(e) => {
            e.stopPropagation()
            onChangeEnabled(!enabled)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'nodrag nopan relative h-10 w-10 shrink-0 rounded-full cursor-pointer touch-manipulation transition-colors',
            'border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
            enabled ? 'border-primary bg-primary/15' : 'border-border bg-muted',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{label || '请求入口'}</div>
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>权重</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={Number.isFinite(weight) ? weight : 1}
              onChange={(e) => handleWeight(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-16 rounded border border-border bg-background px-1 py-0.5 text-right text-xs"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
