import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('logs')
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
      setError(err instanceof Error ? err.message : t('error.loadFailed'))
    } finally {
      if (mountedRef.current) {
        setInitialLoading(false)
      }
    }
  }, [filterArgs, limit, offset, t])

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
      toast(t('clear.filteredDone', { count: deleted }))
      void fetchPage()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.clearFailed'))
    }
  }, [modelFilter, providerFilter, typeFilter, statusFilter, tokenFilter, sourceFilter, dateRange.from, dateRange.to, fetchPage, t])

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
      toast(t('clear.allDone', { count: deleted }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.clearFailed'))
    }
  }, [t])

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
      label: t('columns.time'),
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => formatDateTimeCell(row)?.date ?? null,
        line2: (row) => formatDateTimeCell(row)?.time ?? null,
      },
    },
    {
      key: 'source',
      label: t('columns.source'),
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
    { key: 'tokenName', label: t('columns.token'), defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'providerName', label: t('columns.provider'), defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'modelName', label: t('columns.model'), defaultWidth: { kind: 'percent', value: 12 } },
    {
      key: 'affinityReuse',
      label: t('columns.affinity'),
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => {
        const log = row as UsageLog
        if (log.affinityReuse === '') return null
        if (log.affinityReuse === 'full') return `<#16a34a>${t('affinity.full')}</#16a34a>`
        if (log.affinityReuse === 'partial') return `<#d97706>${t('affinity.partial')}</#d97706>`
        if (log.affinityReuse === 'new') return `<#0ea5e9>${t('affinity.new')}</#0ea5e9>`
        return `<#9ca3af>${t('affinity.create')}</#9ca3af>`
      },
    },
    {
      key: 'promptTokens',
      label: t('columns.tokens'),
      defaultWidth: { kind: 'percent', value: 22 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      accessor: (row) => {
        const hitRate = cacheHitRateText(row.promptCacheHitTokens, row.promptCacheMissTokens, row.promptTokens)
        return t('tokens.summary', {
          input: row.promptTokens,
          cacheWrite: row.promptCacheMissTokens,
          cacheRead: row.promptCacheHitTokens,
          output: row.completionTokens,
          hitRate: hitRate !== null ? ` (${hitRate})` : '',
        })
      },
      render: (_, row) => {
        const log = row as UsageLog
        if (isEventLog(log)) return <span className="text-muted-foreground/40">-</span>
        const hitRate = cacheHitRateText(log.promptCacheHitTokens, log.promptCacheMissTokens, log.promptTokens)
        return (
          <div className="text-xs">
            <span className="text-muted-foreground">{t('tokens.input')}</span> {log.promptTokens}{' '}
            <span className="text-muted-foreground">{t('tokens.cacheWrite')}</span> {log.promptCacheMissTokens}{' '}
            <span className="text-muted-foreground">{t('tokens.cacheRead')}</span> {log.promptCacheHitTokens}
            {hitRate !== null ? ` (${hitRate})` : ''}{' '}
            <span className="text-muted-foreground">{t('tokens.output')}</span> {log.completionTokens}
          </div>
        )
      },
    },
    {
      key: 'isStream',
      label: t('columns.stream'),
      defaultWidth: { kind: 'percent', value: 5 },
      accessor: (row) => (row.isStream ? 'SSE' : null),
    },
    {
      key: 'quota',
      label: t('columns.quota'),
      defaultWidth: { kind: 'percent', value: 8 },
      defaultAlign: 'right',
      accessor: (row) => (row.quota > 0 ? formatQuota(row) : null),
    },
    {
      key: 'useTime',
      label: t('columns.latency'),
      defaultWidth: { kind: 'percent', value: 13 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      accessor: (row) => {
        if (isEventLog(row)) return null
        const total = fmtSeconds(row.useTime)
        const firstByte = fmtSeconds(row.firstByteMs)
        // 首字超过 20 秒标红
        const fbColored = row.firstByteMs > 20000 ? `<#dc2626>${firstByte}</#dc2626>` : firstByte
        return t('columns.latencyWithFirstByte', { total, firstByte: fbColored })
      },
    },
    {
      key: 'speed',
      label: t('columns.speed'),
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
      label: t('columns.status'),
      defaultWidth: { kind: 'percent', value: 25 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => {
          if (row.status === 'success') return `<#16a34a>${t('status.success')}</#16a34a>`
          if (row.status === 'failed') return `<#dc2626>${t('status.failed')}</#dc2626>`
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
        title={t('page.usage.title')}
        description={t('page.usage.description')}
        status={total > 0 ? t('page.recordCount', { count: total }) : undefined}
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
                  <SelectValue placeholder={t('filters.type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allTypes')}</SelectItem>
                    <SelectItem value="request">{t('filters.typeRequest')}</SelectItem>
                    <SelectItem value="channel_disabled">{t('filters.typeChannelDisabled')}</SelectItem>
                    <SelectItem value="channel_recovered_auto">{t('filters.typeChannelRecoveredAuto')}</SelectItem>
                    <SelectItem value="channel_recovered_manual">{t('filters.typeChannelRecoveredManual')}</SelectItem>
                    <SelectItem value="system_admin">{t('filters.typeSystemAdmin')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={sourceFilter}
                onValueChange={(value) => handleFilterChange(setSourceFilter, value)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('filters.source')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allSources')}</SelectItem>
                    <SelectItem value={LOG_SOURCE_UNMARKED}>{t('filters.unmarkedSource')}</SelectItem>
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
                  <SelectValue placeholder={t('filters.token')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allTokens')}</SelectItem>
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
                  <SelectValue placeholder={t('filters.provider')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allProviders')}</SelectItem>
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
                  <SelectValue placeholder={t('filters.model')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allModels')}</SelectItem>
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
                  <SelectValue placeholder={t('filters.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
                    <SelectItem value="success">{t('status.success')}</SelectItem>
                    <SelectItem value="failed">{t('status.failed')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                {t('filters.reset')}
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
                {t('common:action.clear')}
              </Button>
            </>
          }
        />
      </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('clear.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('clear.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="destructive" size="sm" onClick={() => void handleClearFiltered()}>
                {t('clear.filtered')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void handleClearAll()}>
                {t('clear.all')}
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
