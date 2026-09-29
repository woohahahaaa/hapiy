import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/tooltip'
import { cn } from '@/lib/utils'
import { parseValueInput } from './serializer'

interface ConventionValueInputProps {
  /** 输入文本（action.value / condition.value）。 */
  text: string
  onChange: (next: string) => void
  placeholder?: string
  /** 约定是否生效（set 的 action / 条件值恒为 true）；不生效时保持纯字符串输入。 */
  active: boolean
  /** 不带引号的裸文本按变量引用解析（set 的 action）。 */
  refs?: boolean
  /** true/false/null/数字按 JSON 字面量解析（body scope 的 action / 条件值）。 */
  literals?: boolean
}

// 「引号约定」的共享输入框：按 parseValueInput 结果给文本着色
// （带引号字符串 → 绿、原生字面量 → 紫、变量引用 → 蓝、不合法 → 红），
// 聚焦时在上方弹出约定说明 tooltip，不合法时在下方保留 muted 提示。
export function ConventionValueInput({
  text,
  onChange,
  placeholder,
  active,
  refs = false,
  literals = true,
}: ConventionValueInputProps) {
  const { t } = useTranslation('rewrite')
  const [focused, setFocused] = useState(false)
  const kind = active ? parseValueInput(text, { literals, refs }).kind : null
  const invalid = kind === 'invalid' && text.trim() !== ''
  const colorClass = !active || text.trim() === ''
    ? ''
    : kind === 'string'
      ? 'text-emerald-600 dark:text-emerald-400'
      : kind === 'literal'
        ? 'text-violet-600 dark:text-violet-400'
        : kind === 'ref'
          ? 'text-sky-600 dark:text-sky-400'
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
            <TooltipContent side="top" align="start">
              <div className="flex flex-col items-start gap-0.5 text-left">
                {refs && (
                  <p className="text-xs">
                    {t('convention.refHint')}
                  </p>
                )}
                {literals && (
                  <p className="text-xs">
                    {t('convention.literalHint')}
                  </p>
                )}
                <p className="text-xs">
                  {t('convention.stringHint')}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        input
      )}
      {invalid && <p className="text-xs text-muted-foreground">{t('value.invalidHint')}</p>}
    </div>
  )
}
