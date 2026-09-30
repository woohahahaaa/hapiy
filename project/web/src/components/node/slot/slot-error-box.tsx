import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'

interface SlotErrorBoxProps {
  error: string | null
  onDismiss?: () => void
}

export function SlotErrorBox({ error, onDismiss }: SlotErrorBoxProps) {
  const { t } = useTranslation('node')
  const [expanded, setExpanded] = useState(false)

  if (!error) return null

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-sm p-3 text-xs text-destructive">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 hover:underline"
        >
          {expanded ? (
            <AppIcon name="expand_more" size={12} />
          ) : (
            <AppIcon name="chevron_right" size={12} />
          )}
          {t('slotErrorBox.executionFailed')}
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-destructive/70 hover:text-destructive"
          >
            <AppIcon name="close" size={12} />
          </button>
        )}
      </div>
      {expanded && (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-destructive/80">
          {error}
        </pre>
      )}
    </div>
  )
}
