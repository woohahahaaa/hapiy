import type { ReactNode } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { nodeRenderBounds } from '@/config/topology-config'
import { FLOW_STEP_MS, type FlowLayerOverlay } from '@/modules/flow-hub'

interface SlotItemCardProps {
  index: number
  enabled: boolean
  onToggleEnabled: (next: boolean) => void
  onDelete?: () => void
  children: ReactNode
  className?: string
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
  isDragging?: boolean
  isDragOver?: boolean
  enableControl?: ReactNode
  dimContentWhenDisabled?: boolean
  flashLayers?: readonly FlowLayerOverlay[]
}

export function SlotItemCard({
  index,
  enabled,
  onToggleEnabled,
  onDelete,
  children,
  className,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  isDragOver,
  enableControl,
  dimContentWhenDisabled = false,
  flashLayers,
}: SlotItemCardProps) {
  const layers = flashLayers ?? []
  return (
    <div
      onDragOver={(e) => {
        if (!onDragOver) return
        e.preventDefault()
        e.stopPropagation()
        onDragOver()
      }}
      onDrop={(e) => {
        if (!onDrop) return
        e.preventDefault()
        e.stopPropagation()
        onDrop()
      }}
      className={cn(
        'relative rounded-md border border-border bg-card text-card-foreground transition-opacity',
        !dimContentWhenDisabled && !enabled && 'opacity-60',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
        className,
      )}
      style={{
        minWidth: nodeRenderBounds.minWidth,
        maxWidth: nodeRenderBounds.maxWidth,
      }}
    >
      {layers.map((layer) => {
        const kfName = `flash-pulse-${layer.runId}-${layer.loop}`
        return (
          <span
            key={kfName}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-md border"
            style={{
              animationName: kfName,
              animationDuration: `${FLOW_STEP_MS}ms`,
              animationIterationCount: '1',
              animationFillMode: 'both',
              animationTimingFunction: 'linear',
            }}
          >
            <style>{`@keyframes ${kfName}{0%{border-color:var(--border);box-shadow:0 0 0 transparent}50%{border-color:${layer.color};box-shadow:0 0 8px ${layer.color},inset 0 0 2px ${layer.color}}100%{border-color:var(--border);box-shadow:0 0 0 transparent}}`}</style>
          </span>
        )
      })}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className={cn('flex items-center gap-1', dimContentWhenDisabled && !enabled && 'opacity-50')}>
          {onDragStart && (
            <span
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                onDragStart()
              }}
              className="nodrag nopan cursor-grab active:cursor-grabbing"
              aria-label="拖动排序"
            >
              <AppIcon name="drag_handle" size={14} />
            </span>
          )}
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px]">
            {index}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {enableControl ?? (
            <Switch
              checked={enabled}
              onCheckedChange={(v) => onToggleEnabled(v === true)}
              aria-label={enabled ? '禁用' : '启用'}
              className="nodrag nopan shrink-0"
            />
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className={cn(
                'nodrag nopan rounded p-0.5 transition-colors hover:bg-destructive/10 hover:text-destructive',
                dimContentWhenDisabled && !enabled && 'opacity-50',
              )}
              aria-label="删除"
            >
              <AppIcon name="close" size={12} />
            </button>
          )}
        </div>
      </div>
      <div className={cn('nodrag nopan space-y-1.5 p-2', dimContentWhenDisabled && !enabled && 'opacity-50')}>
        {children}
      </div>
    </div>
  )
}
