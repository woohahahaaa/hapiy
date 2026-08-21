import type { CSSProperties, ReactNode } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { nodeRenderBounds } from '@/config/topology-config'
import { buildFlashKeyframes, flashKeyframeName, type ProviderFlashPayload } from '@/edges/FlowLightEdge'

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
  flash?: ProviderFlashPayload
  flashes?: readonly ProviderFlashPayload[]
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
  flash,
  flashes,
}: SlotItemCardProps) {
const allFlashes = flashes && flashes.length > 0 ? flashes : flash ? [flash] : []
  const kfNames = allFlashes.map((f) => flashKeyframeName(f))
  const flashAnim: CSSProperties | undefined =
    allFlashes.length > 0
      ? {
          animationName: kfNames.join(', '),
          // 多层动画用相同的周期会强占同一种子节点,这里用 max(cycleMs) 统一
          // 周期,让同节点多请求按各自 phase 错开,视觉上自然叠加
          animationDuration: allFlashes.map((f) => `${f.cycleMs}ms`).join(', '),
          animationTimingFunction: allFlashes.map(() => 'linear').join(', '),
          animationIterationCount: allFlashes.map(() => 'infinite').join(', '),
          animationFillMode: allFlashes.map(() => 'forwards').join(', '),
        }
      : undefined
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
        !dimContentWhenDisabled && !enabled && 'opacity-60',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary border-dashed',
        className,
      )}
      style={{
        minWidth: nodeRenderBounds.minWidth,
        maxWidth: nodeRenderBounds.maxWidth,
        ...(flashAnim ?? {}),
      }}
    >
      {allFlashes.map((f) => (
        <style key={flashKeyframeName(f)}>{buildFlashKeyframes(flashKeyframeName(f), f)}</style>
      ))}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className={cn('flex items-center gap-1', dimContentWhenDisabled && !enabled && 'opacity-50')}>
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
                'nodrag nopan rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive',
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
