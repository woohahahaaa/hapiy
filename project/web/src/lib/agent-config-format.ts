// 管理模型右侧片段面板的显示格式：跟着接管规则的配置文件后缀走 ——
// .yml / .yaml 的接管文件（dsh 的 cordis.patch.yml 等）显示 YAML，
// 其余显示 JSON。写入由服务端按同一后缀决定（YAML 侧节点编辑）。

export type AgentConfigFormat = 'json' | 'yaml'

// isYAMLConfigPath reports whether the take-over file is YAML (.yml/.yaml).
export function isYAMLConfigPath(path: string | undefined | null): boolean {
  const lower = (path ?? '').trim().toLowerCase()
  return lower.endsWith('.yml') || lower.endsWith('.yaml')
}

// configFormatForPath maps a take-over file path to its snippet format.
export function configFormatForPath(path: string | undefined | null): AgentConfigFormat {
  return isYAMLConfigPath(path) ? 'yaml' : 'json'
}

// stringifyConfigValue renders a provider / model snippet for the right-hand
// panel in the format the take-over file uses. Strings (already-serialized
// content, e.g. the live working copy) pass through untouched.
export function stringifyConfigValue(value: unknown, format: AgentConfigFormat): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (format === 'yaml') return toYAML(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// ── YAML emitter ──────────────────────────────────────────────────
// A small block-style emitter for the plain data that config snippets hold
// (objects / arrays / strings / numbers / booleans / null). Double-quoted
// scalars are emitted as JSON strings — YAML's double-quoted style is a
// superset of JSON string syntax, so JSON escapes are always valid.

// YAML_AMBIGUOUS: plain scalars that would re-read as something other than
// the string they spell (core-schema booleans / null / numbers, plus the
// 1.1-style yes/no/on/off that some parsers still resolve).
const YAML_AMBIGUOUS =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d+)?|\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN))$/
// Characters that may not open a plain scalar; `-`, `?` and `:` are only
// reserved when followed by a space, but quoting those forms is harmless.
const YAML_UNSAFE_START = /^[-?:,[\]{}#&*!|>'"%@` \t]/

function plainSafeYAML(s: string): boolean {
  if (s === '' || s !== s.trim()) return false
  if (/[\n\t]/.test(s)) return false
  if (YAML_AMBIGUOUS.test(s)) return false
  if (YAML_UNSAFE_START.test(s)) return false
  if (s.includes(': ') || s.includes(' #')) return false
  if (s.endsWith(':')) return false
  return true
}

function scalarToYAML(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false'
    case 'number':
      return Number.isFinite(v) ? String(v) : JSON.stringify(String(v))
    case 'string':
      return plainSafeYAML(v) ? v : JSON.stringify(v)
    default:
      return JSON.stringify(String(v))
  }
}

function isScalarLike(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'object'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function pad(indent: number): string {
  return ' '.repeat(indent)
}

function emitKeyValue(key: string, v: unknown, indent: number, lines: string[]): void {
  const keyText = plainSafeYAML(key) ? key : JSON.stringify(key)
  if (isScalarLike(v)) {
    lines.push(`${pad(indent)}${keyText}: ${scalarToYAML(v)}`)
    return
  }
  if (Array.isArray(v) && v.length === 0) {
    lines.push(`${pad(indent)}${keyText}: []`)
    return
  }
  if (isRecord(v) && Object.keys(v).length === 0) {
    lines.push(`${pad(indent)}${keyText}: {}`)
    return
  }
  lines.push(`${pad(indent)}${keyText}:`)
  if (Array.isArray(v)) {
    for (const item of v) emitItem(item, indent + 2, lines)
    return
  }
  emitBlock(v, indent + 2, lines)
}

// emitItem writes one sequence entry: scalars inline, objects with their
// first key on the dash line (`- id: x`, the shape dsh configs use), nested
// blocks indented under the dash.
function emitItem(item: unknown, indent: number, lines: string[]): void {
  if (isScalarLike(item)) {
    lines.push(`${pad(indent)}- ${scalarToYAML(item)}`)
    return
  }
  if (Array.isArray(item)) {
    if (item.length === 0) {
      lines.push(`${pad(indent)}- []`)
      return
    }
    lines.push(`${pad(indent)}-`)
    for (const sub of item) emitItem(sub, indent + 2, lines)
    return
  }
  if (!isRecord(item)) {
    lines.push(`${pad(indent)}- ${scalarToYAML(item)}`)
    return
  }
  const entries = Object.entries(item)
  if (entries.length === 0) {
    lines.push(`${pad(indent)}- {}`)
    return
  }
  const [firstKey, firstValue] = entries[0]
  const firstKeyText = plainSafeYAML(firstKey) ? firstKey : JSON.stringify(firstKey)
  if (isScalarLike(firstValue)) {
    lines.push(`${pad(indent)}- ${firstKeyText}: ${scalarToYAML(firstValue)}`)
  } else if (Array.isArray(firstValue) && firstValue.length === 0) {
    lines.push(`${pad(indent)}- ${firstKeyText}: []`)
  } else if (isRecord(firstValue) && Object.keys(firstValue).length === 0) {
    lines.push(`${pad(indent)}- ${firstKeyText}: {}`)
  } else {
    lines.push(`${pad(indent)}- ${firstKeyText}:`)
    // `- ` occupies two columns, so the nested block aligns at indent + 4.
    if (Array.isArray(firstValue)) {
      for (const sub of firstValue) emitItem(sub, indent + 4, lines)
    } else {
      emitBlock(firstValue, indent + 4, lines)
    }
  }
  for (const [key, value] of entries.slice(1)) emitKeyValue(key, value, indent + 2, lines)
}

function emitBlock(value: unknown, indent: number, lines: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) emitItem(item, indent, lines)
    return
  }
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) emitKeyValue(key, v, indent, lines)
    return
  }
  lines.push(pad(indent) + scalarToYAML(value))
}

// toYAML serializes a plain JS value as a block-style YAML document.
export function toYAML(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  const lines: string[] = []
  emitBlock(value, 0, lines)
  return lines.join('\n')
}
