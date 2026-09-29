import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PARTS,
  buildDateFromParts,
  buildMonthCells,
  dateToParts,
  formatDateValue,
  formatPartsValue,
  parseDateValue,
  parsePartsValue,
  resolveFields,
} from './date'

describe('resolveFields', () => {
  it('maps modes and precisions to editable fields', () => {
    expect(resolveFields('date', 'year')).toEqual(['year'])
    expect(resolveFields('date', 'month')).toEqual(['year', 'month'])
    expect(resolveFields('date', 'second')).toEqual(['year', 'month', 'day'])
    expect(resolveFields('time', 'hour')).toEqual(['hour'])
    expect(resolveFields('time', 'minute')).toEqual(['hour', 'minute'])
    expect(resolveFields('time', 'day')).toEqual(['hour'])
    expect(resolveFields('datetime', 'second')).toEqual([
      'year',
      'month',
      'day',
      'hour',
      'minute',
      'second',
    ])
    expect(resolveFields('datetime', 'hour')).toEqual(['year', 'month', 'day', 'hour'])
  })
})

describe('parse/format partial values', () => {
  it('roundtrips each date precision', () => {
    const cases: Array<[string, Array<'year' | 'month' | 'day'>, string]> = [
      ['2026', ['year'], '2026'],
      ['2026-09', ['year', 'month'], '2026-09'],
      ['2026-09-29', ['year', 'month', 'day'], '2026-09-29'],
    ]
    for (const [raw, fields, expected] of cases) {
      const parts = parsePartsValue(raw, fields)
      expect(parts).not.toBeNull()
      expect(formatPartsValue(parts!, fields)).toBe(expected)
    }
  })

  it('roundtrips datetime and time precisions', () => {
    const dt = parsePartsValue('2026-09-29T14:30:05', [
      'year',
      'month',
      'day',
      'hour',
      'minute',
      'second',
    ])!
    expect(formatPartsValue(dt, ['year', 'month', 'day', 'hour'])).toBe('2026-09-29T14')
    expect(formatPartsValue(dt, ['year', 'month', 'day', 'hour', 'minute'])).toBe('2026-09-29T14:30')

    const time = parsePartsValue('14:30:05', ['hour', 'minute', 'second'])!
    expect(time.hour).toBe(14)
    expect(time.minute).toBe(30)
    expect(time.second).toBe(5)
    expect(formatPartsValue(time, ['hour', 'minute', 'second'])).toBe('14:30:05')
    expect(formatPartsValue(time, ['hour'])).toBe('14')
  })

  it('fills missing fields with defaults', () => {
    const monthOnly = parsePartsValue('2026-09', ['year', 'month'])!
    expect(monthOnly.day).toBe(DEFAULT_PARTS.day)
    const hourOnly = parsePartsValue('14', ['hour'])!
    expect(hourOnly.minute).toBe(0)
  })

  it('rejects invalid values', () => {
    expect(parsePartsValue('', ['year'])).toBeNull()
    expect(parsePartsValue('2026-02-31', ['year', 'month', 'day'])).toBeNull()
    expect(parsePartsValue('2026-13', ['year', 'month'])).toBeNull()
    expect(parsePartsValue('24:00', ['hour', 'minute'])).toBeNull()
    expect(parsePartsValue('2026/09', ['year', 'month'])).toBeNull()
  })
})

describe('date value helpers', () => {
  it('parses_and_formats_local_yyyymmdd', () => {
    expect(formatDateValue(new Date(2026, 2, 5))).toBe('2026-03-05')
    expect(parseDateValue('2026-03-05')?.getDate()).toBe(5)
    expect(parseDateValue('')).toBeNull()
    expect(parseDateValue('2026/03/05')).toBeNull()
  })

  it('builds_month_cells_padded_to_full_weeks', () => {
    const cells = buildMonthCells(2026, 1, 1) // 2026-02, Monday-first
    expect(cells.length % 7).toBe(0)
    expect(cells.filter((cell) => cell !== null)).toHaveLength(28)
    expect(formatDateValue(cells.find((cell) => cell !== null)!)).toBe('2026-02-01')
  })

  it('date_to_parts_and_back_roundtrip', () => {
    const date = new Date(2026, 8, 29, 14, 30, 5)
    expect(dateToParts(date)).toEqual({ year: 2026, month: 9, day: 29, hour: 14, minute: 30, second: 5 })
    expect(buildDateFromParts(dateToParts(date)).getTime()).toBe(date.getTime())
  })
})
