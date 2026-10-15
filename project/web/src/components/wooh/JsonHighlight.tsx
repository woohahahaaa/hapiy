import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Token kinds for the JSON / YAML syntax highlighters ──
type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'whitespace' | 'comment'

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
    case 'comment':
      return 'text-muted-foreground/60 italic'
    case 'whitespace':
      return ''
  }
}

// ── YAML syntax highlighter (take-over files like dsh's cordis.patch.yml) ──
// Line-based, because YAML is line-oriented: an optional list dash, an
// optional `key:`, then the value — quoted strings / numbers / booleans get
// the same colors as JSON, comments are dimmed.
const YAML_KEY_RE = /^(\s*(?:-\s+)?)((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|(?:[^:\s#'"[\]{},][^:#]*?))(\s*:)(?=\s|$)/
const YAML_SCALAR_RE = /"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[{},[\]]|-?\b\d+(?:\.\d+)?\b|\b(?:true|false|null|True|False|Null|yes|no|on|off)\b|[^\s,{}[\]'"]+/g

// commentStartOf returns the index where a YAML comment starts ('#' at line
// start or after whitespace, outside quotes), or -1.
function commentStartOf(line: string): number {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inDouble) {
      if (c === '\\') { i++; continue }
      if (c === '"') inDouble = false
      continue
    }
    if (inSingle) {
      if (c === "'") {
        if (line[i + 1] === "'") { i++; continue }
        inSingle = false
      }
      continue
    }
    if (c === '"') { inDouble = true; continue }
    if (c === "'") { inSingle = true; continue }
    if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return i
  }
  return -1
}

function tokenizeYamlValue(text: string): JsonToken[] {
  const out: JsonToken[] = []
  let lastIndex = 0
  for (const match of text.matchAll(YAML_SCALAR_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) out.push({ kind: 'whitespace', text: text.slice(lastIndex, start) })
    const m = match[0]
    let kind: TokenKind = 'string'
    if (m === 'true' || m === 'false' || m === 'True' || m === 'False' || m === 'yes' || m === 'no' || m === 'on' || m === 'off') kind = 'boolean'
    else if (m === 'null' || m === 'Null') kind = 'null'
    else if (/^-?\d/.test(m)) kind = 'number'
    else if ('{}[],'.includes(m[0]) && m.length === 1) kind = 'punct'
    out.push({ kind, text: m })
    lastIndex = start + m.length
  }
  if (lastIndex < text.length) out.push({ kind: 'whitespace', text: text.slice(lastIndex) })
  return out
}

export function tokenizeYaml(text: string): readonly JsonToken[] {
  const tokens: JsonToken[] = []
  const lines = text.split('\n')
  lines.forEach((line, idx) => {
    if (idx > 0) tokens.push({ kind: 'whitespace', text: '\n' })
    const commentAt = commentStartOf(line)
    const body = commentAt >= 0 ? line.slice(0, commentAt) : line
    let rest = body
    const keyMatch = YAML_KEY_RE.exec(rest)
    if (keyMatch) {
      if (keyMatch[1]) tokens.push({ kind: 'whitespace', text: keyMatch[1] })
      tokens.push({ kind: 'key', text: keyMatch[2] })
      tokens.push({ kind: 'punct', text: keyMatch[3] })
      rest = rest.slice(keyMatch[0].length)
    } else {
      const lead = /^[ \t]*/.exec(rest)![0]
      if (lead) {
        tokens.push({ kind: 'whitespace', text: lead })
        rest = rest.slice(lead.length)
      }
      if (rest.startsWith('-')) {
        tokens.push({ kind: 'punct', text: '-' })
        rest = rest.slice(1)
      }
    }
    tokens.push(...tokenizeYamlValue(rest))
    if (commentAt >= 0) tokens.push({ kind: 'comment', text: line.slice(commentAt) })
  })
  return tokens
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

// ── YamlTokens: low-level — render a YAML string as colored spans ──
export function YamlTokens({ text, className }: { readonly text: string; readonly className?: string }) {
  const tokens = useMemo(() => tokenizeYaml(text), [text])
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
        'overflow-auto rounded-none border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground',
        className,
      )}>
        {text}
      </pre>
    )
  }
  return (
    <pre className={cn(
      'overflow-auto rounded-none border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
      className,
    )}>
      <JsonTokens text={text} />
    </pre>
  )
}