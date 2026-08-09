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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  dashboardApi,
  type LogStats,
  type ActiveRequest,
  type ActiveRequestConfig,
  type StatsRange,
} from '@/lib/dashboard-api'

const POLL_INTERVAL_MS = 2000
const ELAPSED_TICK_MS = 1000

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatElapsed(ms: number): string {
  if (ms >= 60000) {
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${m}m ${s}s`
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms)}ms`
}

const ACTIVE_REQUEST_COLUMNS: ColumnDef<ActiveRequest>[] = [
  {
    key: 'status',
    label: '状态',
    render: (_, row) => (row.endTime ? '已结束' : '活跃中'),
  },
  { key: 'model', label: '模型' },
  { key: 'tokenName', label: '令牌' },
  { key: 'userId', label: '用户' },
  { key: 'stream', label: '类型', render: (v) => (v ? 'SSE' : '--') },
  {
    key: 'elapsedMs',
    label: '耗时',
    render: (v) => formatElapsed(v as number),
  },
  { key: 'startTime', label: '开始时间', isTime: true },
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

const RANGE_OPTIONS: readonly { value: StatsRange; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '30d', label: '30天' },
  { value: '7d', label: '7天' },
  { value: '1d', label: '24小时' },
]

function StatsSection() {
  const [range, setRange] = useState<StatsRange>('all')
  const [stats, setStats] = useState<LogStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchStats = useCallback(async (r: StatsRange) => {
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
    void fetchStats(range)
  }, [range, fetchStats])

  const handleRetry = useCallback(() => {
    void fetchStats(range)
  }, [range, fetchStats])

  const successRate = stats && stats.totalRequests > 0
    ? `${((stats.successCount / stats.totalRequests) * 100).toFixed(1)}%`
    : '--'

  const modelEntries = stats
    ? [...stats.models].sort((a, b) => b.count - a.count)
    : []
  const maxModelCount = modelEntries.length > 0 ? modelEntries[0].count : 0

  return (
    <section className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">统计</h3>
        <Select value={range} onValueChange={(value) => setRange((value ?? 'all') as StatsRange)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="时间范围" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
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

          {/* Per-model breakdown */}
          {modelEntries.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <AppIcon name="layers" className="text-muted-foreground" />
                按模型
              </h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {modelEntries.map((m) => {
                  const barPercent = maxModelCount > 0 ? (m.count / maxModelCount) * 100 : 0
                  const sharePct = stats.totalRequests > 0 ? (m.count / stats.totalRequests) * 100 : 0
                  return (
                    <Card key={m.model} size="sm">
                      <CardContent>
                        <p className="truncate text-sm font-medium">{m.model}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-2xl font-bold tabular-nums">{m.count}</span>
                          <span className="text-xs text-muted-foreground">
                            {sharePct.toFixed(1)}% · {formatTokens(m.tokens)} tok
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${barPercent}%` }}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty model state */}
          {modelEntries.length === 0 && stats.totalRequests === 0 && (
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">暂无请求数据</p>
            </div>
          )}
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
  { value: 0, label: '立即移除' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 30, label: '30 分钟' },
]

function retentionLabel(minutes: number): string {
  if (minutes <= 0) return '立即移除'
  return `保留 ${minutes} 分钟`
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

  const fetchActive = useCallback(async () => {
    try {
      const data = await dashboardApi.getActiveRequests()
      if (!mountedRef.current) return
      setRequests(data)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '获取活跃请求失败')
    } finally {
      if (mountedRef.current) setLoading(false)
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
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <AppIcon name="bolt" className="text-muted-foreground" />
          活跃请求
          {requests.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {requests.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {error && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <AppIcon name="error" data-icon="inline-start" />
              {error}
            </span>
          )}
          {configError ? (
            <span className="text-xs text-destructive" title={configError}>保留时间未知</span>
          ) : config ? (
            <span className="text-xs text-muted-foreground">{retentionLabel(config.retentionMinutes)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )}
          <Button variant="outline" size="sm" onClick={handleOpenDialog}>
            <AppIcon name="settings" data-icon="inline-start" />
            设置
          </Button>
        </div>
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
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保留时间设置</DialogTitle>
            <DialogDescription>
              请求结束后，在列表中保留多久
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
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
      <PageHeader title="活动监视" />
      <div className="flex-1 overflow-auto p-6">
        <StatsSection />
        <ActiveRequestsSection />
      </div>
    </div>
  )
}