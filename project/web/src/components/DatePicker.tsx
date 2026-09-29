import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buildMonthCells, formatDateValue, parseDateValue, type DateValue } from '@/lib/date'
import { cn } from '@/lib/utils'

export interface DatePickerProps {
  value?: DateValue
  onChange: (value: DateValue | undefined) => void
  placeholder?: string
  className?: string
  'aria-label'?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)
  const [viewMonth, setViewMonth] = useState<Date>(() => selected ?? new Date())

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'zh-CN'
  // 中文习惯周一开头，英文周日开头。
  const weekStartsOn: 0 | 1 = locale === 'en-US' ? 0 : 1

  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(viewMonth)

  const displayLabel = selected
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(selected)
    : null

  const weekdayLabels = useMemo(() => {
    const baseSunday = new Date(2021, 7, 1) // 2021-08-01 是周日
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
        new Date(baseSunday.getFullYear(), baseSunday.getMonth(), baseSunday.getDate() + ((weekStartsOn + index) % 7)),
      ),
    )
  }, [locale, weekStartsOn])

  const cells = buildMonthCells(viewMonth.getFullYear(), viewMonth.getMonth(), weekStartsOn)
  const todayValue = formatDateValue(new Date())

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) setViewMonth(selected ?? new Date())
  }

  const moveMonth = (delta: number) => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1))
  }

  const pick = (date: Date) => {
    onChange(formatDateValue(date))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'flex h-8 w-36 items-center gap-1.5 rounded-md border border-input bg-input/30 px-2.5 text-xs transition-colors outline-none',
            'hover:bg-input/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50',
            className,
          )}
        >
          <AppIcon name="schedule" className="shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !displayLabel && 'text-muted-foreground')}>
            {displayLabel ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('datePicker.prevMonth')}
            onClick={() => moveMonth(-1)}
          >
            <AppIcon name="chevron_right" className="rotate-180" />
          </Button>
          <span className="text-xs font-medium">{monthLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('datePicker.nextMonth')}
            onClick={() => moveMonth(1)}
          >
            <AppIcon name="chevron_right" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {weekdayLabels.map((label) => (
            <span
              key={label}
              className="flex size-8 items-center justify-center text-[10px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
          {cells.map((cell, index) => {
            if (!cell) return <span key={`blank-${index}`} className="size-8" />
            const cellValue = formatDateValue(cell)
            const isSelected = cellValue === value
            const isToday = !isSelected && cellValue === todayValue
            return (
              <button
                key={cellValue}
                type="button"
                onClick={() => pick(cell)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md text-xs transition-colors outline-none',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring/50',
                  isSelected &&
                    'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  isToday && 'bg-accent text-accent-foreground',
                )}
              >
                {cell.getDate()}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!value}
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
          >
            {t('action.clear')}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => pick(new Date())}>
            {t('datePicker.today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
