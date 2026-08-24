import { type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface ProviderItem {
  readonly id: string
  readonly name: string
}

interface NodeMenuProps {
  x: number
  y: number
  mode: 'corner' | 'cursor'
  providers: readonly ProviderItem[]
  onSelect: (providerId: string) => void
  onClose: () => void
}

export function NodeMenu({ x, y, mode, providers, onSelect, onClose }: NodeMenuProps) {
  const positionStyle: CSSProperties = mode === 'corner'
    ? { right: x, bottom: y }
    : { left: x, top: y }
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
        style={positionStyle}
        role="menu"
      >
        <div className="border-b border-border px-2 pb-2 mb-1 text-xs font-medium">
          从 provider 创建工作流
        </div>
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            <span>{p.name}</span>
          </button>
        ))}
        {providers.length === 0 && (
          <div className="px-2 py-1.5 text-sm">
            没有可选的供应商
          </div>
        )}
      </div>
    </>
  )
}
