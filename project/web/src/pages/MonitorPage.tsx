import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertCircle, Server, Zap, Clock, Hash, MessageSquare, Layers } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { dashboardApi, type RuntimeMetrics } from '@/lib/dashboard-api'

const POLL_INTERVAL_MS = 5000

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
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

export function MonitorPage() {
  const [metrics, setMetrics] = useState<RuntimeMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await dashboardApi.getRuntimeMetrics()
      setMetrics(data)
      setLastRefresh(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取指标失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const timer = setInterval(fetchMetrics, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchMetrics])

  const refreshTime = lastRefresh?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '--'

  // Loading state: first load only
  if (loading && !metrics) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="活动监视" subtitle="Real-time runtime metrics" />
        <div className="flex-1 p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">正在连接...</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
        </div>
      </div>
    )
  }

  // Error state with retry
  if (error && !metrics) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="活动监视" subtitle="Real-time runtime metrics" />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchMetrics}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const m = metrics!
  const successRate = m.requests_total > 0
    ? `${((m.requests_success / m.requests_total) * 100).toFixed(1)}%`
    : '--'

  const modelEntries = Object.entries(m.models).sort(([, a], [, b]) => b - a)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="活动监视"
        subtitle="Real-time runtime metrics"
        status={refreshTime ? `刷新 ${refreshTime}` : undefined}
      />
      <div className="flex-1 overflow-auto p-6">
        {/* Refresh bar */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {error && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle data-icon="inline-start" />
                错误
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              最后刷新：{refreshTime}
            </span>
          </div>
            <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={cn(loading && 'animate-spin')} />
            刷新
          </Button>
        </div>

        {/* Core metrics grid */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            icon={<Server />}
            label="运行时长"
            value={formatUptime(m.uptime_seconds)}
          />
          <MetricCard
            icon={<Zap />}
            label="活跃请求"
            value={String(m.active_requests)}
            sub={`排队 ${m.queued_requests}`}
          />
          <MetricCard
            icon={<Hash />}
            label="总请求"
            value={String(m.requests_total)}
            sub={`成功 ${m.requests_success} · 失败 ${m.requests_failed}`}
          />
          <MetricCard
            icon={<Clock />}
            label="平均延迟"
            value={formatLatency(m.avg_latency_ms)}
            sub={`成功率 ${successRate}`}
          />
          <MetricCard
            icon={<MessageSquare />}
            label="总 Token"
            value={formatTokens(m.total_tokens)}
            sub={`均 ${m.requests_total > 0 ? formatTokens(Math.round(m.total_tokens / m.requests_total)) : '--'} / 请求`}
          />
        </div>

        {/* Per-model breakdown */}
        {modelEntries.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Layers className="text-muted-foreground" />
              按模型
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {modelEntries.map(([model, count]) => (
                <Card key={model} size="sm">
                  <CardContent>
                    <p className="truncate text-sm font-medium">{model}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-2xl font-bold tabular-nums">{count}</span>
                      <span className="text-xs text-muted-foreground">请求</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty model state */}
        {modelEntries.length === 0 && m.requests_total === 0 && (
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">暂无请求数据</p>
            <p className="mt-1 text-xs text-muted-foreground">等待 API 请求到达后将自动更新</p>
          </div>
        )}
      </div>
    </div>
  )
}