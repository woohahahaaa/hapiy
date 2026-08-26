import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { AppIcon } from '@/components/AppIcon'
import type { Action } from './serializer'

type JsonLiteral = boolean | number | string | null

const LITERAL_PATTERN = /^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/

function tryParseLiteral(raw: string): JsonLiteral | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (LITERAL_PATTERN.test(trimmed)) return Number(trimmed)
  return undefined
}

function literalDisplay(value: JsonLiteral): string {
  if (value === null) return 'null'
  return String(value)
}

interface LiteralValueInputProps {
  action: Action
  onChange: (next: Action) => void
  placeholder?: string
}

// value 字段的智能输入：识别 true / false / null / 数字，命中时弹建议；
// 选中建议后切换为半透明主题色 tag，右上删除后回到普通字符串模式。
export function LiteralValueInput({ action, onChange, placeholder }: LiteralValueInputProps) {
  const literal = action.valueLiteral
  const [showSuggestion, setShowSuggestion] = useState(false)

  if (literal !== undefined) {
    return (
      <div className="flex min-w-0 flex-1 items-center">
        <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-foreground">
          <span>{literalDisplay(literal)}</span>
          <button
            type="button"
            onClick={() => onChange({ ...action, valueLiteral: undefined })}
            className="flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/25 hover:text-foreground"
            aria-label="切换回字符串输入"
          >
            <AppIcon name="close" size={11} />
          </button>
        </span>
      </div>
    )
  }

  const candidate = tryParseLiteral(action.value)
  const suggestionActive = showSuggestion && candidate !== undefined && action.value.trim() !== ''

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <Input
        className="h-7 w-full font-mono text-xs"
        value={action.value}
        onChange={(e) => onChange({ ...action, value: e.target.value })}
        onFocus={() => setShowSuggestion(true)}
        onBlur={() => setShowSuggestion(false)}
        placeholder={placeholder}
      />
      {suggestionActive && (
        <button
          type="button"
          // 阻止 input 的 onBlur 先于点击触发，避免下拉先消失
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (candidate === undefined) return
            onChange({ ...action, valueLiteral: candidate, value: literalDisplay(candidate) })
            setShowSuggestion(false)
          }}
          className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1.5 rounded-md border border-primary/30 bg-popover px-2 py-1 text-xs shadow-md transition-colors hover:bg-primary/10"
        >
          <AppIcon name="data_object" size={12} className="text-primary" />
          <span className="text-muted-foreground">字面量</span>
          <span className="font-mono text-foreground">{literalDisplay(candidate)}</span>
        </button>
      )}
    </div>
  )
}