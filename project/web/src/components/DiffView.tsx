import { diffLines } from 'diff'

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
    return <span className="text-xs text-muted-foreground">（空）</span>
  }

  if (!beforeText || !afterText) {
    const text = beforeText || afterText
    return (
      <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {text}
      </pre>
    )
  }

  const parts = diffLines(beforeText, afterText)
  return (
    <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre">
      {parts.map((part, i) => {
        const lines = part.value.split('\n')
        const lastIndex = lines.length - 1
        const hasTrailingNewline = part.value.endsWith('\n')
        return lines.map((line, j) => {
          // `String.split('\n')` on a value ending with '\n' produces a trailing
          // empty-string element (e.g. "{\n}\n" → ["{", "}", ""]); that empty element
          // is an artifact, not a real blank line, so drop it.
          if (j === lastIndex && line === '' && hasTrailingNewline) return null
          const prefix = part.added ? '+' : part.removed ? '-' : ' '
          const className = part.added
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : part.removed
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
              : 'text-foreground'
          return (
            <span key={`${i}-${j}`} className={className}>
              {prefix} {line}
              {'\n'}
            </span>
          )
        })
      })}
    </pre>
  )
}
