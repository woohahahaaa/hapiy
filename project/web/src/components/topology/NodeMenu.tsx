import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProviderItem {
  readonly id: string
  readonly name: string
}

interface NodeMenuProps {
  x: number
  y: number
  providers: readonly ProviderItem[]
  onSelect: (providerId: string) => void
  onClose: () => void
}

export function NodeMenu({ x, y, providers, onSelect, onClose }: NodeMenuProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={(e) => { if (e.button === 0) onClose() }}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed z-50 w-56 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg',
        )}
        style={{ left: x, top: y }}
        role="menu"
      >
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
            <span>{p.name}</span>
          </button>
        ))}
        {providers.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            没有可选的供应商
          </div>
        )}
      </div>
    </>
  )
}
