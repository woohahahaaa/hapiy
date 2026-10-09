import { diffLines } from 'diff'
import { JsonTokens } from '@/components/JsonHighlight'
import { i18n } from '@/i18n/i18n'

interface DiffViewProps {
  readonly before: unknown
  readonly after: unknown
}

function formatBody(body: unknown): string {
  if (body === null || body === undefined) return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body, null, 2)
}

export function DiffView({ before, after }: DiffViewProps) {
  const beforeText = formatBody(before)
  const afterText = formatBody(after)

  if (!beforeText && !afterText) {
    return <span className="text-xs text-muted-foreground">{i18n.t('topology:diff.empty')}</span>
  }

  if (!beforeText || !afterText) {
    return (
      <pre className="overflow-auto rounded-none border border-border-subtle bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre">
        <JsonTokens text={beforeText || afterText} />
      </pre>
    )
  }

  const parts = diffLines(beforeText, afterText)
  return (
    <pre className="overflow-auto rounded-none border border-border-subtle bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre relative">
      {parts.map((part, i) => {
        const lines = part.value.split('\n')
        const lastIndex = lines.length - 1
        const hasTrailingNewline = part.value.endsWith('\n')
        const containerClass = part.added
          ? 'block w-full bg-emerald-500/15'
          : part.removed
            ? 'block w-full bg-rose-500/15'
            : 'block w-full'
        return lines.map((line, j) => {
          if (j === lastIndex && line === '' && hasTrailingNewline) return null
          const prefix = part.added ? '+' : part.removed ? '-' : ' '
          return (
            <span key={`${i}-${j}`} className={containerClass}>
              {prefix}{' '}
              <JsonTokens text={line} />
            </span>
          )
        })
      })}
    </pre>
  )
}