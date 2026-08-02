import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContextMenuProps {
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}

export function ContextMenu({ x, y, onDelete, onClose }: ContextMenuProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={(e) => { if (e.button === 0) onClose() }}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        )}
        style={{ left: x, top: y }}
        role="menu"
      >
        <button
          type="button"
          onClick={() => { onDelete(); onClose() }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-muted"
        >
          <Trash2 className="size-4" />
          <span>删除工作流</span>
        </button>
      </div>
    </>
  )
}
