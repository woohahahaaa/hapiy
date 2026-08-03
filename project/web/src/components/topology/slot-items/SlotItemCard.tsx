import type { ReactNode } from 'react'
import { X, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
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
      draggable={!!onDragStart}
      onDragStart={(e) => {
        if (!onDragStart) return
        e.stopPropagation()
        onDragStart()
      }}
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
              className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
              aria-label="拖动排序"
            >
              <GripVertical className="size-3.5" />
            </span>
          )}
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
            {index}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? '禁用' : '启用'}
            data-no-drag="true"
            onClick={() => onToggleEnabled(!enabled)}
            className={cn(
              'nodrag nopan relative inline-flex h-4 w-7 shrink-0 cursor-pointer touch-manipulation items-center rounded-none transition-colors',
              'border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring',
              enabled ? 'bg-primary' : 'bg-secondary',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none block h-3 w-3 bg-background shadow transition-transform',
                enabled ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="删除"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5 p-2">{children}</div>
    </div>
  )
}