import type { ReactNode } from "react"

// EmptyCell — single source of truth for "this cell has no value". Renders a muted
// em-dash so empty cells look the same in every table; passing a non-empty value
// returns it unchanged so it's safe to use as a default formatter.
export function EmptyCell({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/60">--</span>
  }
  if (typeof value === "string") return value
  return String(value)
}
