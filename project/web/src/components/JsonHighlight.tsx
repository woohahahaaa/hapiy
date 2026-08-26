import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Token kinds for the JSON syntax highlighter ──
type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'whitespace'

interface JsonToken {
  readonly kind: TokenKind
  readonly text: string
}

// One pass: pull out keys (string followed by colon), bare strings, numbers,
// booleans, null, and punctuation. Whitespace between tokens is preserved so
// the original indentation round-trips through React.
const TOKEN_RE = /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g

export function tokenizeJson(text: string): readonly JsonToken[] {
  const tokens: JsonToken[] = []
  let lastIndex = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      tokens.push({ kind: 'whitespace', text: text.slice(lastIndex, start) })
    }
    const m = match[0]
    let kind: TokenKind
    if (m[0] === '"') {
      // string followed by `:` (with optional whitespace) is an object key
      const after = text[start + m.length]
      kind = after === ':' ? 'key' : 'string'
    } else if (m === 'true' || m === 'false') {
      kind = 'boolean'
    } else if (m === 'null') {
      kind = 'null'
    } else if (m[0] === '-' || (m[0] >= '0' && m[0] <= '9')) {
      kind = 'number'
    } else {
      kind = 'punct'
    }
    tokens.push({ kind, text: m })
    lastIndex = start + m.length
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: 'whitespace', text: text.slice(lastIndex) })
  }
  return tokens
}

// Token classes are emitted as full literal strings (not constructed) so that
// Tailwind's content scanner picks them up at build time.
function tokenClassName(kind: TokenKind): string {
  switch (kind) {
    case 'key':
      return 'text-sky-700 dark:text-sky-300'
    case 'string':
      return 'text-emerald-700 dark:text-emerald-300'
    case 'number':
      return 'text-amber-700 dark:text-amber-300'
    case 'boolean':
      return 'text-violet-700 dark:text-violet-300'
    case 'null':
      return 'text-rose-700 dark:text-rose-300'
    case 'punct':
      return 'text-muted-foreground'
    case 'whitespace':
      return ''
  }
}

// ── JsonTokens: low-level — render a JSON string as colored spans ──
export function JsonTokens({ text, className }: { readonly text: string; readonly className?: string }) {
  const tokens = useMemo(() => tokenizeJson(text), [text])
  return (
    <span className={className}>
      {tokens.map((t, i) =>
        t.kind === 'whitespace'
          ? t.text
          : <span key={i} className={tokenClassName(t.kind)}>{t.text}</span>,
      )}
    </span>
  )
}

// ── JsonHighlight: high-level — accepts any value, JSON-stringifies it, then
// colors it. Falls back to a muted single-color display when the input is not
// valid JSON (or is a plain string the caller passed as a raw code blob). ──
interface JsonHighlightProps {
  /** Value to render. If a string, treated as already-formatted JSON when it
   * parses; otherwise rendered as plain text. If anything else, JSON.stringified. */
  readonly value: unknown
  readonly className?: string
}

function stringify(value: unknown): { text: string; isJson: boolean } {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return { text: '', isJson: false }
    // Heuristic: starts with { [ " or a JSON literal — try to parse and re-format.
    if (/^[\{\[]/.test(trimmed) || /^(true|false|null)\b/.test(trimmed) || /^-?\d/.test(trimmed)) {
      try {
        return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true }
      } catch {
        return { text: value, isJson: false }
      }
    }
    return { text: value, isJson: false }
  }
  if (value === undefined || value === null) return { text: '', isJson: true }
  try {
    return { text: JSON.stringify(value, null, 2), isJson: true }
  } catch {
    return { text: String(value), isJson: false }
  }
}

export function JsonHighlight({ value, className }: JsonHighlightProps): ReactNode {
  const { text, isJson } = useMemo(() => stringify(value), [value])
  if (text === '') return null
  if (!isJson) {
    return (
      <pre className={cn(
        'overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground',
        className,
      )}>
        {text}
      </pre>
    )
  }
  return (
    <pre className={cn(
      'overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
      className,
    )}>
      <JsonTokens text={text} />
    </pre>
  )
}