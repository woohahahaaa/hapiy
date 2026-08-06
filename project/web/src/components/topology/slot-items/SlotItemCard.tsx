import type { ReactNode } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { nodeRenderBounds } from '@/config/topology-config'

interface SlotItemCardProps {
  index: number
  enabled: boolean
  onToggleEnabled: (next: boolean) => void
  onDelete: () => void
  children: ReactNode
  className?: string
  onDragStart?: () => void
  onDragOver?: () => void
  onDrop?: () => void
  isDragging?: boolean
  isDragOver?: boolean
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
}: SlotItemCardProps) {
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
        'rounded-md border border-border bg-card text-card-foreground transition-opacity',
        !enabled && 'opacity-60',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
        className,
      )}
      style={{
        minWidth: nodeRenderBounds.minWidth,
        maxWidth: nodeRenderBounds.maxWidth,
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1">
          {onDragStart && (
            <span
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                onDragStart()
              }}
              className="nodrag nopan cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
              aria-label="拖动排序"
            >
              <AppIcon name="drag_handle" size={14} />
            </span>
          )}
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
            {index}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onToggleEnabled(v === true)}
            aria-label={enabled ? '禁用' : '启用'}
            className="nodrag nopan shrink-0"
          />
          <button
            type="button"
            onClick={onDelete}
            className="nodrag nopan rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="删除"
          >
            <AppIcon name="close" size={12} />
          </button>
        </div>
      </div>
      <div className="nodrag nopan space-y-1.5 p-2">{children}</div>
    </div>
  )
}