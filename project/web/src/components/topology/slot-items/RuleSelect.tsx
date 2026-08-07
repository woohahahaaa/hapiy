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
}

const NONE_VALUE = '__none__'

// Dropdown for binding a slot item to one of the rules configured in PolicyPage.
// When no rule is chosen, the SelectValue renders a friendly placeholder instead
// of the raw sentinel key.
export function RuleSelect({
  value,
  options,
  placeholder,
  onChange,
  emptyHint = '暂无可用规则',
}: RuleSelectProps) {
  const isEmpty = options.length === 0
  const triggerValue = value ?? NONE_VALUE
  const displayValue =
    triggerValue === NONE_VALUE
      ? isEmpty
        ? emptyHint
        : placeholder
      : (options.find((o) => o.id === triggerValue)?.label ?? triggerValue)
  return (
    <Select
      value={triggerValue}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder={placeholder}>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>{isEmpty ? emptyHint : placeholder}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}