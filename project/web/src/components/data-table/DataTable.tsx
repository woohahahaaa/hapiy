"use client"

import type { ReactNode } from "react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { dashboardApi } from "@/lib/dashboard-api"
import { cn } from "@/lib/utils"
import type {
  ColumnDef,
  ColumnDisplayConfig,
  ColumnOverflow,
  ColumnWidthConfig,
} from "./ColumnDef"
import { DateCell } from "./cells/DateCell"
import { DefaultCell } from "./cells/DefaultCell"
import { ColumnSettingsPopover } from "./features/ColumnSettingsPopover"
import { MagicWandButton, MagicWandPicker } from "./features/MagicWand"
import { Pagination } from "./ui/Pagination"

// ── Public API ──

export interface DataTableProps<T> {
  id: string
  columns: readonly ColumnDef<T>[]
  data: readonly T[]
  total: number
  loading?: boolean
  error?: string | null
  offset: number
  limit: number
  onOffsetChange: (offset: number) => void
  pageSizeOptions?: readonly number[]
  onLimitChange?: (limit: number) => void
  filters?: ReactNode
  actions?: ReactNode
  emptyText?: string
  onRetry?: () => void
  onRowClick?: (row: T) => void
  showPagination?: boolean
  // Row styling API.
  rowClassName?: (row: T) => string
  rowBackgroundColor?: (row: T) => string | null | undefined
  rowHoverBackgroundColor?: (row: T) => string | null | undefined
  hoverClassName?: string
}

// ── Constants ──

const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]
const SAVE_DEBOUNCE_MS = 500
const RESIZE_DEBOUNCE_MS = 100
// Minimum width a column keeps during magic-wand auto layout so an empty cell
// in the picked row doesn't collapse the column to zero (invisible) width.
const MIN_COL_PX = 40

// ── Helpers ──

function formatWidth(w: ColumnWidthConfig): string {
  return w.kind === 'percent' ? `${w.value} %` : `${w.value} px`
}

function parseWidthInput(raw: string): { ok: true; value: ColumnWidthConfig } | { ok: false; error: string } {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '')
  const pctMatch = /^([0-9]+(?:\.[0-9]+)?)%$/.exec(trimmed)
  if (pctMatch) return { ok: true, value: { kind: 'percent', value: Number(pctMatch[1]) } }
  const pxMatch = /^([0-9]+(?:\.[0-9]+)?)(pt|px)$/.exec(trimmed)
  if (pxMatch) return { ok: true, value: { kind: 'pixel', value: Number(pxMatch[1]) } }
  if (trimmed === '') return { ok: false, error: '宽度不能为空' }
  return { ok: false, error: '必须以 % 或 pt/px 结尾（如 "200 px" 或 "30 %"）' }
}

function defaultConfigForColumn(col: ColumnDef<unknown>): ColumnDisplayConfig {
  return {
    width: col.defaultWidth,
    align: col.defaultAlign ?? 'left',
    overflow: col.defaultOverflow ?? 'ellipsis',
  }
}

function configsFromColumns(columns: readonly ColumnDef<unknown>[]): ColumnDisplayConfig[] {
  return columns.map(defaultConfigForColumn)
}

function inputsFromColumns(columns: readonly ColumnDef<unknown>[]): string[] {
  return columns.map((c) => formatWidth(c.defaultWidth))
}

function computeResolvedWidths(
  parentWidth: number,
  columns: readonly ColumnDef<unknown>[],
  configs: readonly ColumnDisplayConfig[],
): number[] {
  const count = columns.length
  if (count === 0) return []

  let pixelTotal = 0
  let pctDenominator = 0
  const pixelIndices: number[] = []
  const percentIndices: number[] = []

  for (let i = 0; i < count; i++) {
    const cfg = configs[i] ?? defaultConfigForColumn(columns[i]!)
    if (cfg.width.kind === 'pixel') {
      pixelTotal += cfg.width.value
      pixelIndices.push(i)
    } else {
      pctDenominator += cfg.width.value
      percentIndices.push(i)
    }
  }

  if (parentWidth < pixelTotal) {
    // Pixel columns overflow the container (e.g. after magic-wand auto width
    // where round-off can push the sum a hair over). Shrink them all by the
    // same ratio instead of equal-splitting, so the relative proportions the
    // user configured/measured are preserved.
    const scale = pixelTotal > 0 ? parentWidth / pixelTotal : 1
    return pixelIndices.map((i) => {
      const cfg = configs[i] ?? defaultConfigForColumn(columns[i]!)
      return cfg.width.kind === 'pixel' ? cfg.width.value * scale : 0
    })
  }

  const remaining = parentWidth - pixelTotal
  const result: number[] = new Array(count).fill(0)
  for (const i of pixelIndices) {
    const cfg = configs[i] ?? defaultConfigForColumn(columns[i]!)
    result[i] = cfg.width.kind === 'pixel' ? cfg.width.value : 0
  }
  if (pctDenominator > 0) {
    for (const i of percentIndices) {
      const cfg = configs[i] ?? defaultConfigForColumn(columns[i]!)
      const pctValue = cfg.width.kind === 'percent' ? cfg.width.value : 0
      result[i] = (remaining / pctDenominator) * pctValue
    }
  } else if (remaining > 0) {
    // Only pixel columns declared; distribute remaining evenly across all columns
    // so widths are always visible. Pixel columns keep their declared value.
    const each = remaining / count
    for (let i = 0; i < count; i++) {
      result[i] = (result[i] ?? 0) + each
    }
  }

  return result
}

// Resolve the raw value a column reads from a row. `accessor` takes precedence
// over `key`; when neither is set, falls back to the row field named `key`.
function resolveValue<T>(col: ColumnDef<T>, row: T): unknown {
  if (typeof col.accessor === 'function') return col.accessor(row)
  if (typeof col.accessor === 'string') return row[col.accessor]
  return row[col.key]
}

// Render a column's cell content (no outer clamp wrapper). Shared by the real
// table rows and the hidden measurement layer used by the magic wand.
function renderCellContent<T>(
  col: ColumnDef<T>,
  row: T,
  overflow: ColumnOverflow,
): ReactNode {
  const showEmpty = col.showEmptyPlaceholder !== false
  const isTime = (col as ColumnDef<T> & { readonly isTime?: boolean }).isTime
  if (isTime) {
    return (
      <DateCell
        line1={resolveValue(col, row) as string}
        showEmpty={showEmpty}
        overflow={overflow}
      />
    )
  }
  if (col.render) return col.render(resolveValue(col, row), row)
  if (col.slot) {
    const line1 =
      typeof col.slot.line1 === 'function' ? col.slot.line1(row) : col.slot.line1
    const line2 =
      typeof col.slot.line2 === 'function' ? col.slot.line2(row) : col.slot.line2
    return (
      <DateCell
        line1={line1}
        line2={line2}
        showEmpty={showEmpty}
        overflow={overflow}
      />
    )
  }
  return (
    <DefaultCell
      value={resolveValue(col, row) as string | number | null | undefined}
      showEmpty={showEmpty}
    />
  )
}

// ── Component ──

export function DataTable<T extends Record<string, unknown>>({
  id,
  columns,
  data,
  total,
  loading = false,
  error = null,
  offset,
  limit,
  onOffsetChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onLimitChange,
  filters,
  actions,
  emptyText = "暂无数据",
  onRetry,
  onRowClick,
  showPagination = true,
  rowClassName,
  rowBackgroundColor,
  rowHoverBackgroundColor,
  hoverClassName,
}: DataTableProps<T>) {
  // Fail loudly if any column is missing the required defaultWidth.
  const missing = columns.find((c) => !c.defaultWidth)
  if (missing) {
    const msg = `DataTable "${id ?? '(no id)'}": column "${missing.key}" is missing required defaultWidth`
    console.error(msg)
    throw new Error(msg)
  }

  const colCount = columns.length

  const tableRef = React.useRef<HTMLDivElement>(null)

  const [configs, setConfigs] = React.useState<ColumnDisplayConfig[]>(() =>
    configsFromColumns(columns as readonly ColumnDef<unknown>[]),
  )
  const [widthInput, setWidthInput] = React.useState<string[]>(() =>
    inputsFromColumns(columns as readonly ColumnDef<unknown>[]),
  )
  const [widthError, setWidthError] = React.useState<(string | null)[]>(() =>
    columns.map(() => null),
  )
  const [locked, setLocked] = React.useState<boolean[]>(() =>
    columns.map((c) => c.defaultLocked ?? false),
  )

  // Magic wand (auto column width) state.
  const [magicActive, setMagicActive] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [cursorPos, setCursorPos] = React.useState<{ x: number; y: number } | null>(null)
  const [pendingReference, setPendingReference] = React.useState<{
    row: unknown
    rowIdx: number
  } | null>(null)
  // Hidden off-screen layer that renders the picked row's cells at their full
  // natural width; the magic wand reads real rendered widths from it.
  const measureRef = React.useRef<HTMLDivElement>(null)

  // Map rowIdx -> <tr> element. Used by the line-clamp measurement effect
  // to read the row's natural height after wrap columns have expanded it.
  const trRefs = React.useRef<Map<number, HTMLTableRowElement>>(new Map())
  const setTrRef = React.useCallback(
    (rowIdx: number) => (el: HTMLTableRowElement | null) => {
      if (el) trRefs.current.set(rowIdx, el)
      else trRefs.current.delete(rowIdx)
    },
    [],
  )
  const [rowMaxLines, setRowMaxLines] = React.useState<number[]>([])

  const userEditedRef = React.useRef(false)

  const configsRef = React.useRef<ColumnDisplayConfig[]>(configs)
  React.useEffect(() => {
    configsRef.current = configs
  }, [configs])

  const loadSeqRef = React.useRef(0)
  React.useEffect(() => {
    const seq = ++loadSeqRef.current
    void (async () => {
      try {
        const saved = await dashboardApi.getTableConfig(id)
        if (loadSeqRef.current !== seq) return
        if (userEditedRef.current) return
        if (!saved) return
        if (saved.configs.length !== columns.length) {
          console.warn(
            `DataTable "${id}": saved config length (${saved.configs.length}) does not match column count (${columns.length}); using defaults.`,
          )
          return
        }
        const next = saved.configs.map((cfg) => ({ ...cfg }))
        setConfigs(next)
        setWidthInput(next.map((cfg) => formatWidth(cfg.width)))
        setWidthError(columns.map(() => null))
      } catch (err) {
        console.warn(`DataTable "${id}": failed to load saved config`, err)
      }
    })()
    // columns intentionally excluded: config load is keyed by table id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const initialConfigRef = React.useRef(true)
  React.useEffect(() => {
    if (initialConfigRef.current) {
      initialConfigRef.current = false
      return
    }
    const handle = window.setTimeout(() => {
      const toSave = configsRef.current
      void dashboardApi.saveTableConfig(id, toSave).catch((err) => {
        console.warn(`DataTable "${id}": failed to save config`, err)
      })
    }, SAVE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(handle)
    }
  }, [id, configs])

  // Flush pending unsaved config before unmount/id-change; the debounce timer
  // above only clears, so quick edits + navigate-away would otherwise be lost.
  const lastSavedRef = React.useRef<ColumnDisplayConfig[] | null>(null)
  React.useEffect(() => {
    lastSavedRef.current = configsRef.current
    return () => {
      const latest = configsRef.current
      if (!userEditedRef.current) return
      if (latest === lastSavedRef.current) return
      lastSavedRef.current = latest
      void dashboardApi.saveTableConfig(id, latest).catch((err) => {
        console.warn(`DataTable "${id}": failed to flush config`, err)
      })
    }
  }, [id])

  // Measure parent width + recompute on resize and when the popover closes.
  const [resolvedWidths, setResolvedWidths] = React.useState<number[]>(() =>
    computeResolvedWidths(0, columns as readonly ColumnDef<unknown>[], configs),
  )

  const recompute = React.useCallback(() => {
    const el = tableRef.current
    const w = el ? el.getBoundingClientRect().width : 0
    setResolvedWidths(
      computeResolvedWidths(w, columns as readonly ColumnDef<unknown>[], configs),
    )
  }, [columns, configs])

  React.useLayoutEffect(() => {
    recompute()
    let pendingTimer: number | undefined
    const handleResize = () => {
      if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
      pendingTimer = window.setTimeout(recompute, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener("resize", handleResize)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => recompute()) : null
    if (ro && tableRef.current) ro.observe(tableRef.current)
    return () => {
      window.removeEventListener("resize", handleResize)
      if (ro) ro.disconnect()
    }
  }, [recompute])

  // Re-measure when configs change so users see the result of edits. (The
  // column-settings popover owns its open state, so recompute-on-configs
  // covers the close-triggered re-measure of the previous implementation.)
  React.useEffect(() => {
    recompute()
  }, [recompute])

  // Two-phase ellipsis layout:
  //   Phase 1 — clamp every ellipsis inner div to 1 line so the wrap columns
  //             dictate the row's natural height.
  //   Phase 2 — measure tr.offsetHeight, convert to a line count, and back-fill
  //             that line-clamp onto the ellipsis cells. Result: an ellipsis
  //             cell on a row whose wrap column expanded to N lines is allowed
  //             up to N lines before truncation.
  React.useLayoutEffect(() => {
    const ellipsisDivs: { el: HTMLElement; rowIdx: number; prev: string }[] = []
    trRefs.current.forEach((tr, rowIdx) => {
      tr.querySelectorAll<HTMLTableCellElement>('td[data-overflow="ellipsis"]').forEach((td) => {
        const inner = td.firstElementChild as HTMLElement | null
        if (!inner) return
        ellipsisDivs.push({ el: inner, rowIdx, prev: inner.style.webkitLineClamp })
        inner.style.webkitLineClamp = '1'
      })
    })
    void tableRef.current?.offsetHeight

    const counts: number[] = []
    let anyChange = false
    data.forEach((_, rowIdx) => {
      const tr = trRefs.current.get(rowIdx)
      const firstTd = tr?.querySelector<HTMLTableCellElement>('td')
      let maxLines = 1
      if (tr && firstTd) {
        const cs = window.getComputedStyle(firstTd)
        const lineHeight = parseFloat(cs.lineHeight) || 16
        const paddingTop = parseFloat(cs.paddingTop) || 0
        const paddingBottom = parseFloat(cs.paddingBottom) || 0
        const contentHeight = tr.offsetHeight - paddingTop - paddingBottom
        maxLines = Math.max(1, Math.round(contentHeight / lineHeight))
      }
      counts.push(maxLines)
      if (rowMaxLines[rowIdx] !== maxLines) anyChange = true
    })

    if (anyChange) {
      setRowMaxLines(counts)
    }
    // When no state change was needed, restore the inline style so the DOM
    // matches what React already believes.
    ellipsisDivs.forEach(({ el, rowIdx, prev }) => {
      if (!anyChange) el.style.webkitLineClamp = prev
      else if (counts[rowIdx] === undefined) el.style.webkitLineClamp = prev
    })
    // rowMaxLines intentionally excluded from deps: only re-measure when the
    // rendered table shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, columns, configs, resolvedWidths])

  // ── Magic wand ──

  const handleMagicApply = React.useCallback(
    (mode: "percent" | "pixel") => {
      userEditedRef.current = true
      const round2 = (n: number) => Math.round(n * 100) / 100
      const containerW = tableRef.current?.getBoundingClientRect().width ?? 0
      const container = measureRef.current

      // Measure the picked row's cells at their FULL natural width from the
      // hidden measurement layer (real rendered width, not an estimate).
      // Empty cells (scrollWidth 0) floor at MIN_COL_PX; short text keeps its
      // real width so the proportional split stays mathematically uniform.
      const natural = columns.map((_, i) => {
        const el = container?.querySelector<HTMLElement>(`[data-measure-col="${i}"]`)
        const w = el?.scrollWidth ?? 0
        return w > 0 ? w : MIN_COL_PX
      })

      const toPx = (cfg: ColumnDisplayConfig): number =>
        cfg.width.kind === 'pixel'
          ? cfg.width.value
          : containerW > 0 ? (cfg.width.value / 100) * containerW : cfg.width.value

      // Locked columns keep their current config width (untouched); the rest
      // split the remaining container width proportionally to their measured
      // widths.
      let lockedTotal = 0
      let unlockedNaturalTotal = 0
      for (let i = 0; i < columns.length; i++) {
        if (locked[i]) lockedTotal += toPx(configs[i] ?? defaultConfigForColumn(columns[i] as ColumnDef<unknown>))
        else unlockedNaturalTotal += natural[i]!
      }
      const remaining = Math.max(0, containerW - lockedTotal)

      const out = new Array<number>(columns.length).fill(0)
      if (unlockedNaturalTotal > 0 && remaining > 0) {
        for (let i = 0; i < columns.length; i++) {
          out[i] = locked[i]
            ? toPx(configs[i] ?? defaultConfigForColumn(columns[i] as ColumnDef<unknown>))
            : (natural[i]! / unlockedNaturalTotal) * remaining
        }
      } else {
        const unlockedCount = columns.length - locked.filter(Boolean).length
        const each = unlockedCount > 0 ? remaining / unlockedCount : 0
        for (let i = 0; i < columns.length; i++) {
          out[i] = locked[i] ? toPx(configs[i] ?? defaultConfigForColumn(columns[i] as ColumnDef<unknown>)) : each
        }
      }

      const nextConfigs = configs.map((cfg, i) =>
        locked[i]
          ? cfg
          : {
              ...cfg,
              width: mode === 'percent'
                ? { kind: 'percent' as const, value: round2((out[i]! / (containerW || 1)) * 100) }
                : { kind: 'pixel' as const, value: round2(out[i]!) },
            },
      )
      setConfigs(nextConfigs)
      setWidthInput(nextConfigs.map((cfg) => formatWidth(cfg.width)))
      setWidthError(columns.map(() => null))
      setPendingReference(null)
      setMagicActive(false)
    },
    [columns, configs, locked],
  )

  // ── Config editing ──

  function updateConfig(i: number, next: ColumnDisplayConfig) {
    userEditedRef.current = true
    setConfigs((prev) => {
      const out = [...prev]
      out[i] = next
      return out
    })
  }

  function handleWidthInput(i: number, raw: string) {
    userEditedRef.current = true
    setWidthInput((prev) => {
      const out = [...prev]
      out[i] = raw
      return out
    })
    const result = parseWidthInput(raw)
    setWidthError((prev) => {
      const out = [...prev]
      out[i] = result.ok ? null : result.error
      return out
    })
    if (result.ok) {
      setConfigs((prev) => {
        const out = [...prev]
        const cur = out[i] ?? defaultConfigForColumn(columns[i] as ColumnDef<unknown>)
        out[i] = { ...cur, width: result.value }
        return out
      })
    }
  }

  const renderToolbarControls = () => (
    <ColumnSettingsPopover
      columns={columns}
      configs={configs}
      widthInput={widthInput}
      widthError={widthError}
      locked={locked}
      onConfigChange={updateConfig}
      onWidthInputChange={handleWidthInput}
      onLockToggle={(i) =>
        setLocked((prev) => {
          const next = [...prev]
          next[i] = !next[i]
          return next
        })
      }
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      headerExtra={
        <MagicWandButton
          isActive={magicActive}
          onActivate={(next) => {
            setMagicActive(next)
            if (next) setSettingsOpen(false)
          }}
        />
      }
    />
  )

  return (
    <div className="flex flex-col">
      {/* Toolbar (filters + actions + magic wand + settings) */}
      {(filters || actions) && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {filters && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              {filters}
            </div>
          )}
          {actions && (
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              {actions}
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {renderToolbarControls()}
          </div>
        </div>
      )}

      {/* If no filters/actions, still show the controls above the table. */}
      {!filters && !actions && (
        <div className="mb-4 flex justify-end">
          <div className="flex items-center gap-2">{renderToolbarControls()}</div>
        </div>
      )}

      {/* Table */}
      <div
        ref={tableRef}
        className="relative w-full overflow-x-hidden rounded-md border border-border"
        onMouseMove={(e) => {
          if (!magicActive) return
          setCursorPos({ x: e.clientX, y: e.clientY })
        }}
      >
        <table data-slot="table" className="w-full caption-bottom text-xs table-fixed">
          <thead data-slot="table-header" className="[&_tr]:border-b">
            <tr data-slot="table-row" className="border-b transition-colors">
              {columns.map((col, i) => {
                const cfg = configs[i] ?? defaultConfigForColumn(col as ColumnDef<unknown>)
                const widthPx = resolvedWidths[i]
                return (
                  <th
                    key={col.key}
                    data-slot="table-head"
                    className={cn(
                      "h-10 px-2 align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
                      cfg.align === 'right' ? 'text-right' : 'text-left',
                    )}
                    style={widthPx !== undefined ? { width: `${widthPx}px` } : undefined}
                  >
                    {col.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody data-slot="table-body">
            {loading && (
              <tr data-slot="table-row">
                <td colSpan={colCount} className="p-2 text-center text-xs text-muted-foreground py-8">
                  加载中...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr data-slot="table-row">
                <td colSpan={colCount} className="p-2 text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs text-destructive">{error}</span>
                    {onRetry && (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        重试
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && data.length === 0 && (
              <tr data-slot="table-row">
                <td colSpan={colCount} className="p-2 text-center text-xs text-muted-foreground py-8">
                  {emptyText}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              data.map((row, rowIdx) => {
                const rowBg = rowBackgroundColor?.(row)
                const rowHoverBg = rowHoverBackgroundColor?.(row)
                const extraRowClass = cn(
                  rowClassName?.(row) ?? "",
                  columns.find((col) => col.rowClassName)?.rowClassName?.(row) ?? "",
                )
                return (
                  <tr
                    key={rowIdx}
                    data-slot="table-row"
                    ref={setTrRef(rowIdx)}
                    onClick={
                      magicActive
                        ? () => setPendingReference({ row, rowIdx })
                        : onRowClick
                          ? () => onRowClick(row)
                          : undefined
                    }
                    className={cn(
                      "border-b transition-colors data-[state=selected]:bg-muted",
                      rowHoverBg
                        ? "hover:bg-(--dt-row-hover-bg)"
                        : (hoverClassName ?? "hover:bg-muted/50"),
                      onRowClick && "cursor-pointer",
                      extraRowClass,
                    )}
                    style={{
                      ...(rowBg ? { backgroundColor: rowBg } : {}),
                      ...(rowHoverBg
                        ? ({ '--dt-row-hover-bg': rowHoverBg } as React.CSSProperties)
                        : {}),
                    }}
                  >
                    {columns.map((col, idx) => {
                      const cfg = configs[idx] ?? defaultConfigForColumn(col as ColumnDef<unknown>)
                      const isEllipsis = cfg.overflow === 'ellipsis'
                      // Legacy passthrough: `isTime` predates the slot API.
                      const isTime = (col as ColumnDef<T> & { readonly isTime?: boolean }).isTime
                      // Slot cells are multi-line content (date+time, detail rows).
                      // Their overflow is handled per-line inside DateCell, so the
                      // row-count clamp wrapper must NOT be applied to them.
                      const isSlotCell = isTime || (!!col.slot && !col.render)
                      const overflowClass = isEllipsis && !isSlotCell
                        ? 'overflow-hidden'
                        : 'whitespace-normal break-words'
                      const widthPx = resolvedWidths[idx]
                      const maxLines = rowMaxLines[rowIdx] ?? 1

                      const content = renderCellContent(
                        col,
                        row,
                        isEllipsis ? 'ellipsis' : 'wrap',
                      )

                      const contentNode = !isSlotCell && isEllipsis ? (
                        <div
                          style={{
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
                            WebkitLineClamp: maxLines,
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                          }}
                        >
                          {content}
                        </div>
                      ) : (
                        content
                      )
                      return (
                        <td
                          key={col.key}
                          data-slot="table-cell"
                          data-overflow={isEllipsis ? 'ellipsis' : 'wrap'}
                          className={cn(
                            "p-2 align-middle",
                            overflowClass,
                            cfg.align === 'right' ? 'text-right' : 'text-left',
                          )}
                          style={widthPx !== undefined ? { width: `${widthPx}px` } : undefined}
                        >
                          {contentNode}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {showPagination && (
        <Pagination
          limit={limit}
          offset={offset}
          total={total}
          pageSizeOptions={pageSizeOptions}
          onOffsetChange={onOffsetChange}
          onLimitChange={onLimitChange}
        />
      )}

      {/* Hidden measurement layer: renders the picked row's cells at full
          natural width (w-max, off-screen). The magic wand reads real rendered
          widths from here instead of estimating character widths. */}
      {pendingReference && (
        <div
          ref={measureRef}
          aria-hidden
          className="pointer-events-none absolute -left-[99999px] top-0 w-max text-xs"
        >
          {columns.map((col, i) => (
            <div
              key={col.key}
              data-measure-col={i}
              className="w-max whitespace-nowrap px-2 py-2"
            >
              {renderCellContent(col, pendingReference.row as T, 'ellipsis')}
            </div>
          ))}
        </div>
      )}

      {/* Magic wand picker: always mounted so it survives the settings popover closing. */}
      <MagicWandPicker
        isActive={magicActive}
        onActivate={setMagicActive}
        cursorPos={cursorPos}
        pendingReference={pendingReference}
        onDismiss={() => {
          setPendingReference(null)
        }}
        onApply={handleMagicApply}
      />
    </div>
  )
}
