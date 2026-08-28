import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { parseValueInput } from './serializer'

interface ConventionValueInputProps {
  /** 输入文本（action.value / condition.value）。 */
  text: string
  onChange: (next: string) => void
  placeholder?: string
  /** 约定是否生效（literalCapable 的 action / 条件值恒为 true）；不生效时保持纯字符串输入。 */
  active: boolean
}

// 「字符串需手动加引号」约定的共享输入框：按 parseValueInput 结果给文本着色
// （带引号字符串 → 绿、原生字面量 → 紫、不合法 → 红），聚焦时在上方弹出
// 约定说明 tooltip，不合法时在下方保留 muted 提示。
export function ConventionValueInput({ text, onChange, placeholder, active }: ConventionValueInputProps) {
  const [focused, setFocused] = useState(false)
  const kind = active ? parseValueInput(text).kind : null
  const invalid = kind === 'invalid' && text.trim() !== ''
  const colorClass = !active || text.trim() === ''
    ? ''
    : kind === 'string'
      ? 'text-emerald-600 dark:text-emerald-400'
      : kind === 'literal'
        ? 'text-violet-600 dark:text-violet-400'
        : 'text-destructive'

  const input = (
    <Input
      className={cn('h-7 w-full font-mono text-xs', colorClass)}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
    />
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {active ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip open={focused}>
            <TooltipTrigger asChild>{input}</TooltipTrigger>
            <TooltipContent
              side="top"
              className="flex-col items-start gap-1 whitespace-nowrap bg-popover text-popover-foreground text-left"
            >
              <p className="text-xs">
                不加引号 → 按 JSON 字面量解析（true / false / null / 数字）
              </p>
              <p className="text-xs">
                加引号 → 按字符串发送，引号内为实际内容
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        input
      )}
      {invalid && <p className="text-xs text-muted-foreground">字符串需要手动添加引号</p>}
    </div>
  )
}
