import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface RuleSelectOption {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
}

interface RuleSelectProps {
  value: string | null
  options: readonly RuleSelectOption[]
  placeholder: string
  onChange: (id: string | null) => void
  emptyHint?: string
  // 加载中 / 加载失败（重试）与空列表是三个互斥的下拉状态，绝不会在加载中
  // 展示「暂无可用规则」。onOpenRefresh 在下拉打开时触发（仅刷新该类型）。
  loading?: boolean
  error?: string | null
  onOpenRefresh?: () => void
}

const NONE_VALUE = '__none__'

// Dropdown for binding a slot item to one of the rules configured in PolicyPage.
// When no rule is chosen, the SelectValue renders a friendly placeholder instead
// of the raw sentinel key. 若 value 指向的规则已被删除（孤儿引用），同样回退到
// 占位态「请选择」，而不是把原始 ruleId 暴露出来；下拉里仍保留可选项「请选择」，
// 用户无需知道旧 id 也能重新绑定。
export function RuleSelect({
  value,
  options,
  placeholder,
  onChange,
  emptyHint,
  loading = false,
  error = null,
  onOpenRefresh,
}: RuleSelectProps) {
  const { t } = useTranslation('node')
  const isEmpty = options.length === 0
  const selected = options.find((o) => o.id === value)
  const triggerValue = value ?? NONE_VALUE
  const resolvedEmptyHint = emptyHint ?? t('ruleSelect.emptyHint')
  // 触发区展示：命中规则 → 规则名；未绑定/孤儿引用/加载失败 → 占位文案。
  const displayValue =
    selected != null
      ? selected.label
      : value == null && isEmpty && !loading && error == null
        ? resolvedEmptyHint
        : placeholder
  return (
    <Select
      value={triggerValue}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
      onOpenChange={(open) => {
        if (open) onOpenRefresh?.()
      }}
    >
      <SelectTrigger size="sm" className="w-0 min-w-full">
        <SelectValue placeholder={placeholder} className="min-w-0">
          <span className="block min-w-0 truncate">{displayValue}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {loading ? (
          <div className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs text-muted-foreground">
            <AppIcon name="progress_activity" size={12} className="animate-spin" />
            {t('common:state.loading')}
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
            <span className="text-destructive">{t('ruleSelect.loadFailed')}</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onOpenRefresh?.()
              }}
              className="rounded-sm border border-border-subtle px-1.5 py-0.5 transition-colors hover:bg-muted/60"
            >
              {t('common:action.retry')}
            </button>
          </div>
        ) : (
          <>
            <SelectItem value={NONE_VALUE}>{isEmpty ? resolvedEmptyHint : placeholder}</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt.id} value={opt.id} disabled={opt.disabled}>
                {opt.label}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  )
}