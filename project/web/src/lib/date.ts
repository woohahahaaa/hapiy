// 纯日期/时间工具：值统一是 ISO 部分串（如 '2026'、'2026-09-29'、
// '2026-09-29T14:30:05'、'14:30:05'），供 DatePicker 及调用方复用。
// 独立成文件是为了让组件文件只导出组件（react-refresh 约束）。

export type DateValue = string

export type DateField = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'
export type DateMode = 'date' | 'time' | 'datetime'

const FIELD_ORDER: readonly DateField[] = ['year', 'month', 'day', 'hour', 'minute', 'second']

export interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export const DEFAULT_PARTS: DateParts = { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

// mode 与 precision 共同决定「可选哪些字段」：
// - date: 只含年月日，precision 超出 day 时按 day 处理
// - time: 只含时分秒，precision 低于 hour 时按 hour 处理
// - datetime: 年月日+时分秒，按 precision 截断
export function resolveFields(mode: DateMode, precision: DateField): readonly DateField[] {
  const end = FIELD_ORDER.indexOf(precision)
  if (mode === 'time') {
    return FIELD_ORDER.slice(3, Math.max(3, end) + 1)
  }
  if (mode === 'datetime') {
    return FIELD_ORDER.slice(0, end + 1)
  }
  return FIELD_ORDER.slice(0, Math.min(2, end) + 1)
}

// precision 为时间类（hour/minute/second）时的默认 mode 是 datetime。
export function defaultModeFor(precision: DateField): DateMode {
  return FIELD_ORDER.indexOf(precision) >= 3 ? 'datetime' : 'date'
}

const PARTIAL_RE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T(\d{2})(?::(\d{2}))?(?::(\d{2}))?)?$/
const TIME_RE = /^(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/

function num(m: RegExpMatchArray, index: number): number | undefined {
  const s = m[index]
  return s === undefined ? undefined : Number(s)
}

// 把部分值解析成完整 DateParts；缺的字段用 DEFAULT_PARTS 补齐，值非法返回 null。
export function parsePartsValue(
  value: DateValue | undefined,
  fields: readonly DateField[],
): DateParts | null {
  if (!value) return null
  const timeOnly = fields.length > 0 && fields[0] === 'hour'
  const m = timeOnly ? TIME_RE.exec(value) : PARTIAL_RE.exec(value)
  if (!m) return null
  const parts: DateParts = { ...DEFAULT_PARTS }
  if (timeOnly) {
    const h = num(m, 1)
    if (h === undefined || h > 23) return null
    parts.hour = h
    const mi = num(m, 2)
    if (mi !== undefined) {
      if (mi > 59) return null
      parts.minute = mi
    }
    const s = num(m, 3)
    if (s !== undefined) {
      if (s > 59) return null
      parts.second = s
    }
    return parts
  }
  const y = num(m, 1)
  if (y === undefined || y > 9999) return null
  parts.year = y
  const mo = num(m, 2)
  if (mo !== undefined) {
    if (mo < 1 || mo > 12) return null
    parts.month = mo
  }
  const d = num(m, 3)
  if (d !== undefined) {
    if (d < 1 || d > 31) return null
    const probe = new Date(parts.year, parts.month - 1, d)
    if (
      probe.getFullYear() !== parts.year ||
      probe.getMonth() !== parts.month - 1 ||
      probe.getDate() !== d
    ) {
      return null
    }
    parts.day = d
  }
  const h = num(m, 4)
  if (h !== undefined) {
    if (h > 23) return null
    parts.hour = h
  }
  const mi = num(m, 5)
  if (mi !== undefined) {
    if (mi > 59) return null
    parts.minute = mi
  }
  const s = num(m, 6)
  if (s !== undefined) {
    if (s > 59) return null
    parts.second = s
  }
  return parts
}

// 按字段顺序输出 ISO 部分串；字段为空返回 null。
export function formatPartsValue(
  parts: DateParts,
  fields: readonly DateField[],
): DateValue | null {
  if (fields.length === 0) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const has = (f: DateField) => fields.includes(f)
  if (has('year')) {
    let s = String(parts.year)
    if (has('month')) s += `-${pad(parts.month)}`
    if (has('day')) s += `-${pad(parts.day)}`
    if (has('hour')) s += `T${pad(parts.hour)}`
    if (has('minute')) s += `:${pad(parts.minute)}`
    if (has('second')) s += `:${pad(parts.second)}`
    return s
  }
  let s = pad(parts.hour)
  if (has('minute')) s += `:${pad(parts.minute)}`
  if (has('second')) s += `:${pad(parts.second)}`
  return s
}

export function dateToParts(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  }
}

export function buildDateFromParts(parts: DateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

// 兼容旧接口：解析/格式化年月日。
export function parseDateValue(value?: DateValue): Date | null {
  const parts = parsePartsValue(value, ['year', 'month', 'day'])
  return parts ? buildDateFromParts(parts) : null
}

export function formatDateValue(date: Date): DateValue {
  return formatPartsValue(dateToParts(date), ['year', 'month', 'day']) ?? ''
}

// 生成一个月的单元格（含前导/后置空白），保证行数能被 7 整除。
export function buildMonthCells(
  year: number,
  month: number,
  weekStartsOn: 0 | 1,
): (Date | null)[] {
  const firstOfMonth = new Date(year, month, 1)
  const leading = (firstOfMonth.getDay() - weekStartsOn + 7) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
