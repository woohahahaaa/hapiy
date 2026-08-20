import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi, type DateRange, type UsageLog } from '@/lib/dashboard-api'

export function LogsPage() {
  const [logs, setLogs] = useState<readonly UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>({})
  const [limit, setLimit] = useState(20)
  const mountedRef = useRef(true)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [selectedLog, setSelectedLog] = useState<UsageLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listLogs({
        model: modelFilter !== 'all' ? modelFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        token: searchText || undefined,
        from: dateRange.from,
        to: dateRange.to,
        limit,
        offset,
      })
      if (!mountedRef.current) return
      setLogs(result.logs)
      setTotal(result.total)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [modelFilter, statusFilter, searchText, dateRange.from, dateRange.to, limit, offset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  const handleFilterChange = useCallback(
    (setter: (v: string) => void, value: string | null) => {
      setter(value ?? 'all')
      setOffset(0)
    },
    [],
  )

  const handleClearFiltered = useCallback(async () => {
    try {
      const filters: Record<string, unknown> = {}
      if (modelFilter !== 'all') filters.model = modelFilter
      if (statusFilter !== 'all') filters.status = statusFilter
      if (searchText) filters.token = searchText
      if (dateRange.from) filters.from = dateRange.from
      if (dateRange.to) filters.to = dateRange.to
      const deleted = await dashboardApi.clearLogs({ scope: 'filtered', filters })
      setClearDialogOpen(false)
      toast(`已清空 ${deleted} 条记录`)
      if (offset > 0) {
        setOffset(0)
      } else {
        void fetchLogs()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [modelFilter, statusFilter, searchText, dateRange.from, dateRange.to, offset, fetchLogs])

  const handleResetFilters = useCallback(() => {
    setSearchText('')
    setModelFilter('all')
    setStatusFilter('all')
    setDateRange({})
    setOffset(0)
  }, [])

  const handleClearAll = useCallback(async () => {
    try {
      const deleted = await dashboardApi.clearLogs({ scope: 'all' })
      setClearDialogOpen(false)
      setLogs([])
      setTotal(0)
      setOffset(0)
      toast(`已清空全部 ${deleted} 条记录`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [])

  const models = useMemo(() => {
    const fromLogs = [...new Set(logs.map((l) => l.modelName))]
    if (modelFilter !== 'all' && !fromLogs.includes(modelFilter)) {
      fromLogs.push(modelFilter)
    }
    return fromLogs
  }, [logs, modelFilter])

  function formatDateTimeCell(row: UsageLog): { date: string; time: string } | null {
    const v = row.createdAt
    if (v === null || v === undefined || v === '') return null
    const d = v instanceof Date ? v : new Date(v as string | number)
    if (Number.isNaN(d.getTime())) return { date: String(v), time: '' }
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    }
  }

  const columns: ColumnDef<UsageLog>[] = [
    {
      key: 'createdAt',
      label: '时间',
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => formatDateTimeCell(row)?.date ?? null,
        line2: (row) => formatDateTimeCell(row)?.time ?? null,
      },
    },
    { key: 'tokenName', label: '令牌', defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'providerName', label: '供应商', defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'modelName', label: '模型', defaultWidth: { kind: 'percent', value: 12 } },
    { key: 'source', label: '来源', defaultWidth: { kind: 'percent', value: 8 } },
    {
      key: 'promptTokens',
      label: 'Tokens',
      defaultWidth: { kind: 'percent', value: 22 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      accessor: (row) =>
        `输入 ${row.promptTokens} · 缓存写入 ${row.promptCacheMissTokens} · 缓存读取 ${row.promptCacheHitTokens} · 输出 ${row.completionTokens}`,
      render: (_, row) => {
        const log = row as UsageLog
        return (
          <div className="text-xs">
            <span className="text-muted-foreground/40">输入</span> {log.promptTokens}{' '}
            <span className="text-muted-foreground/40">缓存写入</span> {log.promptCacheMissTokens}{' '}
            <span className="text-muted-foreground/40">缓存读取</span> {log.promptCacheHitTokens}{' '}
            <span className="text-muted-foreground/40">输出</span> {log.completionTokens}
          </div>
        )
      },
    },
    {
      key: 'isStream',
      label: '流式',
      defaultWidth: { kind: 'percent', value: 5 },
      accessor: (row) => (row.isStream ? 'SSE' : null),
    },
    {
      key: 'quota',
      label: '消耗',
      defaultWidth: { kind: 'percent', value: 8 },
      defaultAlign: 'right',
      accessor: (row) => (row.quota > 0 ? formatQuota(row) : null),
    },
    {
      key: 'useTime',
      label: '耗时',
      defaultWidth: { kind: 'percent', value: 13 },
      defaultAlign: 'right',
      render: (_, row) => {
        const log = row as UsageLog
        const fmt = (val: number, label: string) => (
          <span key={label} className="whitespace-nowrap">
            <span className="text-muted-foreground/40">{label}: </span>
            <span className="text-foreground">{val >= 0 ? `${val}ms` : '-'}</span>
          </span>
        )
        return (
          <div className="leading-tight tabular-nums">
            <div className="text-foreground">{(log.useTime / 1000).toFixed(1)}s</div>
            <div className="flex flex-wrap justify-end gap-x-2">
              {fmt(log.queueWaitMs, '排队')}
              {fmt(log.requestRewriteMs, '请求改写')}
              {fmt(log.connectMs, '连接')}
              {fmt(log.firstByteMs, '首字')}
              {fmt(log.responseRewriteMs, '响应改写')}
              {fmt(log.streamRewriteMs, '流式改写')}
            </div>
          </div>
        )
      },
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'percent', value: 25 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) =>
          row.status === 'success'
            ? '<#16a34a>成功</#16a34a>'
            : '<#dc2626>失败</#dc2626>',
        line2: (row) => row.errorMessage ?? null,
      },
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="使用记录"
        description="查询 API 请求的使用记录、消耗与耗时"
        status={total > 0 ? `${total} 条记录` : undefined}
      />
      <div className="p-6">
        <DataTable
          id="logs"
          columns={columns}
          data={logs}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onLimitChange={setLimit}
          onOffsetChange={setOffset}
          onRetry={fetchLogs}
          onRowClick={setSelectedLog}
          filters={
            <>
              <DateRangeFilter
                value={dateRange}
                onChange={(range) => { setDateRange(range); setOffset(0) }}
              />
              <Input
                placeholder="搜索令牌..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value)
                  setOffset(0)
                }}
                className="w-56"
              />
              <Select
                value={modelFilter}
                onValueChange={(value) => handleFilterChange(setModelFilter, value)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部模型</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => handleFilterChange(setStatusFilter, value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="success">成功</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                重置筛选
              </Button>
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm">
                导出
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setClearDialogOpen(true)}
              >
                清空
              </Button>
            </>
          }
        />
        </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>清空当前筛选条件下的所有内容，确认吗？</DialogTitle>
            <DialogDescription>
              此操作不可恢复，清空后无法找回相关记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setClearDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearFiltered()}>
              清空当前页面的
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearAll()}>
              清空所有页面的
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedLog !== null} onOpenChange={(open) => { if (!open) setSelectedLog(null) }}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>请求详情</DialogTitle>
          </DialogHeader>
          {selectedLog && <LogDetailFields log={selectedLog} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LogDetailFields({ log }: { log: UsageLog }) {
  const fmtMs = (val: number) => (val >= 0 ? `${val}ms` : '-')
  const date = new Date(log.createdAt)
  const timeText = Number.isNaN(date.getTime())
    ? log.createdAt
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  return (
    <div className="space-y-4 text-xs">
      <FieldGroup title="基本信息">
        <DetailRow label="时间" value={timeText} />
        <DetailRow label="用户" value={log.userId || '-'} />
        <DetailRow label="令牌" value={log.tokenName || '-'} />
        <DetailRow label="供应商" value={log.providerName || '-'} />
        <DetailRow label="模型" value={log.modelName || '-'} />
      </FieldGroup>
      <FieldGroup title="用量">
        <DetailRow
          label="Tokens"
          value={
            <span>
              <span className="text-muted-foreground/40">输入</span> {log.promptTokens}（
              <span className="text-muted-foreground/40">缓存写入</span> {log.promptCacheMissTokens} /{' '}
              <span className="text-muted-foreground/40">缓存读取</span> {log.promptCacheHitTokens}）/{' '}
              <span className="text-muted-foreground/40">输出</span> {log.completionTokens}
            </span>
          }
        />
        <DetailRow label="流式" value={log.isStream ? 'SSE' : '-'} />
        <DetailRow label="消耗" value={log.quota > 0 ? formatQuota(log) : '-'} />
      </FieldGroup>
      <FieldGroup title="耗时">
        <DetailRow label="耗时" value={`${(log.useTime / 1000).toFixed(1)}s`} />
        <DetailRow label="排队" value={fmtMs(log.queueWaitMs)} />
        <DetailRow label="请求改写" value={fmtMs(log.requestRewriteMs)} />
        <DetailRow label="连接" value={fmtMs(log.connectMs)} />
        <DetailRow label="首字" value={fmtMs(log.firstByteMs)} />
        <DetailRow label="响应改写" value={fmtMs(log.responseRewriteMs)} />
        <DetailRow label="流式改写" value={fmtMs(log.streamRewriteMs)} />
      </FieldGroup>
      <FieldGroup title="状态">
        <DetailRow label="状态" value={log.status === 'success' ? '成功' : '失败'} />
        {log.errorMessage && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground">报错原因</span>
            <span className="break-words whitespace-pre-wrap text-destructive">{log.errorMessage}</span>
          </div>
        )}
      </FieldGroup>
    </div>
  )
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <h4 className="shrink-0 font-medium text-muted-foreground">{title}</h4>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 min-w-[4rem] text-muted-foreground">{label}</span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  )
}

function formatQuota(log: UsageLog): string {
  const symbol = log.currency === 'USD' ? '$' : '¥'
  return `${symbol}${log.quota.toFixed(6).replace(/\.?0+$/, '')}`
}
