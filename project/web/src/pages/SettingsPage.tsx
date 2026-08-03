import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Clock, Activity, BarChart3, RefreshCw, Server } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { RuntimeMetrics } from '@/lib/dashboard-api'
import { GeneralSettings } from './GeneralSettings'

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly metrics: RuntimeMetrics }

export function SettingsPage() {
  const { tab } = useParams<{ tab: string }>()
  const navigate = useNavigate()
  const activeTab = tab === 'general' ? 'general' : 'status'

  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const fetchMetrics = useCallback(() => {
    dashboardApi
      .getRuntimeMetrics()
      .then((metrics) => setState({ kind: 'ready', metrics }))
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : '获取运行指标失败'
        setState({ kind: 'error', message })
      })
  }, [])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  const handleRetryMetrics = () => {
    setState({ kind: 'loading' })
    fetchMetrics()
  }

  const handleTabChange = (value: string) => {
    navigate(`/settings/${value}`)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="系统设置"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="status">运行状态</TabsTrigger>
            <TabsTrigger value="general">通用设置</TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="flex flex-col gap-6">
            {state.kind === 'loading' && <MetricsSkeleton />}

            {state.kind === 'error' && (
              <Card>
                <CardContent className="flex flex-col items-center gap-4 py-12">
                  <p className="text-sm text-destructive">{state.message}</p>
                  <Button variant="outline" size="sm" onClick={handleRetryMetrics}>
                    <RefreshCw data-icon="inline-start" />
                    重试
                  </Button>
                </CardContent>
              </Card>
            )}

            {state.kind === 'ready' && (
              <MetricsCards metrics={state.metrics} onRefresh={fetchMetrics} />
            )}
          </TabsContent>

          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ── Loading skeleton ──

function MetricsSkeleton() {
  return (
    <>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  )
}

// ── Live metrics ──

function MetricsCards({
  metrics,
  onRefresh,
}: {
  readonly metrics: RuntimeMetrics
  readonly onRefresh: () => void
}) {
  const modelEntries = Object.entries(metrics.models).sort(
    ([, a], [, b]) => b - a,
  )

  return (
    <>
      {/* Controls */}
      <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </div>

      {/* Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>服务概览</CardTitle>
          </div>
          <CardDescription>请求量、延迟与系统健康</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <MetricItem
              label="运行时长"
              value={formatUptime(metrics.uptime_seconds)}
              icon={<Clock className="text-muted-foreground" />}
            />
            <MetricItem
              label="总请求"
              value={formatNumber(metrics.requests_total)}
            />
            <MetricItem
              label="成功请求"
              value={formatNumber(metrics.requests_success)}
              valueClass="text-green-600"
            />
            <MetricItem
              label="失败请求"
              value={formatNumber(metrics.requests_failed)}
              valueClass={
                metrics.requests_failed > 0 ? 'text-red-600' : undefined
              }
            />
            <MetricItem
              label="活跃请求"
              value={String(metrics.active_requests)}
            >
              {metrics.active_requests > 0 && (
                <Badge variant="secondary" className="ml-2">
                  运行中
                </Badge>
              )}
            </MetricItem>
            <MetricItem
              label="排队中"
              value={String(metrics.queued_requests)}
            >
              {metrics.queued_requests > 0 && (
                <Badge variant="secondary" className="ml-2">
                  等待中
                </Badge>
              )}
            </MetricItem>
            <MetricItem
              label="平均延迟"
              value={`${metrics.avg_latency_ms} ms`}
            />
            <MetricItem
              label="总 Token 数"
              value={formatNumber(metrics.total_tokens)}
              icon={<BarChart3 className="text-muted-foreground" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-model */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            <CardTitle>模型请求量</CardTitle>
          </div>
          <CardDescription>
            按模型统计请求次数
            {modelEntries.length === 0 && ' —— 暂无数据'}
          </CardDescription>
        </CardHeader>
        {modelEntries.length > 0 && (
          <CardContent>
            <div className="flex flex-col gap-3">
              {modelEntries.map(([model, count]) => {
                const pct =
                  metrics.requests_total > 0
                    ? Math.round((count / metrics.requests_total) * 100)
                    : 0
                return (
                  <div
                    key={model}
                    className="flex items-center gap-3 rounded-md border px-4 py-3"
                  >
                    <Badge
                      variant="outline"
                      className="shrink-0 font-mono text-xs"
                    >
                      {model}
                    </Badge>
                    <div className="flex flex-1 items-center gap-3">
                      <div className="h-2 flex-1 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {formatNumber(count)} 请求
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {pct}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </>
  )
}

function MetricItem({
  label,
  value,
  valueClass,
  icon,
  children,
}: {
  readonly label: string
  readonly value: string
  readonly valueClass?: string
  readonly icon?: React.ReactNode
  readonly children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`flex items-center text-xl font-semibold tabular-nums ${
          valueClass ?? ''
        }`}
      >
        {value}
        {children}
      </div>
    </div>
  )
}
