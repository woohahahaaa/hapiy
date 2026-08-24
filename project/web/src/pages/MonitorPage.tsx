import { useState, useEffect, useCallback, useRef } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  dashboardApi,
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

function formatActiveStage(row: ActiveRequest): string {
  const elapsed = `${(row.elapsedMs / 1000).toFixed(1)}s`
  switch (row.stage) {
    case 'queued':
      return `排队中 · 已等 ${elapsed}`
    case 'connecting':
      return `连接上游${row.provider ? ` ${row.provider}` : ''} · 已 ${elapsed}`
    case 'waiting_upstream':
      return `等待上游响应 · 已 ${elapsed}`
    case 'receiving_stream':
      return `接收中 · 第 ${row.chunkCount} chunk · 已收 ${formatBytes(row.bytesReceived)}`
    case 'receiving':
      return `接收响应中 · 已读 ${formatBytes(row.bytesReceived)}`
    default:
      return '活跃中'
  }
}

function formatOutcome(outcome: string): string {
  switch (outcome) {
    case 'client_disconnected':
      return '客户端断开'
    case 'upstream_error':
      return '上游报错'
    case 'failed':
      return '无可用供应商'
    case 'queued_rejected':
      return '并发超限'
    case 'invalid_request':
      return '解析错误'
    default:
      return '已结束'
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

const ACTIVE_REQUEST_COLUMNS: ColumnDef<ActiveRequest>[] = [
  {
    key: 'status',
    label: '状态',
    defaultWidth: { kind: 'pixel', value: 230 },
    render: (_, row) => {
      const finished = row.endTime !== null
      return (
        <span className={finished ? formatOutcomeClass(row.outcome) : 'text-success'}>
          {finished ? formatOutcome(row.outcome) : formatActiveStage(row)}
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
    label: '开始时间',
    defaultWidth: { kind: 'pixel', value: 160 },
    defaultOverflow: 'wrap',
    slot: {
      line1: (row) => formatDateTimeCell(row.startTime)?.date ?? null,
      line2: (row) => formatDateTimeCell(row.startTime)?.time ?? null,
    },
  },
  {
    key: 'tokenName', label: '令牌', defaultWidth: { kind: 'percent', value: 10 },
  },
  { key: 'provider', label: '供应商', defaultWidth: { kind: 'percent', value: 12 } },
  { key: 'model', label: '模型', defaultWidth: { kind: 'percent', value: 15 } },
  { key: 'source', label: '来源', defaultWidth: { kind: 'percent', value: 8 }, accessor: (row) => (row.source ? row.source.replace(/^__/, '') : null) },
  { key: 'stream', label: '流式', defaultWidth: { kind: 'percent', value: 5 }, accessor: (row) => (row.stream ? 'SSE' : null) },
  {
    key: 'elapsedMs',
    label: '耗时',
    defaultWidth: { kind: 'percent', value: 13 },
    defaultAlign: 'right',
    defaultOverflow: 'wrap',
    accessor: (row) => {
      const total = fmtSeconds(row.elapsedMs)
      const firstByte = row.firstByteMs != null ? fmtSeconds(row.firstByteMs) : '-'
      const fbColored = row.firstByteMs != null && row.firstByteMs > 20000
        ? `<#dc2626>${firstByte}</#dc2626>`
        : firstByte
      return `${total}（首字:${fbColored}）`
    },
  },
]

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
            <p className="mt-1 text-2xl font-bold tabular-nums truncate">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</p>}
          </div>
          <div className="ml-2 shrink-0 rounded-lg bg-muted p-2 text-muted-foreground [&>svg]:size-4">
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
  const [dateRange, setDateRange] = useState<DateRange>({})
  const [stats, setStats] = useState<LogStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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
      setError(err instanceof Error ? err.message : '获取统计失败')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

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

  const successRate = stats && stats.totalRequests > 0
    ? `${((stats.successCount / stats.totalRequests) * 100).toFixed(1)}%`
    : '-'

  return (
    <section className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">统计</h3>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Loading state: first load only */}
      {loading && !stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
      ) : error && !stats ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <AppIcon name="error" size={40} className="mx-auto mb-3 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={handleRetry}>
              <AppIcon name="refresh" data-icon="inline-start" />
              重试
            </Button>
          </div>
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              icon={<AppIcon name="hashtag" />}
              label="总请求"
              value={String(stats.totalRequests)}
            />
            <MetricCard
              icon={<AppIcon name="check_circle" />}
              label="成功请求"
              value={String(stats.successCount)}
            />
            <MetricCard
              icon={<AppIcon name="cancel" />}
              label="失败请求"
              value={String(stats.failedCount)}
            />
            <MetricCard
              icon={<AppIcon name="chat" />}
              label="总 Token"
              value={formatTokens(stats.totalTokens)}
            />
            <MetricCard
              icon={<AppIcon name="schedule" />}
              label="平均延迟"
              value={formatLatency(stats.averageLatency)}
            />
            <MetricCard
              icon={<AppIcon name="dns" />}
              label="成功率"
              value={successRate}
            />
          </div>
        </>
      ) : null}

      {/* Error banner (with existing data) */}
      {error && stats && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-xs text-destructive">{error}</span>
        </div>
      )}
    </section>
  )
}

// ── 活跃请求模块 ──

const RETENTION_CHOICES: readonly { value: number; label: string }[] = [
  { value: 0, label: '请求完成后立即移除' },
  { value: 0.5, label: '30 秒' },
  { value: 1, label: '1 分钟' },
  { value: 2, label: '2 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 30, label: '30 分钟' },
]

function formatRetention(minutes: number): string {
  if (minutes <= 0) return '请求完成后立即移除'
  if (minutes < 1) return `${Math.round(minutes * 60)} 秒`
  if (minutes === 1) return '1 分钟'
  if (Number.isInteger(minutes)) return `${minutes} 分钟`
  return `${minutes} 分钟`
}

function retentionLabel(minutes: number): string {
  if (minutes <= 0) return '请求完成后立即移除'
  return `显示 ${formatRetention(minutes)} 内的活跃请求`
}

function ActiveRequestsSection() {
  const [requests, setRequests] = useState<readonly ActiveRequest[]>([])
  const [config, setConfig] = useState<ActiveRequestConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const mountedRef = useRef(true)
  // Latest-poll-wins: drop stale snapshots so a slow response can't overwrite a fresher one.
  const fetchSeqRef = useRef(0)

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
      setError(err instanceof Error ? err.message : '获取活跃请求失败')
    } finally {
      if (mountedRef.current && seq === fetchSeqRef.current) setLoading(false)
    }
  }, [])

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
        if (active) setConfigError(err instanceof Error ? err.message : '获取保留时间失败')
      })
    return () => { active = false }
  }, [])

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
      toast('已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <AppIcon name="bolt" className="text-muted-foreground" />
        活跃请求
        {requests.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {requests.length}
          </span>
        )}
      </div>

      <DataTable
        id="monitor-requests"
        columns={ACTIVE_REQUEST_COLUMNS}
        data={requests}
        total={requests.length}
        loading={loading}
        error={error}
        offset={0}
        limit={requests.length}
        onOffsetChange={() => {}}
        onRetry={fetchActive}
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
                保留时间未知
              </Button>
            ) : config ? (
              <Button variant="outline" size="sm" onClick={handleOpenDialog} title="设置保留时间">
                <AppIcon name="settings" data-icon="inline-start" />
                {retentionLabel(config.retentionMinutes)}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保留时间设置</DialogTitle>
            <DialogDescription>
              请求结束后，在列表中保留多久
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {RETENTION_CHOICES.map((choice) => (
              <Button
                key={choice.value}
                variant={draft === choice.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDraft(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function MonitorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="活动监视"
        description="实时活动请求与运行统计"
      />
      <div className="flex-1 overflow-auto p-6">
        <StatsSection />
        <ActiveRequestsSection />
      </div>
    </div>
  )
}