import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { PageHeader } from '@/components/wooh/PageHeader'
import { UsageLogDetailDialog } from '@/components/wooh/UsageLogDetailDialog'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/wooh/dialog'
import { DataTable, type ColumnDef } from '@/components/wooh/data-table'
import { toast } from '@/components/ui/toast'
import { sortActiveRequests } from '@/lib/active-requests'
import {
  dashboardApi,
  type UsageLog,
  type ActiveRequest,
  type ActiveRequestConfig,
} from '@/lib/dashboard-api'

const POLL_INTERVAL_MS = 2000
const ELAPSED_TICK_MS = 1000

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}KB`
  return `${n}B`
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
      setRequests(sortActiveRequests(data))
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
              <span className="inline-flex max-w-full items-center gap-1 text-xs text-destructive break-all">
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
        <ActiveRequestsSection />
      </div>
    </div>
  )
}
