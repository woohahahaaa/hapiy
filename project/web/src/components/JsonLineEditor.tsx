import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { JsonTokens } from '@/components/JsonHighlight'
import { splitJsonLines } from '@/lib/json-lines'

interface JsonLineEditorProps {
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly readOnly?: boolean
  readonly className?: string
}

// Shared metrics between the gutter, the highlighted backdrop and the
// editable overlay so every layer lines up pixel-perfect.
const FONT_CLASSES = 'font-mono text-xs leading-relaxed whitespace-pre-wrap break-words'
const PADDING_CLASSES = 'p-3'

export function JsonLineEditor({
  value,
  onChange,
  readOnly = false,
  className,
}: JsonLineEditorProps) {
  const { t } = useTranslation('topology')
  const gutterRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lines = splitJsonLines(value)

  // The textarea is the only scroll container; the gutter and the syntax
  // backdrop are clipped layers that follow its scroll offset.
  const syncScroll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop
      gutterRef.current.scrollLeft = textarea.scrollLeft
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = textarea.scrollTop
      backdropRef.current.scrollLeft = textarea.scrollLeft
    }
  }

  return (
    <div
      className={cn(
        'relative flex w-full overflow-hidden rounded-md border border-border bg-muted/30',
        FONT_CLASSES,
        className,
      )}
    >
      <div
        ref={gutterRef}
        aria-hidden
        className={cn(
          'w-14 shrink-0 select-none overflow-hidden border-r border-border bg-muted/40 py-3 text-right text-muted-foreground/70',
        )}
      >
        {lines.map((_, index) => (
          <div key={index} className="pr-2 leading-relaxed tabular-nums">
            {index + 1}
          </div>
        ))}
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <pre
          ref={backdropRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 m-0 overflow-hidden text-transparent',
            FONT_CLASSES,
            PADDING_CLASSES,
          )}
        >
          <JsonTokens text={value} />
        </pre>
        <textarea
          ref={textareaRef}
          className={cn(
            'absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none',
            FONT_CLASSES,
            PADDING_CLASSES,
          )}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          wrap="soft"
          readOnly={readOnly}
          aria-label={t('jsonEditor.contentAria')}
        />
      </div>
    </div>
  )
}
