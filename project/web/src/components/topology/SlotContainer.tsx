import type { CSSProperties, ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlotContainerProps {
  title: string
  onAddNode?: () => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function SlotContainer({
  title,
  onAddNode,
  children,
  className,
  style,
}: SlotContainerProps) {
  const hasNodes = Boolean(children)

  return (
    <div
      className={cn(
        'border-2 border-dashed border-border rounded-lg p-4 relative',
        className,
      )}
      style={style}
    >
      <div className="text-sm font-medium text-muted-foreground mb-3">
        {title}
      </div>

      {hasNodes ? (
        <>
          <div className="flex flex-col gap-2">{children}</div>
          {onAddNode && (
            <button
              type="button"
              onClick={onAddNode}
              className="mt-2 flex w-full items-center justify-center rounded-md border border-dashed border-border py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <Plus className="size-3 mr-1" />
              添加
            </button>
          )}
        </>
      ) : (
        onAddNode && (
          <button
            type="button"
            onClick={onAddNode}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer mx-auto"
          >
            <Plus className="size-6" />
          </button>
        )
      )}
    </div>
  )
}
