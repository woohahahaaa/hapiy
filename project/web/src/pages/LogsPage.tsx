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

// Format a stage time in seconds: 0 shows "0s", values above 0 floor at 0.1s.
function fmtSeconds(val: number): string {
  if (val < 0) return '-'
  if (val === 0) return '0s'
  return `${Math.max(0.1, val / 1000).toFixed(1)}s`
}

export function LogsPage() {
  const [logs, setLogs] = useState<readonly UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>({})
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const mountedRef = useRef(true)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [selectedLog, setSelectedLog] = useState<UsageLog | null>(null)

  const filterArgs = useMemo(
    () => ({
      model: modelFilter !== 'all' ? modelFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      token: searchText || undefined,
      from: dateRange.from,
      to: dateRange.to,
    }),
    [modelFilter, statusFilter, searchText, dateRange.from, dateRange.to],
  )

  const fetchPage = useCallback(async () => {
    setInitialLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listLogs({ ...filterArgs, limit, offset })
      if (!mountedRef.current) return
      setLogs(result.logs)
      setTotal(result.total)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (mountedRef.current) {
        setInitialLoading(false)
      }
    }
  }, [filterArgs, limit, offset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage])

  const handleFilterChange = useCallback(
    (setter: (v: string) => void, value: string | null) => {
      setter(value ?? 'all')
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
      void fetchPage()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [modelFilter, statusFilter, searchText, dateRange.from, dateRange.to, fetchPage])

  const handleResetFilters = useCallback(() => {
    setSearchText('')
    setModelFilter('all')
    setStatusFilter('all')
    setDateRange({})
  }, [])

  const handleClearAll = useCallback(async () => {
    try {
      const deleted = await dashboardApi.clearLogs({ scope: 'all' })
      setClearDialogOpen(false)
      setLogs([])
      setTotal(0)
      setNextOffset(0)
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
    {
      key: 'source',
      label: '来源',
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => (row.source ? row.source.replace(/^__/, '') : null),
    },
    {
      key: 'affinityReuse',
      label: '渠道亲和性',
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => {
        const log = row as UsageLog
        if (log.affinityReuse === '') return null
        if (log.affinityReuse === 'full') return '<#16a34a>复用渠道</#16a34a>'
        if (log.affinityReuse === 'partial') return '<#d97706>部分复用</#d97706>'
        return '<#9ca3af>创建渠道</#9ca3af>'
      },
    },
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
            <span className="text-muted-foreground">输入</span> {log.promptTokens}{' '}
            <span className="text-muted-foreground">缓存写入</span> {log.promptCacheMissTokens}{' '}
            <span className="text-muted-foreground">缓存读取</span> {log.promptCacheHitTokens}{' '}
            <span className="text-muted-foreground">输出</span> {log.completionTokens}
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
      defaultOverflow: 'wrap',
      accessor: (row) => {
        const total = fmtSeconds(row.useTime)
        const firstByte = fmtSeconds(row.firstByteMs)
        // 首字超过 20 秒标红
        const fbColored = row.firstByteMs > 20000 ? `<#dc2626>${firstByte}</#dc2626>` : firstByte
        return `${total}（首字:${fbColored}）`
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
          loading={initialLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          onRetry={fetchPage}
          onRowClick={setSelectedLog}
          filters={
            <>
              <DateRangeFilter
                value={dateRange}
                onChange={(range) => { setDateRange(range) }}
              />
              <Input
                placeholder="搜索令牌..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value)
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
            <DialogTitle>请求记录 {selectedLog?.id ?? ''}</DialogTitle>
          </DialogHeader>
          {selectedLog && <LogDetailFields log={selectedLog} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LogDetailFields({ log }: { log: UsageLog }) {
  const date = new Date(log.createdAt)
  const timeText = Number.isNaN(date.getTime())
    ? log.createdAt
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  return (
    <div className="space-y-4 text-xs">
      <FieldGroup>
        <DetailRow className="col-span-2" label="请求 id" value={log.requestId || '-'} />
        <DetailRow className="col-span-2" label="时间" value={timeText} />
        <DetailRow className="col-span-2" label="令牌" value={log.tokenName || '-'} />
        <DetailRow className="col-span-2" label="供应商" value={log.providerName || '-'} />
        <DetailRow className="col-span-2" label="模型" value={log.modelName || '-'} />
        <DetailRow className="col-span-2" label="来源" value={log.source || '-'} />
        <div className="col-span-2 flex items-baseline gap-2">
          <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">上游 URL</span>
          <span className="break-all font-mono">{log.upstreamUrl || '-'}</span>
        </div>
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
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
        <DetailRow className="col-span-2" label="流式" value={log.isStream ? 'SSE' : '-'} />
        <DetailRow className="col-span-2" label="消耗" value={log.quota > 0 ? formatQuota(log) : '-'} />
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label="耗时"
          value={
            <span className="space-y-1">
              <span className="block">{`${(log.useTime / 1000).toFixed(1)}s`}</span>
              <span className="block text-muted-foreground/60">
                排队 {fmtSeconds(log.queueWaitMs)} · 请求改写 {fmtSeconds(log.requestRewriteMs)} · 连接{' '}
                {fmtSeconds(log.connectMs)} · 首字 {fmtSeconds(log.firstByteMs)} · 响应改写{' '}
                {fmtSeconds(log.responseRewriteMs)} · 流式改写 {fmtSeconds(log.streamRewriteMs)}
              </span>
            </span>
          }
        />
      </FieldGroup>
      <FieldGroup>
        <DetailRow
          className="col-span-2"
          label="渠道亲和性"
          value={
            log.affinityReuse === ''
              ? '-'
              : (() => {
                  const labels: Record<string, string> = {
                    none: '创建渠道',
                    partial: '部分复用',
                    full: '复用渠道',
                  }
                  const state = labels[log.affinityReuse] ?? log.affinityReuse
                  const partLabels: Record<string, string> = {
                    provider: 'Provider',
                    baseurl: 'Base URL',
                    key: 'Key',
                  }
                  const parts = log.affinityReuseParts.map((p) => partLabels[p] ?? p).join('、')
                  return parts ? `${state}（复用：${parts}）` : state
                })()
          }
        />
        <DetailRow className="col-span-2" label="状态" value={log.status === 'success' ? '成功' : '失败'} />
        {log.errorMessage && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">报错原因</span>
            <span className="break-words whitespace-pre-wrap text-destructive">{log.errorMessage}</span>
          </div>
        )}
      </FieldGroup>
    </div>
  )
}

function FieldGroup({ children }: { children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 h-px bg-border" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="shrink-0 min-w-[4rem] text-muted-foreground/60">{label}</span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  )
}

function formatQuota(log: UsageLog): string {
  const symbol = log.currency === 'USD' ? '$' : '¥'
  return `${symbol}${log.quota.toFixed(6).replace(/\.?0+$/, '')}`
}
