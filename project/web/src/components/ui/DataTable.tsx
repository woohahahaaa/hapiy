"use client"

import type { ReactNode } from "react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { DateTimeCell } from "@/components/ui/date-time-cell"
import { EmptyCell } from "@/components/ui/empty-cell"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AppIcon } from "@/components/AppIcon"
import { dashboardApi } from "@/lib/dashboard-api"
import type {
  ColumnDisplayConfig,
  ColumnWidthConfig,
} from "@/lib/dashboard-api"
import { cn } from "@/lib/utils"

// ── Column definition ──

export interface ColumnDef<T> {
  readonly key: string
  readonly label: ReactNode
  readonly render?: (value: unknown, row: T) => ReactNode
  readonly rowClassName?: (row: T) => string
  readonly isTime?: boolean
  readonly showEmptyPlaceholder?: boolean
  readonly defaultWidth: ColumnWidthConfig
  readonly defaultAlign?: 'left' | 'right'
  readonly defaultOverflow?: 'ellipsis' | 'wrap'
}

// ── Props ──

interface DataTableProps<T> {
  id: string
  columns: ColumnDef<T>[]
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
}

// ── Constants ──

const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]
const SAVE_DEBOUNCE_MS = 500
const RESIZE_DEBOUNCE_MS = 100

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
    const each = parentWidth / count
    return Array.from({ length: count }, () => each)
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
    configsFromColumns(columns as ColumnDef<unknown>[]),
  )
  const [widthInput, setWidthInput] = React.useState<string[]>(() =>
    inputsFromColumns(columns as ColumnDef<unknown>[]),
  )
  const [widthError, setWidthError] = React.useState<(string | null)[]>(() =>
    columns.map(() => null),
  )
  const [popoverOpen, setPopoverOpen] = React.useState(false)

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
    computeResolvedWidths(0, columns as ColumnDef<unknown>[], configs),
  )

  const recompute = React.useCallback(() => {
    const el = tableRef.current
    const w = el ? el.getBoundingClientRect().width : 0
    setResolvedWidths(
      computeResolvedWidths(w, columns as ColumnDef<unknown>[], configs),
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

  // Re-measure when the popover closes so users see the result of edits.
  React.useEffect(() => {
    if (!popoverOpen) {
      recompute()
    }
  }, [popoverOpen, recompute])

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

  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  const pageText = total > 0 ? `第 ${Math.floor(offset / limit) + 1} 页，共 ${total} 条` : ""

  const handleLimitChange = React.useCallback(
    (value: string) => {
      const next = Number(value)
      if (!Number.isFinite(next) || next <= 0) return
      onLimitChange?.(next)
      onOffsetChange(0)
    },
    [onLimitChange, onOffsetChange],
  )

  return (
    <div className="flex flex-col">
      {/* Toolbar (filters + actions + settings) */}
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
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="列设置">
                  <AppIcon name="settings" size={16} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-80 p-3">
                <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
                  <div className="text-xs font-medium">列设置</div>
                  {columns.map((col, i) => {
                    const cfg =
                      configs[i] ??
                      defaultConfigForColumn(col as ColumnDef<unknown>)
                    return (
                      <div key={col.key} className="flex flex-col gap-1.5">
                        <div className="text-xs font-medium">{col.label}</div>
                        <div className="flex gap-2">
                          <Input
                            value={widthInput[i] ?? formatWidth(col.defaultWidth)}
                            onChange={(e) => handleWidthInput(i, e.target.value)}
                            placeholder="如 200 px 或 30 %"
                            className="flex-1"
                          />
                          <div className="flex rounded-md border border-border">
                            <Button
                              variant={cfg.align === 'left' ? 'secondary' : 'ghost'}
                              size="icon-sm"
                              aria-label="左对齐"
                              onClick={() => updateConfig(i, { ...cfg, align: 'left' })}
                            >
                              <AppIcon name="format_align_left" size={14} />
                            </Button>
                            <Button
                              variant={cfg.align === 'right' ? 'secondary' : 'ghost'}
                              size="icon-sm"
                              aria-label="右对齐"
                              onClick={() => updateConfig(i, { ...cfg, align: 'right' })}
                            >
                              <AppIcon name="format_align_right" size={14} />
                            </Button>
                          </div>
                          <div className="flex rounded-md border border-border">
                            <Button
                              variant={cfg.overflow === 'ellipsis' ? 'secondary' : 'ghost'}
                              size="icon-sm"
                              title="省略号"
                              aria-label="省略号"
                              onClick={() => updateConfig(i, { ...cfg, overflow: 'ellipsis' })}
                            >
                              <AppIcon name="more_horiz" size={14} />
                            </Button>
                            <Button
                              variant={cfg.overflow === 'wrap' ? 'secondary' : 'ghost'}
                              size="icon-sm"
                              title="换行"
                              aria-label="换行"
                              onClick={() => updateConfig(i, { ...cfg, overflow: 'wrap' })}
                            >
                              <AppIcon name="paragraph_break" size={14} />
                            </Button>
                          </div>
                        </div>
                        {widthError[i] && (
                          <p className="text-xs text-destructive">{widthError[i]}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {/* If no filters/actions, still show the settings button above the table. */}
      {!filters && !actions && (
        <div className="mb-4 flex justify-end">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="列设置">
                <AppIcon name="settings" size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-80 p-3">
              <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
                <div className="text-xs font-medium">列设置</div>
                {columns.map((col, i) => {
                  const cfg =
                    configs[i] ??
                    defaultConfigForColumn(col as ColumnDef<unknown>)
                  return (
                    <div key={col.key} className="flex flex-col gap-1.5">
                      <div className="text-xs font-medium">{col.label}</div>
                      <div className="flex gap-2">
                        <Input
                          value={widthInput[i] ?? formatWidth(col.defaultWidth)}
                          onChange={(e) => handleWidthInput(i, e.target.value)}
                          placeholder="如 200 px 或 30 %"
                          className="flex-1"
                        />
                        <div className="flex rounded-md border border-border">
                          <Button
                            variant={cfg.align === 'left' ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            aria-label="左对齐"
                            onClick={() => updateConfig(i, { ...cfg, align: 'left' })}
                          >
                            <AppIcon name="format_align_left" size={14} />
                          </Button>
                          <Button
                            variant={cfg.align === 'right' ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            aria-label="右对齐"
                            onClick={() => updateConfig(i, { ...cfg, align: 'right' })}
                          >
                            <AppIcon name="format_align_right" size={14} />
                          </Button>
                        </div>
                        <div className="flex rounded-md border border-border">
                          <Button
                            variant={cfg.overflow === 'ellipsis' ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            title="省略号"
                            aria-label="省略号"
                            onClick={() => updateConfig(i, { ...cfg, overflow: 'ellipsis' })}
                          >
                            <AppIcon name="more_horiz" size={14} />
                          </Button>
                          <Button
                            variant={cfg.overflow === 'wrap' ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            title="换行"
                            aria-label="换行"
                            onClick={() => updateConfig(i, { ...cfg, overflow: 'wrap' })}
                          >
                            <AppIcon name="paragraph_break" size={14} />
                          </Button>
                        </div>
                      </div>
                      {widthError[i] && (
                        <p className="text-xs text-destructive">{widthError[i]}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Table */}
      <div ref={tableRef} className="relative w-full overflow-x-hidden rounded-md border border-border">
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
              data.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  data-slot="table-row"
                  ref={setTrRef(rowIdx)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
                    onRowClick && "cursor-pointer",
                    (columns.find((col) => col.rowClassName)?.rowClassName?.(row) ?? ""),
                  )}
                >
                  {columns.map((col, idx) => {
                    const raw = row[col.key]
                    const showEmpty = col.showEmptyPlaceholder !== false
                    const rendered = col.render ? col.render(raw, row) : undefined
                    const content = col.isTime
                      ? <DateTimeCell value={rendered ?? raw} />
                      : col.render
                        ? rendered
                        : showEmpty
                          ? <EmptyCell value={raw} />
                          : String(raw ?? "")
                    const cfg = configs[idx] ?? defaultConfigForColumn(col as ColumnDef<unknown>)
                    const isEllipsis = cfg.overflow === 'ellipsis'
                    const overflowClass = isEllipsis
                      ? 'overflow-hidden'
                      : 'whitespace-normal break-words'
                    const widthPx = resolvedWidths[idx]
                    const maxLines = rowMaxLines[rowIdx] ?? 1
                    const contentNode = isEllipsis ? (
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
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {showPagination && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">每页</span>
            <Select value={String(limit)} onValueChange={handleLimitChange}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {pageSizeOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">条</span>
          </div>
          <div className="text-xs text-muted-foreground">{pageText || '第 1 页，共 0 条'}</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => onOffsetChange(offset + limit)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
