import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlotNodeItemProps {
  index: number
  label: string
  onDelete?: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  className?: string
}

export function SlotNodeItem({
  index,
  label,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  className,
}: SlotNodeItemProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'rounded border border-border bg-card text-card-foreground px-3 py-2 flex items-center gap-2',
        className,
      )}
    >
      <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] flex items-center justify-center shrink-0">
        {index}
      </span>
      <span className="text-xs flex-1 truncate">{label}</span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
