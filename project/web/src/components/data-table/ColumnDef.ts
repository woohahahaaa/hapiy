// Column definition types for the data-table component.
// Two data shapes per cell:
//   1. Field content (string | number) — what to display
//   2. Display layout — how many lines and how they're arranged
//
// Most cells are single-line: just provide `key` and the field is read from row[key].
// Multi-line cells use `slot: { line1, line2 }` for stacked layouts (date+time, name+sublabel).
// Escape hatch: `render` returns custom JSX, bypassing the cell helpers.

import type { ReactNode } from "react"

export type ColumnWidthConfig =
  | { readonly kind: 'percent'; readonly value: number }
  | { readonly kind: 'pixel'; readonly value: number }

export type ColumnAlign = 'left' | 'right'
export type ColumnOverflow = 'ellipsis' | 'wrap'

export interface ColumnSlot {
  /** First line content. Required for the cell to render. */
  readonly line1?: string | null
  /** Second line content. Optional. */
  readonly line2?: string | null
}

export interface ColumnDef<T> {
  readonly key: string
  readonly label: ReactNode

  /** Data source: a field name on the row, or a function. */
  readonly accessor?: string | ((row: T) => unknown)

  /** Multi-line layout. When set, `accessor`/`render` are ignored for slot content. */
  readonly slot?: ColumnSlot

  /** Legacy flag: renders the raw value through DateCell (single line). New code should use `slot`. */
  readonly isTime?: boolean

  /** Escape hatch: return custom JSX for this cell. */
  readonly render?: (value: unknown, row: T) => ReactNode

  /** Class applied to the `<tr>` for this row. */
  readonly rowClassName?: (row: T) => string

  /** Show the muted "--" placeholder when value is empty. Default true. */
  readonly showEmptyPlaceholder?: boolean

  readonly defaultWidth: ColumnWidthConfig
  readonly defaultAlign?: ColumnAlign
  readonly defaultOverflow?: ColumnOverflow

  /** Default lock state. Locked columns are excluded from auto-width magic wand. */
  readonly defaultLocked?: boolean
}

export interface ColumnDisplayConfig {
  readonly width: ColumnWidthConfig
  readonly align: ColumnAlign
  readonly overflow: ColumnOverflow
}