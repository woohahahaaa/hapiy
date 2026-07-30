import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NodeMenuProps {
  x: number
  y: number
  onSelect: () => void
  onClose: () => void
}

export function NodeMenu({ x, y, onSelect, onClose }: NodeMenuProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-56 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg',
        )}
        style={{ left: x, top: y }}
        role="menu"
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
          <span>添加 Provider</span>
        </button>
      </div>
    </>
  )
}
