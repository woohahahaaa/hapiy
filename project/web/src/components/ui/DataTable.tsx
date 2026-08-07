"use client"

import type { ReactNode } from "react"
import * as React from "react"
import { Button } from "@/components/ui/button"

// ── Column definition ──

export interface ColumnDef<T> {
  key: string
  label: string
  render?: (value: unknown, row: T) => ReactNode
  isTime?: boolean
  showEmptyPlaceholder?: boolean
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
  filters?: ReactNode
  actions?: ReactNode
  emptyText?: string
  onRetry?: () => void
}

// ── Constants ──

const STORAGE_PREFIX = "hapiy-table-cols-"
const MIN_COL_PCT = 5
const TOOLBAR_GAP = 12

// ── Helpers ──

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${date} ${time}`
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="italic text-muted-foreground/50">(空)</span>
  }
  return String(value)
}

// splitFilters 从右往左数第二行能装下的筛选条件数量：
// 返回 split，表示第二行从 filterArray[split] 开始；[0, split) 上移到第一行。
function splitFilters(children: readonly HTMLElement[], available: number, gap: number): number {
  let running = 0
  for (let i = children.length - 1; i >= 0; i--) {
    const w = children[i].offsetWidth
    const itemGap = i < children.length - 1 ? gap : 0
    if (running + w + itemGap > available) return i + 1
    running += w + itemGap
  }
  return 0
}

// flattenChildren 递归展开 Fragment，返回扁平的元素数组。
// React.Children.toArray 不展开单个 Fragment，slice 会失效。
function flattenChildren(children: ReactNode): ReactNode[] {
  const result: ReactNode[] = []
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      result.push(...flattenChildren(child.props.children))
    } else {
      result.push(child)
    }
  })
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
  filters,
  actions,
  emptyText = "暂无数据",
  onRetry,
}: DataTableProps<T>) {
  const colCount = columns.length
  const [widths, setWidths] = React.useState<number[]>(() => loadWidths(id, colCount))
  const dragRef = React.useRef<{
    colIndex: number
    startX: number
    startWidth: number
    totalWidth: number
  } | null>(null)
  const tableRef = React.useRef<HTMLDivElement>(null)
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const measureFiltersRef = React.useRef<HTMLDivElement>(null)
  const measureActionsRef = React.useRef<HTMLDivElement>(null)
  const [splitIndex, setSplitIndex] = React.useState<number | null>(null)

  React.useEffect(() => {
    saveWidths(id, widths)
  }, [id, widths])

  const filterArray = React.useMemo(() => flattenChildren(filters), [filters])

  // 用隐藏行（完整 filters + 操作区）量宽，避免测量与实际渲染互相依赖。
  const recalcSplit = React.useCallback(() => {
    const container = toolbarRef.current
    const measureFilters = measureFiltersRef.current
    const measureActions = measureActionsRef.current
    if (!container || !measureFilters || !measureActions) {
      setSplitIndex(null)
      return
    }
    const available = container.offsetWidth - measureActions.offsetWidth - TOOLBAR_GAP
    if (available <= 0) {
      setSplitIndex(0)
      return
    }
    setSplitIndex(splitFilters(Array.from(measureFilters.children) as HTMLElement[], available, TOOLBAR_GAP))
  }, [])

  React.useLayoutEffect(() => {
    recalcSplit()
    window.addEventListener("resize", recalcSplit)
    const timer = window.setTimeout(recalcSplit, 100)
    return () => {
      window.removeEventListener("resize", recalcSplit)
      window.clearTimeout(timer)
    }
  }, [recalcSplit, filterArray, actions])

  React.useLayoutEffect(() => {
    const container = toolbarRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recalcSplit())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recalcSplit])

  const handleMouseDown = React.useCallback(
    (colIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault()
      const tableEl = tableRef.current
      if (!tableEl) return
      const rect = tableEl.getBoundingClientRect()
      dragRef.current = {
        colIndex,
        startX: e.clientX,
        startWidth: widths[colIndex],
        totalWidth: rect.width,
      }
      const handleMouseMove = (ev: MouseEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = ev.clientX - drag.startX
        const pctDelta = (dx / drag.totalWidth) * 100
        let newVal = Math.round(drag.startWidth + pctDelta)
        newVal = Math.max(MIN_COL_PCT, Math.min(100, newVal))
        setWidths((prev) => {
          const next = [...prev]
          next[drag.colIndex] = newVal
          const sum = next.reduce((a, b) => a + b, 0)
          const lastIdx = next.length - 1
          next[lastIdx] = Math.max(MIN_COL_PCT, next[lastIdx] + (100 - sum))
          return next
        })
      }
      const handleMouseUp = () => {
        dragRef.current = null
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        document.body.style.userSelect = ""
        document.body.style.cursor = ""
      }
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"
    },
    [widths],
  )

  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  const pageText = total > 0 ? `第 ${Math.floor(offset / limit) + 1} 页，共 ${total} 条` : ""
  const split = splitIndex ?? 0

  return (
    <div className="flex h-full flex-col">
      {/* 筛选栏 */}
      {(filters || actions) && (
        <div ref={toolbarRef} className="mb-4">
          {/* 隐藏测量行：完整 filters + 操作区，仅用于量宽 */}
          <div aria-hidden className="pointer-events-none absolute invisible flex flex-wrap items-center gap-3" ref={measureFiltersRef}>
            {filters}
          </div>
          <div aria-hidden className="pointer-events-none absolute invisible flex flex-wrap items-center gap-3">
            <div ref={measureActionsRef} className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              {actions}
            </div>
          </div>

          {filters && split > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {filterArray.slice(0, split)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {filters && (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                {splitIndex !== null ? filterArray.slice(split) : filters}
              </div>
            )}
            {actions && (
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                {actions}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 表格 */}
      <div className="min-h-0 flex-1">
        <div ref={tableRef} className="relative w-full overflow-x-auto rounded-md border border-border">
          <table data-slot="table" className="w-full caption-bottom text-xs table-fixed">
            <thead data-slot="table-header" className="[&_tr]:border-b">
              <tr data-slot="table-row" className="border-b transition-colors">
                {columns.map((col, i) => (
                  <th
                    key={col.key}
                    data-slot="table-head"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 relative overflow-hidden text-ellipsis"
                    style={{ width: `${widths[i]}%` }}
                  >
                    {col.label}
                    <div
                      className="absolute right-0 top-0 bottom-0 z-10"
                      style={{ width: "4px", cursor: "col-resize", userSelect: "none" }}
                      onMouseDown={handleMouseDown(i)}
                    />
                  </th>
                ))}
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
                    className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                  >
                    {columns.map((col) => {
                      const raw = row[col.key]
                      const showEmpty = col.showEmptyPlaceholder !== false
                      const content = col.isTime
                        ? formatDateTime(raw as string)
                        : col.render
                          ? col.render(raw, row)
                          : showEmpty
                            ? renderValue(raw)
                            : String(raw ?? "")
                      return (
                        <td
                          key={col.key}
                          data-slot="table-cell"
                          className="p-2 align-middle overflow-hidden text-ellipsis whitespace-nowrap"
                        >
                          {content}
                        </td>
                      )
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页 */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{pageText}</div>
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

// ── Storage helpers ──

function loadWidths(id: string, count: number): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    if (raw) {
      const parsed = JSON.parse(raw) as number[]
      if (Array.isArray(parsed) && parsed.length === count) {
        return parsed.map((v) => Math.max(MIN_COL_PCT, Math.min(100, Math.round(v))))
      }
    }
  } catch {
    /* ignore corrupt data */
  }
  const pct = Math.floor(100 / count)
  return Array.from({ length: count }, () => pct)
}

function saveWidths(id: string, widths: number[]) {
  localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(widths))
}
