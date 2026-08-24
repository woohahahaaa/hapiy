import type { CSSProperties, ReactNode } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'

interface SlotContainerProps {
  title: ReactNode
  onAddNode?: () => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
  externallyDisabled?: boolean
  dimChildren?: boolean
}

export function SlotContainer({
  title,
  onAddNode,
  children,
  className,
  style,
  externallyDisabled = false,
  dimChildren = false,
}: SlotContainerProps) {
  const hasNodes = Boolean(children)

  return (
    <div
      className={cn(
        'border-2 border-dashed border-border rounded-lg p-4 relative bg-background',
        externallyDisabled && 'opacity-50 pointer-events-none',
        className,
      )}
      style={style}
    >
      <div className="mb-3 min-w-0 truncate text-sm font-medium">
        {title}
      </div>

      {hasNodes ? (
        <>
          <div className={cn('flex flex-col items-stretch gap-2', dimChildren && 'opacity-60')}>{children}</div>
          {onAddNode && (
            <button
              type="button"
              onClick={onAddNode}
              className="mt-2 flex w-full items-center justify-center rounded-md border border-dashed border-border py-1 text-xs hover:bg-muted/50 transition-colors"
            >
              <AppIcon name="add" size={12} className="mr-1" />
              添加
            </button>
          )}
        </>
      ) : (
        onAddNode && (
          <button
            type="button"
            onClick={onAddNode}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-muted hover:bg-muted/80 transition-colors cursor-pointer mx-auto"
          >
            <AppIcon name="add" size={24} />
          </button>
        )
      )}
    </div>
  )
}
