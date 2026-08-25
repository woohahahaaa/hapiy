import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { LogCapturePreviewDialog } from '@/components/LogCapturePreviewDialog'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  dashboardApi,
  type DateRange,
  type LogCaptureFile,
  type LogCapturePairSummary,
} from '@/lib/dashboard-api'

type CaptureRow =
  | { kind: 'pair'; pair: LogCapturePairSummary }
  | { kind: 'system'; file: LogCaptureFile }

type CaptureCategory = '请求' | '响应' | '系统'

const TYPE_OPTIONS: readonly { value: CaptureCategory; label: string }[] = [
  { value: '请求', label: '请求' },
  { value: '响应', label: '响应' },
  { value: '系统', label: '系统' },
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDateTimeCell(value: unknown): { date: string; time: string } | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(d.getTime())) return { date: String(value), time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

export function LogCapturePage() {
  const [pairs, setPairs] = useState<readonly LogCapturePairSummary[]>([])
  const [pairTotal, setPairTotal] = useState(0)
  const [systemFiles, setSystemFiles] = useState<readonly LogCaptureFile[]>([])
  const [systemTotal, setSystemTotal] = useState(0)
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dateRange, setDateRange] = useState<DateRange>({})
  const [selectedTypes, setSelectedTypes] = useState<readonly CaptureCategory[]>([])
  const [prefix, setPrefix] = useState('')
  const [headerKey, setHeaderKey] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [preview, setPreview] = useState<CaptureRow | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const mountedRef = useRef(true)

  const total = pairTotal + systemTotal

  const shouldFetchPairs = useCallback(
    () =>
      selectedTypes.length === 0 ||
      selectedTypes.includes('请求') ||
      selectedTypes.includes('响应'),
    [selectedTypes],
  )
  const shouldFetchSystem = useCallback(
    () => selectedTypes.length === 0 || selectedTypes.includes('系统'),
    [selectedTypes],
  )
  const pairTypeQuery = useMemo(
    () =>
      (['请求', '响应'] as const)
        .filter((t) => selectedTypes.includes(t))
        .map((t) => (t === '请求' ? 'request' : 'response'))
        .join(',') || undefined,
    [selectedTypes],
  )

  // Initial fetch clears the table and blocks it via initialLoading.
  const fetchPage = useCallback(async () => {
    setInitialLoading(true)
    setError(null)

    const fetchPairs = shouldFetchPairs()
    const fetchSystem = shouldFetchSystem()
    const pairType = pairTypeQuery

    const pairTask: Promise<void> = fetchPairs
      ? dashboardApi
          .listLogCapturePairs({
            prefix: prefix || undefined,
            type: pairType,
            from: dateRange.from,
            to: dateRange.to,
            headerKey: headerKey || undefined,
            headerValue: headerValue || undefined,
            limit,
            offset,
          })
          .then((result) => {
            if (!mountedRef.current) return
            setPairs(result.pairs)
            setPairTotal(result.total)
          })
      : Promise.resolve().then(() => {
          if (!mountedRef.current) return
          setPairs([])
          setPairTotal(0)
        })

    const systemTask: Promise<void> = fetchSystem
      ? dashboardApi
          .listLogCaptureFiles({
            prefix: prefix || undefined,
            type: 'system',
            from: dateRange.from,
            to: dateRange.to,
            headerKey: headerKey || undefined,
            headerValue: headerValue || undefined,
            limit,
            offset,
          })
          .then((result) => {
            if (!mountedRef.current) return
            setSystemFiles(result.files)
            setSystemTotal(result.total)
          })
      : Promise.resolve().then(() => {
          if (!mountedRef.current) return
          setSystemFiles([])
          setSystemTotal(0)
        })

    const settled = await Promise.allSettled([pairTask, systemTask])
    for (const r of settled) {
      if (r.status === 'rejected') {
        const reason = r.reason
        if (mountedRef.current) {
          setError(reason instanceof Error ? reason.message : '加载失败')
        }
        break
      }
    }
    if (mountedRef.current) {
      setInitialLoading(false)
    }
  }, [prefix, selectedTypes, dateRange.from, dateRange.to, headerKey, headerValue, limit, offset, shouldFetchPairs, shouldFetchSystem, pairTypeQuery])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage])

  const toggleType = useCallback((value: CaptureCategory) => {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    )
  }, [])

  const handleResetFilters = useCallback(() => {
    setDateRange({})
    setSelectedTypes([])
    setPrefix('')
    setHeaderKey('')
    setHeaderValue('')
  }, [])

  const handleClear = useCallback(
    async (scope: 'filtered' | 'all') => {
      setClearing(true)
      const clearTypeQuery =
        (['请求', '响应', '系统'] as const)
          .filter((t) => selectedTypes.includes(t))
          .map((t) => (t === '请求' ? 'request' : t === '响应' ? 'response' : 'system'))
          .join(',') || undefined
      try {
        await dashboardApi.clearLogCapture({
          scope,
          ...(scope === 'filtered'
            ? {
                prefix: prefix || undefined,
                type: clearTypeQuery,
                from: dateRange.from,
                to: dateRange.to,
              }
            : {}),
        })
        setClearOpen(false)
        void fetchPage()
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : '清空失败')
        }
        setClearOpen(false)
      } finally {
        setClearing(false)
      }
    },

    [prefix, selectedTypes, dateRange.from, dateRange.to, fetchPage],
  )

  const rows: readonly CaptureRow[] = useMemo(() => {
    const merged: CaptureRow[] = []
    pairs.forEach((p) => merged.push({ kind: 'pair', pair: p }))
    systemFiles.forEach((f) => merged.push({ kind: 'system', file: f }))
    merged.sort((a, b) => {
      const aT = new Date(a.kind === 'pair' ? a.pair.created_at : a.file.created_at).getTime()
      const bT = new Date(b.kind === 'pair' ? b.pair.created_at : b.file.created_at).getTime()
      return bT - aT
    })
    return merged
  }, [pairs, systemFiles])

  const columns: ColumnDef<CaptureRow>[] = [
    {
      key: 'created_at',
      label: '时间',
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => formatDateTimeCell(row.kind === 'pair' ? row.pair.created_at : row.file.created_at)?.date ?? null,
        line2: (row) => formatDateTimeCell(row.kind === 'pair' ? row.pair.created_at : row.file.created_at)?.time ?? null,
      },
    },
    {
      key: 'prefix',
      label: '文件夹路径',
      defaultWidth: { kind: 'percent', value: 18 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.prefix : row.file.prefix),
    },
    {
      key: 'token_name',
      label: '令牌',
      defaultWidth: { kind: 'percent', value: 10 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.token_name : null),
    },
    {
      key: 'provider_name',
      label: '供应商',
      defaultWidth: { kind: 'percent', value: 12 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.provider_name : null),
    },
    {
      key: 'model_name',
      label: '模型',
      defaultWidth: { kind: 'percent', value: 12 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.model_name : null),
    },
    {
      key: 'source',
      label: '来源',
      defaultWidth: { kind: 'pixel', value: 100 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.source : row.file.source),
    },
    {
      key: 'type',
      label: '类型',
      defaultWidth: { kind: 'pixel', value: 120 },
      render: (_, row) =>
        row.kind === 'pair' ? (
          <Badge variant={row.pair.has_error ? 'destructive' : 'default'}>
            {row.pair.type_label}
            {row.pair.has_rewrite ? (
              <span className="text-amber-600 dark:text-amber-400"> ·修改过</span>
            ) : null}
          </Badge>
        ) : (
          <Badge variant="outline">系统</Badge>
        ),
    },
    {
      key: 'is_stream',
      label: '流式',
      defaultWidth: { kind: 'pixel', value: 80 },
      render: (_, row) => {
        const isStream = row.kind === 'pair' ? row.pair.is_stream : false
        return isStream ? 'SSE' : <span>--</span>
      },
    },
    {
      key: 'name',
      label: '文件名/请求ID',
      defaultWidth: { kind: 'percent', value: 25 },
      accessor: (row) => (row.kind === 'pair' ? row.pair.request_id : row.file.name),
    },
    {
      key: 'size',
      label: '大小',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      render: (_, row) =>
        row.kind === 'system' ? (
          formatSize(row.file.size)
        ) : (
          <span>—</span>
        ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="日志抓取"
        description="查看已抓取的请求/响应日志原文"
        status={total > 0 ? `${total} 条记录` : undefined}
        actions={undefined}
      />
      <div className="p-6">
        <DataTable
          id="capture"
          columns={columns}
          data={rows}
          total={total}
          loading={initialLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          onRowClick={setPreview}
          emptyText="暂无抓取日志"
          onRetry={() => void fetchPage()}
          filters={
            <>
              <DateRangeFilter
                value={dateRange}
                onChange={(range) => {
                  setDateRange(range)
                }}
              />
              <div className="flex items-center gap-3">
                {TYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox
                      checked={selectedTypes.includes(opt.value)}
                      onCheckedChange={() => toggleType(opt.value)}
                    />
                    <span className="text-xs text-muted-foreground">{opt.label}</span>
                  </label>
                ))}
              </div>
              <Input
                placeholder="文件夹前缀..."
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value)
                }}
                className="w-48"
              />
              <Input
                placeholder="请求头名 (如 x-session-id)"
                value={headerKey}
                onChange={(e) => {
                  setHeaderKey(e.target.value)
                }}
                className="w-48"
              />
              <Input
                placeholder="请求头值"
                value={headerValue}
                onChange={(e) => {
                  setHeaderValue(e.target.value)
                }}
                className="w-48"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
              >
                重置筛选
              </Button>
            </>
          }
          actions={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setClearOpen(true)}
            >
              清空
            </Button>
          }
        />
      </div>

      {preview?.kind === 'pair' && (
        <LogCapturePreviewDialog
          kind="pair"
          requestId={preview.pair.request_id}
          open
          onClose={() => setPreview(null)}
        />
      )}
      {preview?.kind === 'system' && (
        <LogCapturePreviewDialog
          kind="system"
          fileId={preview.file.id}
          fileName={preview.file.name}
          open
          onClose={() => setPreview(null)}
        />
      )}

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空当前筛选条件下的所有内容，确认吗？</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={clearing} onClick={() => setClearOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={clearing}
              onClick={() => void handleClear('filtered')}
            >
              清空当前页面的
            </Button>
            <Button
              variant="destructive"
              disabled={clearing}
              onClick={() => void handleClear('all')}
            >
              清空所有页面的
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
