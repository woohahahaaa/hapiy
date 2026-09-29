import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DEFAULT_PARTS,
  buildDateFromParts,
  buildMonthCells,
  dateToParts,
  defaultModeFor,
  formatPartsValue,
  parsePartsValue,
  resolveFields,
  type DateField,
  type DateMode,
  type DateParts,
  type DateValue,
} from '@/lib/date'
import { cn } from '@/lib/utils'

export interface DatePickerProps {
  value?: DateValue
  onChange: (value: DateValue | undefined) => void
  /** 最小可选单位：year / month / day / hour / minute / second，默认 day。 */
  precision?: DateField
  /** date=只选日期，time=只选时间，datetime=日期+时间；不传时按 precision 推断。 */
  mode?: DateMode
  placeholder?: string
  className?: string
  contentClassName?: string
  align?: 'start' | 'center' | 'end'
  size?: 'sm' | 'default'
  disabled?: boolean
  /** 是否显示「清空」，默认 true。 */
  clearable?: boolean
  /** 可选区间下界（ISO 部分串），超出置灰。 */
  min?: DateValue
  /** 可选区间上界（ISO 部分串），超出置灰。 */
  max?: DateValue
  /** 分钟步进，默认 1。 */
  minuteStep?: number
  /** 秒步进，默认 1。 */
  secondStep?: number
  'aria-label'?: string
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function DatePicker({
  value,
  onChange,
  precision = 'day',
  mode,
  placeholder,
  className,
  contentClassName,
  align = 'start',
  size = 'default',
  disabled = false,
  clearable = true,
  min,
  max,
  minuteStep = 1,
  secondStep = 1,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const { t, i18n } = useTranslation()

  const fields = useMemo(
    () => resolveFields(mode ?? defaultModeFor(precision), precision),
    [mode, precision],
  )
  const hasDate = fields.includes('year')
  const hasTime = fields.includes('hour')
  const viewKind = !hasDate
    ? null
    : fields.length === 1
      ? 'year'
      : fields.includes('day')
        ? 'day'
        : 'month'

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'zh-CN'
  // 中文习惯周一开头，英文周日开头。
  const weekStartsOn: 0 | 1 = locale === 'en-US' ? 0 : 1

  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())

  const selected = parsePartsValue(value, fields)
  const todayParts = dateToParts(new Date())

  const minMs = useMemo(() => {
    const p = min ? parsePartsValue(min, ['year', 'month', 'day']) : null
    return p ? startOfDay(buildDateFromParts(p)).getTime() : null
  }, [min])
  const maxMs = useMemo(() => {
    const p = max ? parsePartsValue(max, ['year', 'month', 'day']) : null
    return p ? startOfDay(buildDateFromParts(p)).getTime() : null
  }, [max])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      const base = selected ?? dateToParts(new Date())
      setViewYear(base.year)
      setViewMonth(base.month - 1)
    }
  }

  const emit = (nextParts: DateParts) => {
    const emitted = formatPartsValue(nextParts, fields)
    if (emitted !== null) onChange(emitted)
  }
  const baseParts = (): DateParts => selected ?? { ...DEFAULT_PARTS }
  const commit = (patch: Partial<DateParts>, close: boolean) => {
    emit({ ...baseParts(), ...patch })
    if (close) setOpen(false)
  }

  const isOutOfRange = (date: Date) => {
    const ms = startOfDay(date).getTime()
    return (minMs !== null && ms < minMs) || (maxMs !== null && ms > maxMs)
  }

  const displayLabel = (() => {
    if (!selected) return null
    const opts: Intl.DateTimeFormatOptions = {}
    if (fields.includes('year')) opts.year = 'numeric'
    if (fields.includes('month')) opts.month = fields.includes('day') ? '2-digit' : 'long'
    if (fields.includes('day')) opts.day = '2-digit'
    if (fields.includes('hour')) opts.hour = '2-digit'
    if (fields.includes('minute')) opts.minute = '2-digit'
    if (fields.includes('second')) opts.second = '2-digit'
    return new Intl.DateTimeFormat(locale, opts).format(buildDateFromParts(selected))
  })()

  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(new Date(viewYear, viewMonth, 1))
  const decade = Math.floor(viewYear / 10) * 10

  const weekdayLabels = useMemo(() => {
    const baseSunday = new Date(2021, 7, 1) // 2021-08-01 是周日
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
        new Date(
          baseSunday.getFullYear(),
          baseSunday.getMonth(),
          baseSunday.getDate() + ((weekStartsOn + index) % 7),
        ),
      ),
    )
  }, [locale, weekStartsOn])

  const monthShort = (m: number) =>
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2000, m, 1))

  const dayCells = viewKind === 'day' ? buildMonthCells(viewYear, viewMonth, weekStartsOn) : []

  const isSelectedDay = (cell: Date) =>
    selected !== null &&
    selected.year === cell.getFullYear() &&
    selected.month === cell.getMonth() + 1 &&
    selected.day === cell.getDate()
  const isToday = (cell: Date) =>
    todayParts.year === cell.getFullYear() &&
    todayParts.month === cell.getMonth() + 1 &&
    todayParts.day === cell.getDate()

  const nav = (deltaYear: number, deltaMonth: number) => {
    const next = new Date(viewYear + deltaYear, viewMonth + deltaMonth, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const headerNav = (() => {
    if (viewKind === 'year') {
      return {
        prevLabel: t('datePicker.prevDecade'),
        nextLabel: t('datePicker.nextDecade'),
        title: `${decade} – ${decade + 11}`,
        onPrev: () => nav(-10, 0),
        onNext: () => nav(10, 0),
      }
    }
    if (viewKind === 'month') {
      return {
        prevLabel: t('datePicker.prevYear'),
        nextLabel: t('datePicker.nextYear'),
        title: `${viewYear}`,
        onPrev: () => nav(-1, 0),
        onNext: () => nav(1, 0),
      }
    }
    return {
      prevLabel: t('datePicker.prevMonth'),
      nextLabel: t('datePicker.nextMonth'),
      title: monthLabel,
      onPrev: () => nav(0, -1),
      onNext: () => nav(0, 1),
    }
  })()

  const timeFields = (
    [
      ['hour', t('datePicker.hour'), 23, 1],
      ['minute', t('datePicker.minute'), 59, minuteStep],
      ['second', t('datePicker.second'), 59, secondStep],
    ] as const
  ).filter(([field]) => fields.includes(field))

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'flex w-36 items-center gap-1.5 rounded-md border border-input bg-input/30 px-2.5 text-xs transition-colors outline-none',
            size === 'sm' ? 'h-7' : 'h-8',
            'hover:bg-input/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50',
            'disabled:pointer-events-none disabled:opacity-50',
            className,
          )}
        >
          <AppIcon name="schedule" className="shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {displayLabel ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('w-auto p-3', contentClassName)}>
        {viewKind !== null && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={headerNav.prevLabel}
              onClick={headerNav.onPrev}
            >
              <AppIcon name="chevron_right" className="rotate-180" />
            </Button>
            <span className="text-xs font-medium">{headerNav.title}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={headerNav.nextLabel}
              onClick={headerNav.onNext}
            >
              <AppIcon name="chevron_right" />
            </Button>
          </div>
        )}

        {viewKind === 'year' && (
          <div className="grid grid-cols-4 gap-0.5">
            {Array.from({ length: 12 }, (_, i) => {
              const year = decade + i
              const cellDate = new Date(year, 0, 1)
              const isSelected = selected?.year === year
              return (
                <button
                  key={year}
                  type="button"
                  disabled={isOutOfRange(cellDate)}
                  onClick={() => commit({ year }, true)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-md text-xs transition-colors outline-none',
                    'hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50',
                    'disabled:pointer-events-none disabled:opacity-30',
                    isSelected &&
                      'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  {year}
                </button>
              )
            })}
          </div>
        )}

        {viewKind === 'month' && (
          <div className="grid grid-cols-4 gap-0.5">
            {Array.from({ length: 12 }, (_, i) => {
              const month = i + 1
              const cellDate = new Date(viewYear, i, 1)
              const isSelected = selected?.year === viewYear && selected.month === month
              return (
                <button
                  key={month}
                  type="button"
                  disabled={isOutOfRange(cellDate)}
                  onClick={() => commit({ year: viewYear, month }, true)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-md text-xs transition-colors outline-none',
                    'hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50',
                    'disabled:pointer-events-none disabled:opacity-30',
                    isSelected &&
                      'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  {monthShort(i)}
                </button>
              )
            })}
          </div>
        )}

        {viewKind === 'day' && (
          <>
            <div className="grid grid-cols-7 gap-0.5">
              {weekdayLabels.map((label) => (
                <span
                  key={label}
                  className="flex size-8 items-center justify-center text-[10px] text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {dayCells.map((cell, index) => {
                if (!cell) return <span key={`blank-${index}`} className="size-8" />
                const isSelected = isSelectedDay(cell)
                const isTodayCell = !isSelected && isToday(cell)
                return (
                  <button
                    key={formatPartsValue(dateToParts(cell), ['year', 'month', 'day']) ?? ''}
                    type="button"
                    disabled={isOutOfRange(cell)}
                    onClick={() =>
                      commit(
                        {
                          year: cell.getFullYear(),
                          month: cell.getMonth() + 1,
                          day: cell.getDate(),
                        },
                        !hasTime,
                      )
                    }
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md text-xs transition-colors outline-none',
                      'hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50',
                      'disabled:pointer-events-none disabled:opacity-30',
                      isSelected &&
                        'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                      isTodayCell && 'bg-primary/10 text-primary font-medium',
                    )}
                  >
                    {cell.getDate()}
                  </button>
                )
              })}
            </div>
            {hasTime && <div className="mt-2 border-t border-border" />}
          </>
        )}

        {hasTime && (
          <div className="flex items-end justify-center gap-2 pt-2">
            {timeFields.map(([field, label, fieldMax, step]) => (
              <div key={field} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <Input
                  type="number"
                  min={0}
                  max={fieldMax}
                  step={step}
                  aria-label={label}
                  className="w-16 text-center"
                  value={String(selected?.[field] ?? 0)}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    const clamped = Number.isNaN(n) ? 0 : Math.min(fieldMax, Math.max(0, Math.trunc(n)))
                    commit({ [field]: clamped } as Partial<DateParts>, false)
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          {clearable ? (
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
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            {hasTime && (
              <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(false)}>
                {t('action.confirm')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                emit(dateToParts(new Date()))
                setOpen(false)
              }}
            >
              {hasTime ? t('datePicker.now') : t('datePicker.today')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
