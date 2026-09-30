import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { cn } from '@/lib/utils'

interface SlotContainerProps {
  title: ReactNode
  onAddNode?: () => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
  externallyDisabled?: boolean
  onExecutorPick?: (token: string) => void
  active?: boolean
}

export function SlotContainer({
  title,
  onAddNode,
  children,
  className,
  style,
  externallyDisabled = false,
  onExecutorPick,
  active = true,
}: SlotContainerProps) {
  const { t } = useTranslation('node')
  const hasNodes = Boolean(children)

  return (
    <div
      onClick={(e) => {
        if (!onExecutorPick) return
        const hit = (e.target as HTMLElement).closest('[data-executor]')
        const token = hit?.getAttribute('data-executor')
        if (token) {
          e.stopPropagation()
          onExecutorPick(token)
        }
      }}
      className={cn(
        'border-2 border-dashed border-border rounded-sm p-4 relative bg-background',
        !active && 'opacity-60',
        externallyDisabled && 'pointer-events-none',
        className,
      )}
      style={style}
    >
      <div className="mb-3 min-w-0 truncate text-sm font-medium">
        {title}
      </div>

      {hasNodes ? (
        <>
          <div className="flex flex-col items-stretch gap-2">{children}</div>
          {onAddNode && (
            <button
              type="button"
              onClick={onAddNode}
              className="mt-2 flex w-full items-center justify-center rounded-sm border border-dashed border-border py-1 text-xs hover:bg-muted/50 transition-colors"
            >
              <AppIcon name="add" size={12} className="mr-1" />
              {t('slotContainer.add')}
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
