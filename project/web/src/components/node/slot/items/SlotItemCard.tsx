import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { nodeRenderBounds } from '@/config/topology-config'
import type { FlowLayerOverlay } from '@/modules/flow-hub'
import { FlashLayer, nodeFlashKeyframeName } from '@/components/node/flash-layer'

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
  token?: string
  picked?: boolean
  onPickToken?: (token: string) => void
}

export function SlotItemCard({
  index,
  enabled,
  onToggleEnabled,
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
  token,
  picked = false,
  onPickToken,
}: SlotItemCardProps) {
  const { t } = useTranslation('node')
  const layers = flashLayers ?? []
  return (
    <div
      data-executor={token}
      data-picked={picked || undefined}
      onClick={token && onPickToken ? (e) => { e.stopPropagation(); onPickToken(token) } : undefined}
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
        'relative rounded-sm border-2 border-border bg-card text-card-foreground transition-opacity',
        !dimContentWhenDisabled && !enabled && 'opacity-60',
        isDragging && 'opacity-40',
        isDragOver && 'border-dashed border-[var(--node-accent,var(--color-primary))]',
        picked && 'ring-2 ring-[var(--node-accent,var(--color-primary))]',
        className,
      )}
      style={{
        minWidth: nodeRenderBounds.minWidth,
        maxWidth: nodeRenderBounds.maxWidth,
      }}
    >{enabled && layers.map((layer) => (
        <FlashLayer key={nodeFlashKeyframeName(layer)} layer={layer} />
      ))}      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2 py-1.5">
        <div className={cn('flex items-center gap-1', dimContentWhenDisabled && !enabled && 'opacity-50')}>
          {onDragStart && (
            <span
              draggable
              onDragStart={(e) => {
                e.stopPropagation()
                onDragStart()
              }}
              className="nodrag nopan cursor-grab active:cursor-grabbing"
              aria-label={t('slotItemCard.dragToReorder')}
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
              aria-label={enabled ? t('common:action.disable') : t('common:action.enable')}
              className="nodrag nopan shrink-0"
            />
          )}
        </div>
      </div>
      <div className={cn('nodrag nopan space-y-1.5 p-2', dimContentWhenDisabled && !enabled && 'opacity-50')}>
        {children}
      </div>
    </div>
  )
}
