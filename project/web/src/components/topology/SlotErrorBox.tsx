import { useState } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'

interface SlotErrorBoxProps {
  error: string | null
  onDismiss?: () => void
}

export function SlotErrorBox({ error, onDismiss }: SlotErrorBoxProps) {
  const [expanded, setExpanded] = useState(false)

  if (!error) return null

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-xs text-destructive">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 hover:underline"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          规则执行失败
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-destructive/70 hover:text-destructive"
          >
            <X className="size-3" />
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
