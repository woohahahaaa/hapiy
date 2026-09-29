// 纯日期工具：值统一是本地日期 `YYYY-MM-DD` 字符串（不含时区），供 DatePicker
// 及调用方复用。独立成文件是为了让组件文件只导出组件（react-refresh 约束）。

export type DateValue = string

// 解析失败（空值、非法串）返回 null，调用方据此回退到占位文案。
export function parseDateValue(value?: DateValue): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateValue(date: Date): DateValue {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
