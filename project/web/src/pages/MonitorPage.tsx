import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { UsageLogDetailDialog } from '@/components/UsageLogDetailDialog'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  dashboardApi,
  type UsageLog,
  type LogStats,
  type ActiveRequest,
  type ActiveRequestConfig,
  type DateRange,
} from '@/lib/dashboard-api'

const POLL_INTERVAL_MS = 2000
const ELAPSED_TICK_MS = 1000

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}KB`
  return `${n}B`
}

// 缓存命中率展示：不足 100% 的绝不进位成 100.0%，只有完全相等才显示 100.0%。
function cacheHitRateText(rate: number): string {
  if (rate >= 1) return '100.0%'
  return `${Math.min(rate * 100, 99.9).toFixed(1)}%`
}

function formatActiveStage(row: ActiveRequest, t: TFunction): string {
  const elapsed = `${(row.elapsedMs / 1000).toFixed(1)}s`
  switch (row.stage) {
    case 'queued':
      return t('monitor.active.stageQueued', { elapsed })
    case 'connecting':
      return t('monitor.active.stageConnecting', { provider: row.provider ?? '', elapsed })
    case 'waiting_upstream':
      return t('monitor.active.stageWaitingUpstream', { elapsed })
    case 'receiving_stream':
      return t('monitor.active.stageReceivingStream', { chunk: row.chunkCount, bytes: formatBytes(row.bytesReceived) })
    case 'receiving':
      return t('monitor.active.stageReceiving', { bytes: formatBytes(row.bytesReceived) })
    default:
      return t('monitor.active.stageActive')
  }
}

function formatOutcome(outcome: string, t: TFunction): string {
  switch (outcome) {
    case 'client_disconnected':
      return t('monitor.active.outcomeClientDisconnected')
    case 'upstream_error':
      return t('monitor.active.outcomeUpstreamError')
    case 'failed':
      return t('monitor.active.outcomeNoProvider')
    case 'queued_rejected':
      return t('monitor.active.outcomeConcurrency')
    case 'invalid_request':
      return t('monitor.active.outcomeParseError')
    case 'killed':
      return t('monitor.active.outcomeKilled')
    default:
      return t('monitor.active.outcomeFinished')
  }
}

function formatOutcomeClass(outcome: string): string {
  switch (outcome) {
    case 'client_disconnected':
      return 'text-warning'
    case 'upstream_error':
    case 'failed':
    case 'queued_rejected':
    case 'invalid_request':
    case 'killed':
      return 'text-destructive'
    default:
      return ''
  }
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtSeconds(val: number): string {
  if (val < 0) return '-'
  if (val === 0) return '0s'
  return `${Math.max(0.1, val / 1000).toFixed(1)}s`
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

function buildActiveRequestColumns(t: TFunction): ColumnDef<ActiveRequest>[] {
  return [
    {
      key: 'status',
      label: t('columns.status'),
      defaultWidth: { kind: 'pixel', value: 230 },
      render: (_, row) => {
        const finished = row.endTime !== null
        return (
          <span className={finished ? formatOutcomeClass(row.outcome) : 'text-success'}>
            {finished ? formatOutcome(row.outcome, t) : formatActiveStage(row, t)}
          </span>
        )
      },
      rowClassName: (row) => {
        if (row.endTime !== null) return ''
        return row.stage === 'queued' ? 'bg-warning/30' : 'bg-primary/15'
      },
    },
    {
      key: 'startTime',
      label: t('columns.startTime'),
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultOverflow: 'wrap',
      slot: {
        line1: (row) => formatDateTimeCell(row.startTime)?.time ?? null,
      },
    },
    { key: 'source', label: t('columns.source'), defaultWidth: { kind: 'percent', value: 8 }, accessor: (row) => (row.source ? row.source.replace(/^__/, '') : null) },
    { key: 'tokenName', label: t('columns.token'), defaultWidth: { kind: 'percent', value: 10 } },
    { key: 'provider', label: t('columns.provider'), defaultWidth: { kind: 'percent', value: 12 } },
    { key: 'model', label: t('columns.model'), defaultWidth: { kind: 'percent', value: 15 } },
    {
      key: 'affinityReuse',
      label: t('columns.affinity'),
      defaultWidth: { kind: 'percent', value: 8 },
      accessor: (row) => {
        const a = (row as ActiveRequest).affinityReuse ?? ''
        if (a === '') return null
        if (a === 'full') return `<#16a34a>${t('affinity.full')}</#16a34a>`
        if (a === 'partial') return `<#d97706>${t('affinity.partial')}</#d97706>`
        if (a === 'new') return `<#0ea5e9>${t('affinity.new')}</#0ea5e9>`
        return `<#9ca3af>${t('affinity.create')}</#9ca3af>`
      },
    },
    { key: 'stream', label: t('columns.stream'), defaultWidth: { kind: 'percent', value: 5 }, accessor: (row) => (row.stream ? 'SSE' : null) },
    {
      key: 'elapsedMs',
      label: t('columns.latency'),
      defaultWidth: { kind: 'percent', value: 13 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      accessor: (row) => {
        const total = fmtSeconds(row.elapsedMs)
        const firstByte = row.firstByteMs != null ? fmtSeconds(row.firstByteMs) : '-'
        const fbColored = row.firstByteMs != null && row.firstByteMs > 20000
          ? `<#dc2626>${firstByte}</#dc2626>`
          : firstByte
        return t('columns.latencyWithFirstByte', { total, firstByte: fbColored })
      },
    },
  ]
}

type MetricCardProps = {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  className?: string
}

function MetricCard({ icon, label, value, sub, className }: MetricCardProps) {
  return (
    <Card size="sm" className={cn('min-w-0', className)}>
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums break-words">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</p>}
          </div>
          <div className="ml-2 shrink-0 rounded-none bg-muted p-2 text-muted-foreground [&>svg]:size-4">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MetricSkeleton() {
  return (
    <Card size="sm">
      <CardContent>
        <Skeleton className="mb-2 h-3 w-16" />
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  )
}

// ── 统计模块 ──

function StatsSection() {
  const { t } = useTranslation('logs')
  const [dateRange, setDateRange] = useState<DateRange>({})
  const [stats, setStats] = useState<LogStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const mountedRef = useRef(true)

  const fetchStats = useCallback(async (r: DateRange) => {
    setLoading(true)
    setError(null)
    try {
      const data = await dashboardApi.getLogStats(r)
      if (!mountedRef.current) return
      setStats(data)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : t('error.statsFailed'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    void fetchStats(dateRange)
  }, [dateRange, fetchStats])

  const handleRetry = useCallback(() => {
    void fetchStats(dateRange)
  }, [dateRange, fetchStats])

  // With from/to the backend aggregates the dedicated usage_stats table
  // (per-batch stats history, independent of the usage-logs table);
  // without them it returns the lifetime usage counter. The filter is
  // always rendered either way.
  const successRate = stats && stats.totalRequests > 0
    ? `${((stats.successCount / stats.totalRequests) * 100).toFixed(1)}%`
    : '-'

  const totalCost = stats?.totalCost ?? 0
  const throughput = stats?.throughput ?? 0
  const cacheHitRate = stats?.cacheHitRate ?? 0
  const cacheActivity = stats && (stats.successCount > 0 || stats.totalRequests > 0)

  const handleClearUsage = useCallback(async () => {
    if (clearing) return
    setClearing(true)
    try {
      await dashboardApi.clearUsage()
      toast(t('monitor.clear.done'))
      setClearConfirmOpen(false)
      void fetchStats(dateRange)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.clearFailed'))
    } finally {
      setClearing(false)
    }
  }, [clearing, fetchStats, dateRange, t])

  const closeClearDialog = useCallback((open: boolean) => {
    if (clearing) return
    setClearOpen(open)
  }, [clearing])

  const closeClearConfirmDialog = useCallback((open: boolean) => {
    if (clearing) return
    setClearConfirmOpen(open)
  }, [clearing])

  return (
    <section className="mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('monitor.stats.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearOpen(true)}
            title={t('monitor.clear.tooltip')}
          >
            <AppIcon name="delete" data-icon="inline-start" />
            {t('monitor.clear.button')}
          </Button>
        </div>
      </div>

      {/* Loading state: first load only */}
      {loading && !stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 9 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
      ) : error && !stats ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <AppIcon name="error" size={40} className="mx-auto mb-3 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={handleRetry}>
              <AppIcon name="refresh" data-icon="inline-start" />
              {t('common:action.retry')}
            </Button>
          </div>
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <MetricCard
              icon={<AppIcon name="hashtag" />}
              label={t('monitor.metrics.totalRequests')}
              value={String(stats.totalRequests)}
            />
            <MetricCard
              icon={<AppIcon name="check_circle" />}
              label={t('monitor.metrics.successRequests')}
              value={String(stats.successCount)}
            />
            <MetricCard
              icon={<AppIcon name="cancel" />}
              label={t('monitor.metrics.failedRequests')}
              value={String(stats.failedCount)}
            />
            <MetricCard
              icon={<AppIcon name="chat" />}
              label={t('monitor.metrics.totalTokens')}
              value={formatTokens(stats.totalTokens)}
            />
            <MetricCard
              icon={<AppIcon name="schedule" />}
              label={t('monitor.metrics.averageLatency')}
              value={formatLatency(stats.averageLatency)}
            />
            <MetricCard
              icon={<AppIcon name="dns" />}
              label={t('monitor.metrics.successRate')}
              value={successRate}
            />
            <MetricCard
              icon={<AppIcon name="sell" />}
              label={t('monitor.metrics.cost')}
              value={`¥${totalCost.toFixed(2)}`}
            />
            <MetricCard
              icon={<AppIcon name="bolt" />}
              label={t('monitor.metrics.throughput')}
              value={throughput > 0 ? `${throughput.toFixed(2)} tokens/s` : '-'}
            />
            <MetricCard
              icon={<AppIcon name="refresh" />}
              label={t('monitor.metrics.cacheHitRate')}
              value={cacheActivity && cacheHitRate > 0 ? cacheHitRateText(cacheHitRate) : '-'}
            />
          </div>
        </>
      ) : null}

      {/* Error banner (with existing data) */}
      {error && stats && (
        <div className="mt-4 rounded-none border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-xs text-destructive">{error}</span>
        </div>
      )}

      <Dialog open={clearOpen} onOpenChange={closeClearDialog}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('monitor.clear.button')}</DialogTitle>
            <DialogDescription>
              {t('monitor.clear.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={clearing}
                onClick={() => {
                  setClearOpen(false)
                  setClearConfirmOpen(true)
                }}
              >
                {t('common:action.clear')}
              </Button>
            </>
          }>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>

      <Dialog open={clearConfirmOpen} onOpenChange={closeClearConfirmDialog}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('monitor.clear.confirmTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="destructive" size="sm" onClick={() => void handleClearUsage()} disabled={clearing}>
                {clearing ? t('monitor.clear.clearing') : t('monitor.clear.confirm')}
              </Button>
            </>
          }>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── 活跃请求模块 ──

const RETENTION_MINUTES: readonly number[] = [0, 0.5, 1, 2, 5, 10, 30]

function formatRetention(minutes: number, t: TFunction): string {
  if (minutes <= 0) return t('monitor.retention.immediate')
  if (minutes < 1) return t('monitor.retention.seconds', { count: Math.round(minutes * 60) })
  return t('monitor.retention.minutes', { count: minutes })
}

function retentionLabel(minutes: number, t: TFunction): string {
  if (minutes <= 0) return t('monitor.retention.immediate')
  return t('monitor.retention.label', { retention: formatRetention(minutes, t) })
}

function ActiveRequestsSection() {
  const { t } = useTranslation('logs')
  const [requests, setRequests] = useState<readonly ActiveRequest[]>([])
  const [config, setConfig] = useState<ActiveRequestConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedUsageLog, setSelectedUsageLog] = useState<UsageLog | null>(null)
  const [draft, setDraft] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const mountedRef = useRef(true)
  // Latest-poll-wins: drop stale snapshots so a slow response can't overwrite a fresher one.
  const fetchSeqRef = useRef(0)
  const [killingId, setKillingId] = useState<string | null>(null)

  const fetchActive = useCallback(async () => {
    const seq = ++fetchSeqRef.current
    try {
      const data = await dashboardApi.getActiveRequests()
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      const sorted = [...data].sort((a, b) => (a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0))
      setRequests(sorted)
      setError(null)
    } catch (err) {
      if (!mountedRef.current || seq !== fetchSeqRef.current) return
      setError(err instanceof Error ? err.message : t('error.activeFailed'))
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    void fetchActive()
    const pollTimer = setInterval(fetchActive, POLL_INTERVAL_MS)
    const tickTimer = setInterval(() => setTick((t) => t + 1), ELAPSED_TICK_MS)
    return () => {
      mountedRef.current = false
      clearInterval(pollTimer)
      clearInterval(tickTimer)
    }
  }, [fetchActive])

  useEffect(() => {
    let active = true
    dashboardApi.getActiveRequestConfig()
      .then((c) => { if (active) setConfig(c) })
      .catch((err) => {
        if (active) setConfigError(err instanceof Error ? err.message : t('error.retentionFailed'))
      })
    return () => { active = false }
  }, [t])

  const handleKill = useCallback(async (row: ActiveRequest) => {
    if (killingId !== null) return
    setKillingId(row.requestId)
    try {
      await dashboardApi.killActiveRequest(row.requestId)
      toast(t('monitor.kill.done'))
      void fetchActive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.killFailed'))
    } finally {
      setKillingId(null)
    }
  }, [killingId, fetchActive, t])

  const columns = useMemo<ColumnDef<ActiveRequest>[]>(() => [
    ...buildActiveRequestColumns(t),
    {
      key: 'actions',
      label: t('columns.operation'),
      defaultWidth: { kind: 'pixel', value: 90 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) =>
        row.endTime !== null ? null : (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={killingId !== null}
            title={t('monitor.kill.tooltip')}
            onClick={(event) => {
              event.stopPropagation()
              void handleKill(row)
            }}
          >
            {killingId === row.requestId ? t('monitor.kill.killing') : t('monitor.kill.button')}
          </Button>
        ),
    },
  ], [killingId, handleKill, t])

  const handleOpenDialog = () => {
    setDraft(config?.retentionMinutes ?? 5)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const updated = await dashboardApi.updateActiveRequestConfig(draft)
      setConfig(updated)
      setConfigError(null)
      setDialogOpen(false)
      toast(t('monitor.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <AppIcon name="bolt" className="text-muted-foreground" />
        {t('monitor.active.title')}
        {requests.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {requests.length}
          </span>
        )}
      </div>

      <DataTable
        id="monitor-requests"
        columns={columns}
        data={requests}
        total={requests.length}
        loading={loading}
        error={error}
        offset={0}
        limit={requests.length}
        onOffsetChange={() => {}}
        onRetry={fetchActive}
        onRowClick={(row) => {
          if (!row.endTime) return
          void dashboardApi
            .listLogs({ requestId: row.requestId, limit: 1, offset: 0 })
            .then((result) => {
              if (result.logs[0]) setSelectedUsageLog(result.logs[0])
            })
            .catch(() => {})
        }}
        showPagination={false}
        actions={
          <>
            {error && (
              <span className="inline-flex items-center gap-1 text-xs text-destructive">
                <AppIcon name="error" data-icon="inline-start" />
                {error}
              </span>
            )}
            {configError ? (
              <Button variant="outline" size="sm" onClick={handleOpenDialog} title={configError}>
                <AppIcon name="settings" data-icon="inline-start" />
                {t('monitor.retention.unknown')}
              </Button>
            ) : config ? (
              <Button variant="outline" size="sm" onClick={handleOpenDialog} title={t('monitor.retention.setTooltip')}>
                <AppIcon name="settings" data-icon="inline-start" />
                {retentionLabel(config.retentionMinutes, t)}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleOpenDialog}>
                <AppIcon name="settings" data-icon="inline-start" />
                --
              </Button>
            )}
          </>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('monitor.retention.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('monitor.retention.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? t('common:state.saving') : t('common:action.save')}
              </Button>
            </>
          }>
          <div className="flex flex-wrap gap-2">
            {RETENTION_MINUTES.map((value) => (
              <Button
                key={value}
                variant={draft === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDraft(value)}
              >
                {formatRetention(value, t)}
              </Button>
            ))}
          </div>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>

      <UsageLogDetailDialog
        log={selectedUsageLog}
        onOpenChange={(open) => {
          if (!open) setSelectedUsageLog(null)
        }}
      />
    </section>
  )
}

export function MonitorPage() {
  const { t } = useTranslation('logs')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('page.activity.description')}
      />
      <div className="flex-1 overflow-auto p-6">
        <StatsSection />
        <ActiveRequestsSection />
      </div>
    </div>
  )
}
