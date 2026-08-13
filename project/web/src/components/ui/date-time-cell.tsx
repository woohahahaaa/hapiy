import type { ReactNode } from "react"

// DateTimeCell — table-friendly two-line timestamp: YYYY-MM-DD on top, HH:MM:SS below.
// Pass any value the Date constructor accepts (ISO string, epoch ms, etc.). Invalid
// input falls back to the raw string so the column never silently goes blank.
export function DateTimeCell({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === "") return null
  const d = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return (
    <span className="block leading-tight tabular-nums">
      <span className="block whitespace-nowrap">{date}</span>
      <span className="block whitespace-nowrap text-muted-foreground">{time}</span>
    </span>
  )
}
