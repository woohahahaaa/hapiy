import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DateRange } from '@/lib/dashboard-api'

type QuickPreset = 'all' | 'month' | 'week' | 'day'

const QUICK_OPTIONS: readonly { value: QuickPreset; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'month', label: '一个月' },
  { value: 'week', label: '一周' },
  { value: 'day', label: '一天' },
]

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function detectPreset(range: DateRange): QuickPreset | null {
  if (!range.from && !range.to) return 'all'
  if (!range.to) return null
  const today = formatDate(new Date())
  if (range.to !== today) return null
  for (const [days, preset] of [[30, 'month'], [7, 'week'], [1, 'day']] as const) {
    const d = new Date()
    d.setDate(d.getDate() - days)
    if (range.from === formatDate(d)) return preset
  }
  return null
}

export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}) {
  const handleQuick = (preset: QuickPreset) => {
    if (preset === 'all') {
      onChange({})
      return
    }
    const today = new Date()
    const from = new Date()
    const days = preset === 'month' ? 30 : preset === 'week' ? 7 : 1
    from.setDate(today.getDate() - days)
    onChange({ from: formatDate(from), to: formatDate(today) })
  }

  const activePreset = detectPreset(value)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        type="date"
        value={value.from ?? ''}
        onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        className="w-36"
      />
      <span className="text-xs text-muted-foreground">至</span>
      <Input
        type="date"
        value={value.to ?? ''}
        onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        className="w-36"
      />
      <div className="flex items-center gap-1 ml-1">
        {QUICK_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={activePreset === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleQuick(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
