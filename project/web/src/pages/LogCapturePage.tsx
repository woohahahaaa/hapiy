import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { LogCapturePreviewDialog } from '@/components/LogCapturePreviewDialog'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  dashboardApi,
  LOG_SOURCE_UNMARKED,
  type DateRange,
  type LogCaptureFile,
  type LogCapturePairSummary,
} from '@/lib/dashboard-api'

type CaptureRow =
  | { kind: 'pair'; pair: LogCapturePairSummary }
  | { kind: 'system'; file: LogCaptureFile }

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
  const [prefixFilter, setPrefixFilter] = useState('all')
  const [prefixOptions, setPrefixOptions] = useState<readonly string[]>([])
  const [tokenFilter, setTokenFilter] = useState('all')
  const [tokenOptions, setTokenOptions] = useState<readonly string[]>([])
  const [providerFilter, setProviderFilter] = useState('all')
  const [providerOptions, setProviderOptions] = useState<readonly string[]>([])
  const [modelFilter, setModelFilter] = useState('all')
  const [modelOptions, setModelOptions] = useState<readonly string[]>([])
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sourceOptions, setSourceOptions] = useState<readonly string[]>([])
  const [preview, setPreview] = useState<CaptureRow | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const mountedRef = useRef(true)

  const total = pairTotal + systemTotal

  // Initial fetch clears the table and blocks it via initialLoading.
  const fetchPage = useCallback(async () => {
    setInitialLoading(true)
    setError(null)

    const pairTask: Promise<void> = dashboardApi
      .listLogCapturePairs({
        prefix: prefixFilter !== 'all' ? prefixFilter : undefined,
        from: dateRange.from,
        to: dateRange.to,
        token: tokenFilter !== 'all' ? tokenFilter : undefined,
        provider: providerFilter !== 'all' ? providerFilter : undefined,
        model: modelFilter !== 'all' ? modelFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        limit,
        offset,
      })
      .then((result) => {
        if (!mountedRef.current) return
        setPairs(result.pairs)
        setPairTotal(result.total)
      })

    const systemTask: Promise<void> = dashboardApi
      .listLogCaptureFiles({
        prefix: prefixFilter !== 'all' ? prefixFilter : undefined,
        type: 'system',
        from: dateRange.from,
        to: dateRange.to,
        token: tokenFilter !== 'all' ? tokenFilter : undefined,
        provider: providerFilter !== 'all' ? providerFilter : undefined,
        model: modelFilter !== 'all' ? modelFilter : undefined,
        source: sourceFilter !== 'all' ? sourceFilter : undefined,
        limit,
        offset,
      })
      .then((result) => {
        if (!mountedRef.current) return
        setSystemFiles(result.files)
        setSystemTotal(result.total)
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
    }, [prefixFilter, tokenFilter, providerFilter, modelFilter, sourceFilter, dateRange.from, dateRange.to, limit, offset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Load the filter option pools once (folders, tokens, providers, models) so
  // the dropdowns stay stable across pagination. Non-fatal on error.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [prefixes, tokens, providers, models, sources] = await Promise.all([
          dashboardApi.listLogCapturePrefixes(),
          dashboardApi.listTokens({ limit: 500, offset: 0 }),
          dashboardApi.listProviders({ limit: 500, offset: 0 }),
          dashboardApi.listLogCaptureModels(),
          dashboardApi.listLogCaptureSources(),
        ])
        if (!alive) return
        setPrefixOptions(
          [...new Set(prefixes.filter((p) => p !== ''))].sort((a, b) => a.localeCompare(b)),
        )
        setTokenOptions(
          [...new Set(tokens.tokens.map((t) => t.name).filter((n) => n !== ''))].sort((a, b) => a.localeCompare(b)),
        )
        setProviderOptions(
          [...new Set(providers.providers.map((p) => p.name).filter((n) => n !== ''))].sort((a, b) => a.localeCompare(b)),
        )
        setModelOptions(models)
        setSourceOptions(sources)
      } catch {
        // Non-fatal: filters still work with whatever options we have.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage])

  const handleResetFilters = useCallback(() => {
    setDateRange({})
    setPrefixFilter('all')
    setTokenFilter('all')
    setProviderFilter('all')
    setModelFilter('all')
    setSourceFilter('all')
  }, [])

  const handleClear = useCallback(
    async (scope: 'filtered' | 'all') => {
      setClearing(true)
      try {
        await dashboardApi.clearLogCapture({
          scope,
          ...(scope === 'filtered'
            ? {
                prefix: prefixFilter !== 'all' ? prefixFilter : undefined,
                source: sourceFilter !== 'all' ? sourceFilter : undefined,
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

    [prefixFilter, sourceFilter, dateRange.from, dateRange.to, fetchPage],
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
              <Select value={prefixFilter} onValueChange={setPrefixFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="文件夹" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部文件夹</SelectItem>
                    {prefixOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部来源</SelectItem>
                    <SelectItem value={LOG_SOURCE_UNMARKED}>未标注来源</SelectItem>
                    {sourceOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={tokenFilter} onValueChange={setTokenFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="令牌" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部令牌</SelectItem>
                    {tokenOptions.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部供应商</SelectItem>
                    {providerOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部模型</SelectItem>
                    {modelOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
