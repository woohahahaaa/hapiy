import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  dashboardApi,
  DashboardApiError,
  type DisabledRecord,
  type DisabledRecordDimension,
} from '@/lib/dashboard-api'

const RECOVERY_INTERVAL_KEY = 'automatic_disable_recovery_minutes'
const RECOVERY_TTFB_KEY = 'recovery_ttfb_seconds'
const DISABLED_RECORDS_PAGE_SIZE = 50
const ERROR_MESSAGE_MAX = 60

const DIMENSION_LABEL: Record<DisabledRecordDimension, string> = {
  key: 'Key',
  base_url: 'BaseURL',
  provider: '供应商',
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

type RecordsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly records: readonly DisabledRecord[] }

function settingsValue(settings: readonly { key: string; value: string }[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? ''
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : '操作失败，请重试'
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function RecoverySettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [recoveryMinutes, setRecoveryMinutes] = useState('')
  const [recoveryTTFB, setRecoveryTTFB] = useState('')
  const [savingInterval, setSavingInterval] = useState(false)
  const [savingTTFB, setSavingTTFB] = useState(false)
  const [recordsState, setRecordsState] = useState<RecordsState>({ kind: 'loading' })
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [recordsOffset, setRecordsOffset] = useState(0)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setRecoveryMinutes(settingsValue(settings, RECOVERY_INTERVAL_KEY))
        setRecoveryTTFB(settingsValue(settings, RECOVERY_TTFB_KEY))
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : '获取设置失败'
        setState({ kind: 'error', message })
      })
  }, [])

  const loadRecords = useCallback(() => {
    setRecordsState({ kind: 'loading' })
    dashboardApi
      .listDisabledRecords()
      .then((records) => {
        setRecordsState({ kind: 'ready', records })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : '获取待恢复记录失败'
        setRecordsState({ kind: 'error', message })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    load()
  }

  const handleSaveInterval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const minutes = Number(recoveryMinutes)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error('时间间隔必须是非负数字')
      return
    }
    setSavingInterval(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_INTERVAL_KEY, String(minutes))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingInterval(false)
    }
  }

  const handleSaveTTFB = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const seconds = Number(recoveryTTFB)
    if (!Number.isFinite(seconds) || seconds < 0) {
      toast.error('首字超时必须是非负数字')
      return
    }
    setSavingTTFB(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_TTFB_KEY, String(seconds))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingTTFB(false)
    }
  }

  const handleReplay = async (id: string) => {
    setReplayingId(id)
    try {
      const { record, resolved } = await dashboardApi.replayDisabledRecord(id)
      setRecordsState((current) => {
        if (current.kind !== 'ready') return current
        if (resolved || record.resolvedAt !== null) {
          return { kind: 'ready', records: current.records.filter((r) => r.id !== id) }
        }
        return {
          kind: 'ready',
          records: current.records.map((r) => (r.id === id ? record : r)),
        }
      })
      toast(resolved ? '已恢复' : '重放未恢复，可再次尝试')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setReplayingId(null)
    }
  }

  const records = recordsState.kind === 'ready' ? recordsState.records : []
  const recordsCount = records.length
  const recordsLoading = recordsState.kind === 'loading'
  const recordsError = recordsState.kind === 'error' ? recordsState.message : null
  const pagedRecords = useMemo(
    () => records.slice(recordsOffset, recordsOffset + DISABLED_RECORDS_PAGE_SIZE),
    [records, recordsOffset],
  )

  const columns: ColumnDef<DisabledRecord>[] = useMemo(() => [
    {
      key: 'disabledAt',
      label: '时间',
      defaultWidth: { kind: 'pixel', value: 160 },
      isTime: true,
      accessor: (row) => formatDateTime(row.disabledAt),
    },
    {
      key: 'providerId',
      label: '供应商',
      defaultWidth: { kind: 'pixel', value: 160 },
    },
    {
      key: 'dimension',
      label: '维度',
      defaultWidth: { kind: 'pixel', value: 100 },
      accessor: (row) => DIMENSION_LABEL[row.dimension],
    },
    {
      key: 'value',
      label: '值',
      defaultWidth: { kind: 'percent', value: 20 },
      defaultOverflow: 'ellipsis',
    },
    {
      key: 'retryCount',
      label: '重试次数',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
    },
    {
      key: 'errorMessage',
      label: '触发原因',
      defaultWidth: { kind: 'percent', value: 25 },
      defaultOverflow: 'ellipsis',
      accessor: (row) => (row.errorMessage ? truncate(row.errorMessage, ERROR_MESSAGE_MAX) : null),
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 120 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <Button
          variant="outline"
          size="sm"
          disabled={replayingId !== null}
          onClick={() => void handleReplay(row.id)}
        >
          {replayingId === row.id ? (
            <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
          ) : (
            <AppIcon name="refresh" data-icon="inline-start" />
          )}
          重试
        </Button>
      ),
    },
  ], [replayingId])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="refresh" size={16} /> 自动恢复
          </CardTitle>
          <CardDescription>定期检查被禁用的项；上游恢复后自动解除。</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> 正在加载设置…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <AppIcon name="refresh" data-icon="inline-start" /> 重试
              </Button>
            </div>
          )}

          {state.kind === 'ready' && (
            <div className="flex flex-col gap-5">
              <form className="flex flex-col gap-3" onSubmit={handleSaveInterval}>
                <label className="grid gap-1.5 text-sm" htmlFor="automatic-disable-recovery-minutes">
                  自动恢复轮询间隔（分钟）
                  <Input
                    id="automatic-disable-recovery-minutes"
                    className="w-40"
                    type="number"
                    min={0}
                    value={recoveryMinutes}
                    onChange={(event) => setRecoveryMinutes(event.target.value)}
                    disabled={savingInterval}
                    placeholder="1440"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  0 = 关闭；建议 ≥ 60；默认 60。
                </p>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={savingInterval}>
                    {savingInterval && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存
                  </Button>
                </div>
              </form>

              <form className="flex flex-col gap-3" onSubmit={handleSaveTTFB}>
                <label className="grid gap-1.5 text-sm" htmlFor="recovery-ttfb-seconds">
                  限制最低首字速度（秒）
                  <Input
                    id="recovery-ttfb-seconds"
                    className="w-40"
                    type="number"
                    min={0}
                    value={recoveryTTFB}
                    onChange={(event) => setRecoveryTTFB(event.target.value)}
                    disabled={savingTTFB}
                    placeholder="留空"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  留空只判断响应正常；填了则要求首字在 N 秒内。
                </p>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={savingTTFB}>
                    {savingTTFB && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="history" size={16} /> 待恢复记录（{recordsCount} 条）
          </CardTitle>
          <CardDescription>上游仍异常、可手动重放的禁用记录；恢复后会从列表移除。</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            id="recovery-disabled-records"
            columns={columns}
            data={pagedRecords}
            total={recordsCount}
            loading={recordsLoading}
            error={recordsError}
            offset={recordsOffset}
            limit={DISABLED_RECORDS_PAGE_SIZE}
            onOffsetChange={setRecordsOffset}
            emptyText="暂无待恢复记录"
            onRetry={() => void loadRecords()}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadRecords()}
                disabled={recordsLoading}
              >
                {recordsLoading ? (
                  <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
                ) : (
                  <AppIcon name="refresh" data-icon="inline-start" />
                )}
                刷新
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
