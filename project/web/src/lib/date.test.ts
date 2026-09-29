import { describe, expect, it } from 'vitest'

import { buildMonthCells, formatDateValue, parseDateValue } from './date'

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
})
