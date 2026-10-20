import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
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
} from '@/components/wooh/dialog'
import { DateRangeFilter } from '@/components/wooh/DateRangeFilter'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatCompactNumber } from '@/lib/compact-number'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { dashboardApi, type LogStats, type DateRange } from '@/lib/dashboard-api'

// 缓存命中率展示：不足 100% 的绝不进位成 100.0%，只有完全相等才显示 100.0%。
function cacheHitRateText(rate: number): string {
  if (rate >= 1) return '100.0%'
  return `${Math.min(rate * 100, 99.9).toFixed(1)}%`
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
            <p className="mt-1 text-2xl font-bold tabular-nums break-words">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</p>}
          </div>
          <div className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
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

export function UsageStatsSection() {
  const { t, i18n } = useTranslation('logs')
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'zh-CN'
  // 统计区顶部的时间筛选同样缓存（usePersistedState）：刷新保留，切走本页即清除。
  const [dateRange, setDateRange] = usePersistedState<DateRange>('monitor.stats.dateRange', {})
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
  // 总 Token（缓存命中去重）：把缓存命中部分从总量里去掉，只统计真正消耗的 Token。
  const dedupedTokens = stats ? Math.max(0, stats.totalTokens - stats.cacheHitTokens) : 0
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
        </div>
      </div>

      {/* Loading state: first load only */}
      {loading && !stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 10 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
      ) : error && !stats ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <AppIcon name="error" size={40} className="mx-auto mb-3 text-destructive" />
            <p className="max-w-full break-words text-sm text-muted-foreground">{error}</p>
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
              icon={<AppIcon name="dns" />}
              label={t('monitor.metrics.successRate')}
              value={successRate}
            />
            <MetricCard
              icon={<AppIcon name="chat" />}
              label={t('monitor.metrics.totalTokens')}
              value={formatCompactNumber(stats.totalTokens, locale)}
            />
            <MetricCard
              icon={<AppIcon name="layers" />}
              label={t('monitor.metrics.totalTokensDedup')}
              value={formatCompactNumber(dedupedTokens, locale)}
            />
            <MetricCard
              icon={<AppIcon name="refresh" />}
              label={t('monitor.metrics.cacheHitRate')}
              value={cacheActivity && cacheHitRate > 0 ? cacheHitRateText(cacheHitRate) : '-'}
            />
            <MetricCard
              icon={<AppIcon name="bolt" />}
              label={t('monitor.metrics.throughput')}
              value={throughput > 0 ? `${throughput.toFixed(2)} tokens/s` : '-'}
            />
            <MetricCard
              icon={<AppIcon name="schedule" />}
              label={t('monitor.metrics.averageLatency')}
              value={formatLatency(stats.averageLatency)}
            />
            <MetricCard
              icon={<AppIcon name="sell" />}
              label={t('monitor.metrics.cost')}
              value={`¥${totalCost.toFixed(2)}`}
            />
            {/* 清空用量：固定在最后一行的最右一列并沉底；该列已被卡片占满时
                自动落到下一行的同一列（纯 CSS 网格自动布局，不需要测量）。 */}
            <Button
              variant="destructive"
              size="sm"
              className="[grid-column:-2/-1] self-end justify-self-end"
              onClick={() => setClearOpen(true)}
              title={t('monitor.clear.tooltip')}
            >
              <AppIcon name="delete" data-icon="inline-start" />
              {t('monitor.clear.button')}
            </Button>
          </div>
        </>
      ) : null}

      {/* Error banner (with existing data) */}
      {error && stats && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="break-words text-xs text-destructive">{error}</span>
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
