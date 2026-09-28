import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { UsageLogDetailDialog } from '@/components/UsageLogDetailDialog'

import { Button } from '@/components/ui/button'
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
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi, LOG_SOURCE_UNMARKED, type DateRange, type LogTypeFilter, type UsageLog } from '@/lib/dashboard-api'

// Format a stage time in seconds: 0 shows "0s", values above 0 floor at 0.1s.
function fmtSeconds(val: number): string {
  if (val < 0) return '-'
  if (val === 0) return '0s'
  return `${Math.max(0.1, val / 1000).toFixed(1)}s`
}

// Event records (故障转移/自动恢复/手动恢复/系统管理) carry an empty status.
function isEventLog(row: UsageLog): boolean {
  return row.status === ''
}

// 缓存命中率 = 缓存读取 / 分母，分母取「输入」与「缓存读取+缓存写入」的较大者：
// OpenAI 系输入含缓存计数，比例即 缓存读取/输入（未命中缓存的输入也会拉低比例）；
// Anthropic 系输入不含缓存计数，退回 缓存读取/(缓存读取+缓存写入)。两者都不会超过 100%。
// 显示保留 1 位小数，但不足 100% 的绝不进位成 100.0%——只有分子与分母完全相等才显示 100.0%。
function cacheHitRateText(hit: number, miss: number, promptTokens: number): string | null {
  const denom = Math.max(promptTokens, hit + miss)
  if (denom <= 0) return null
  if (hit >= denom) return '100.0%'
  return `${Math.min((hit / denom) * 100, 99.9).toFixed(1)}%`
}

// Event-type label → color (hex) so the "来源" column tints each event
// type distinctly, matching the visual language of the status badges.
const EVENT_SOURCE_COLORS: Record<string, string> = {
  故障转移: 'dc2626',
  自动恢复: '16a34a',
  手动恢复: '2563eb',
  系统管理: '9ca3af',
}

export function LogsPage() {
  const [logs, setLogs] = useState<readonly UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<LogTypeFilter | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tokenFilter, setTokenFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>({})
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const mountedRef = useRef(true)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [selectedLog, setSelectedLog] = useState<UsageLog | null>(null)
  const [modelOptions, setModelOptions] = useState<readonly string[]>([])
  const [providerOptions, setProviderOptions] = useState<readonly string[]>([])
  const [tokenOptions, setTokenOptions] = useState<readonly string[]>([])
  const [sourceOptions, setSourceOptions] = useState<readonly string[]>([])

  const filterArgs = useMemo(
    () => ({
      model: modelFilter !== 'all' ? modelFilter : undefined,
      provider: providerFilter !== 'all' ? providerFilter : undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      token: tokenFilter !== 'all' ? tokenFilter : undefined,
      source: sourceFilter !== 'all' ? sourceFilter : undefined,
      from: dateRange.from,
      to: dateRange.to,
    }),
    [modelFilter, providerFilter, typeFilter, statusFilter, tokenFilter, sourceFilter, dateRange.from, dateRange.to],
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
    const timer = setTimeout(() => void fetchPage(), 0)
    return () => clearTimeout(timer)
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
      if (providerFilter !== 'all') filters.provider = providerFilter
      if (typeFilter !== 'all') filters.type = typeFilter
      if (statusFilter !== 'all') filters.status = statusFilter
      if (tokenFilter !== 'all') filters.token = tokenFilter
      if (sourceFilter !== 'all') filters.source = sourceFilter
      if (dateRange.from) filters.from = dateRange.from
      if (dateRange.to) filters.to = dateRange.to
      const deleted = await dashboardApi.clearLogs({ scope: 'filtered', filters })
      setClearDialogOpen(false)
      toast(`已清空 ${deleted} 条记录`)
      void fetchPage()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [modelFilter, providerFilter, typeFilter, statusFilter, tokenFilter, sourceFilter, dateRange.from, dateRange.to, fetchPage])

  const handleResetFilters = useCallback(() => {
    setTokenFilter('all')
    setModelFilter('all')
    setProviderFilter('all')
    setTypeFilter('all')
    setStatusFilter('all')
    setSourceFilter('all')
    setDateRange({})
  }, [])

  const handleClearAll = useCallback(async () => {
    try {
      const deleted = await dashboardApi.clearLogs({ scope: 'all' })
      setClearDialogOpen(false)
      setLogs([])
      setTotal(0)
      toast(`已清空全部 ${deleted} 条记录`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败')
    }
  }, [])

  // Load the full provider/model option pools once so filters stay stable
  // across pagination (previously the model list came from the current page).
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [providers, models] = await Promise.all([
          dashboardApi.listProviders({ limit: 500, offset: 0 }),
          dashboardApi.listLogModels(),
        ])
        if (!alive) return
        setProviderOptions(
          [...new Set(providers.providers.map((p) => p.name).filter((n) => n !== ''))].sort((a, b) => a.localeCompare(b)),
        )
        setModelOptions(models)
      } catch {
        // Non-fatal: filters still work with whatever options we have.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Load the full token name pool once so the token filter stays stable
  // across pagination.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const tokens = await dashboardApi.listTokens({ limit: 500, offset: 0 })
        if (!alive) return
        setTokenOptions(
          [...new Set(tokens.tokens.map((t) => t.name).filter((n) => n !== ''))].sort((a, b) => a.localeCompare(b)),
        )
      } catch {
        // Non-fatal: filters still work with whatever options we have.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Load the distinct source pool once so the source filter stays stable
  // across pagination.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const sources = await dashboardApi.listLogSources()
        if (!alive) return
        setSourceOptions(sources)
      } catch {
        // Non-fatal: filters still work with whatever options we have.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function formatDateTimeCell(row: UsageLog): { date: string; time: string } | null {
    const v = row.createdAt
    if (v === null || v === undefined || v === '') return null
    const d = new Date(v as string | number)
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
    {
      key: 'source',
      label: '来源',
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => {
        if (row.source) {
          const colored = EVENT_SOURCE_COLORS[row.source]
          if (colored) return `<#${colored}>${row.source}</#${colored}>`
          return row.source.replace(/^__/, '')
        }
        return null
      },
    },
    { key: 'tokenName', label: '令牌', defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'providerName', label: '供应商', defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'modelName', label: '模型', defaultWidth: { kind: 'percent', value: 12 } },
    {
      key: 'affinityReuse',
      label: '渠道亲和性',
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => {
        const log = row as UsageLog
        if (log.affinityReuse === '') return null
        if (log.affinityReuse === 'full') return '<#16a34a>复用渠道</#16a34a>'
        if (log.affinityReuse === 'partial') return '<#d97706>部分复用</#d97706>'
        if (log.affinityReuse === 'new') return '<#0ea5e9>新渠道</#0ea5e9>'
        return '<#9ca3af>创建渠道</#9ca3af>'
      },
    },
    {
      key: 'promptTokens',
      label: 'Tokens',
      defaultWidth: { kind: 'percent', value: 22 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      accessor: (row) => {
        const hitRate = cacheHitRateText(row.promptCacheHitTokens, row.promptCacheMissTokens, row.promptTokens)
        return `输入 ${row.promptTokens} · 缓存写入 ${row.promptCacheMissTokens} · 缓存读取 ${row.promptCacheHitTokens}${hitRate !== null ? ` (${hitRate})` : ''} · 输出 ${row.completionTokens}`
      },
      render: (_, row) => {
        const log = row as UsageLog
        if (isEventLog(log)) return <span className="text-muted-foreground/40">-</span>
        const hitRate = cacheHitRateText(log.promptCacheHitTokens, log.promptCacheMissTokens, log.promptTokens)
        return (
          <div className="text-xs">
            <span className="text-muted-foreground">输入</span> {log.promptTokens}{' '}
            <span className="text-muted-foreground">缓存写入</span> {log.promptCacheMissTokens}{' '}
            <span className="text-muted-foreground">缓存读取</span> {log.promptCacheHitTokens}
            {hitRate !== null ? ` (${hitRate})` : ''}{' '}
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
        if (isEventLog(row)) return null
        const total = fmtSeconds(row.useTime)
        const firstByte = fmtSeconds(row.firstByteMs)
        // 首字超过 20 秒标红
        const fbColored = row.firstByteMs > 20000 ? `<#dc2626>${firstByte}</#dc2626>` : firstByte
        return `${total}（首字:${fbColored}）`
      },
    },
    {
      key: 'speed',
      label: '速度',
      defaultWidth: { kind: 'percent', value: 9 },
      defaultAlign: 'right',
      // 速度 = 总 token / 全程耗时（从请求发起到结束，含建连）。
      accessor: (row) => {
        if (isEventLog(row) || row.status !== 'success') return null
        const tokens = row.promptTokens + row.completionTokens
        if (tokens <= 0 || row.useTime <= 0) return null
        return `${(tokens * 1000 / row.useTime).toFixed(1)} tok/s`
      },
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'percent', value: 25 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => {
          if (row.status === 'success') return '<#16a34a>成功</#16a34a>'
          if (row.status === 'failed') return '<#dc2626>失败</#dc2626>'
          // 事件行（故障转移/自动恢复/手动恢复/系统管理）：状态列只显示来源标签，
          // 长文本（errorMessage/eventDetail）统一放进详情字段。
          return row.source ? `<#9ca3af>${row.source}</#9ca3af>` : null
        },
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
              <Select
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as LogTypeFilter | 'all')}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="request">请求</SelectItem>
                    <SelectItem value="channel_disabled">故障转移</SelectItem>
                    <SelectItem value="channel_recovered_auto">自动恢复</SelectItem>
                    <SelectItem value="channel_recovered_manual">手动恢复</SelectItem>
                    <SelectItem value="system_admin">系统管理</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(value) => handleFilterChange(setSourceFilter, value)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部来源</SelectItem>
                    <SelectItem value={LOG_SOURCE_UNMARKED}>未标注来源</SelectItem>
                    {sourceOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace(/^__/, '')}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={tokenFilter}
                onValueChange={(value) => setTokenFilter(value)}
              >
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
              <Select
                value={providerFilter}
                onValueChange={(value) => handleFilterChange(setProviderFilter, value)}
              >
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
                    {modelOptions.map((m) => (
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
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>清空当前筛选条件下的所有内容，确认吗？</DialogTitle>
            <DialogDescription>
              此操作不可恢复，清空后无法找回相关记录。
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="destructive" size="sm" onClick={() => void handleClearFiltered()}>
                清空当前页面的
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void handleClearAll()}>
                清空所有页面的
              </Button>
            </>
          }>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>

      <UsageLogDetailDialog
        log={selectedLog}
        onOpenChange={(open) => { if (!open) setSelectedLog(null) }}
      />
    </div>
  )
}

function formatQuota(log: UsageLog): string {
  const symbol = log.currency === 'USD' ? '$' : '¥'
  return `${symbol}${log.quota.toFixed(6).replace(/\.?0+$/, '')}`
}
