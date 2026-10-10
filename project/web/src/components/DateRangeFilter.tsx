import { useTranslation } from 'react-i18next'

import { DatePicker } from '@/components/DatePicker'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DateRange } from '@/lib/dashboard-api'

type QuickPreset = 'all' | 'month' | 'week' | 'day' | 'today'

const QUICK_OPTIONS: readonly { value: QuickPreset; labelKey: string }[] = [
  { value: 'all', labelKey: 'dateRange.all' },
  { value: 'month', labelKey: 'dateRange.lastMonth' },
  { value: 'week', labelKey: 'dateRange.lastWeek' },
  { value: 'day', labelKey: 'dateRange.lastDay' },
  { value: 'today', labelKey: 'dateRange.today' },
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
  if (range.from === today) return 'today'
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
  const { t } = useTranslation('logs')

  const handleQuick = (preset: QuickPreset) => {
    if (preset === 'all') {
      onChange({})
      return
    }
    const today = new Date()
    if (preset === 'today') {
      onChange({ from: formatDate(today), to: formatDate(today) })
      return
    }
    const from = new Date()
    const days = preset === 'month' ? 30 : preset === 'week' ? 7 : 1
    from.setDate(today.getDate() - days)
    onChange({ from: formatDate(from), to: formatDate(today) })
  }

  const activePreset = detectPreset(value)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DatePicker
        value={value.from}
        onChange={(from) => onChange({ ...value, from })}
        size="sm"
        placeholder={t('dateRange.start')}
        aria-label={t('dateRange.start')}
      />
      <span className="text-xs text-muted-foreground">{t('dateRange.to')}</span>
      <DatePicker
        value={value.to}
        onChange={(to) => onChange({ ...value, to })}
        size="sm"
        placeholder={t('dateRange.end')}
        aria-label={t('dateRange.end')}
      />
      <div className="ml-1 flex flex-wrap items-center gap-1">
        {QUICK_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={activePreset === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleQuick(opt.value)}
          >
            {t(opt.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  )
}
