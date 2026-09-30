import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { FieldGroup } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  dashboardApi,
  DashboardApiError,
  type DisabledRecord,
  type DisabledRecordDimension,
} from '@/lib/dashboard-api'

const RECOVERY_INTERVAL_KEY = 'automatic_disable_recovery_minutes'
const RECOVERY_MODE_KEY = 'recovery_mode'
const RECOVERY_TIMED_MINUTES_KEY = 'recovery_timed_minutes'
const RECOVERY_HANDLER_KEY = 'recovery_request_handler'
const DISABLED_RECORDS_PAGE_SIZE = 50

type RecoveryMode = 'probe' | 'timed'
const RECOVERY_MODES: readonly { value: RecoveryMode; labelKey: string }[] = [
  { value: 'probe', labelKey: 'recovery.modeProbe' },
  { value: 'timed', labelKey: 'recovery.modeTimed' },
]
const DEFAULT_TIMED_MINUTES = 60

// DEFAULT_HANDLER_OPS 是系统兜底的恢复方法，字段路径基于 OpenAI /
// Anthropic 官方 API 文档确认：
// - Chat Completions：系统提示在 messages 里 role==system/developer（无顶层 system）
// - Responses：顶层 instructions
// - Anthropic：顶层 system（string 或数组）
// 对话上下文统一替换叶子字段（content / text），多模态 base64 块直接删除，
// 工具定义（tools）删除。替换叶子字段保留数组骨架，重放时语义损失最小。
const DEFAULT_HANDLER_OPS: readonly RecoveryOp[] = [
  // 对话上下文（三类格式共有的超大字段）
  { path: 'messages.#.content', action: 'replace', value: '你好' },
  { path: 'input.#.content', action: 'replace', value: '你好' },
  { path: 'messages.#.content.#(type=="text").text', action: 'replace', value: '你好' },
  { path: 'input.#.content.#(type=="input_text").text', action: 'replace', value: '你好' },
  // 多模态 base64 大块：直接删除
  { path: 'messages.#.content.#(type=="image_url").image_url.url', action: 'delete', value: '' },
  { path: 'messages.#.content.#(type=="input_audio").input_audio.data', action: 'delete', value: '' },
  { path: 'messages.#.content.#(type=="file").file.file_data', action: 'delete', value: '' },
  { path: 'input.#.content.#(type=="input_image").image_url', action: 'delete', value: '' },
  { path: 'input.#.content.#(type=="input_file").file_data', action: 'delete', value: '' },
  { path: 'messages.#.content.#(type=="image").source.data', action: 'delete', value: '' },
  { path: 'messages.#.content.#(type=="document").source.data', action: 'delete', value: '' },
  // 系统提示（按三种格式的实际位置）
  { path: 'messages.#(role=="system").content', action: 'replace', value: '你好' },
  { path: 'messages.#(role=="developer").content', action: 'replace', value: '你好' },
  { path: 'instructions', action: 'replace', value: '你好' },
  { path: 'system', action: 'replace', value: '你好' },
  { path: 'system.#.text', action: 'replace', value: '你好' },
  // 工具定义（体积集中在 JSON Schema）
  { path: 'tools', action: 'delete', value: '' },
  { path: 'functions', action: 'delete', value: '' },
]
const DEFAULT_TIMEOUT_HOURS = 2

type RecoveryOp = {
  path: string
  action: 'delete' | 'replace'
  value: string
}

type RecoveryRequestHandler = {
  ops: readonly RecoveryOp[]
  timeoutHours: number
}

function emptyOp(): RecoveryOp {
  return { path: '', action: 'replace', value: '你好' }
}

function parseHandler(json: string | undefined): RecoveryRequestHandler {
  if (!json) return { ops: [], timeoutHours: 0 }
  try {
    const parsed = JSON.parse(json) as { ops?: Array<Partial<RecoveryOp>>; timeout_hours?: number }
    const ops = (parsed.ops ?? []).filter(
      (op): op is RecoveryOp =>
        typeof op.path === 'string' &&
        (op.action === 'delete' || op.action === 'replace') &&
        typeof op.value === 'string',
    )
    const timeoutHours =
      typeof parsed.timeout_hours === 'number' && Number.isFinite(parsed.timeout_hours) && parsed.timeout_hours >= 0
        ? parsed.timeout_hours
        : 0
    return { ops, timeoutHours }
  } catch {
    return { ops: [], timeoutHours: 0 }
  }
}

const DIMENSION_LABEL: Record<DisabledRecordDimension, string> = {
  key: 'recovery.dimensionKey',
  base_url: 'recovery.dimensionBaseUrl',
  provider: 'recovery.dimensionProvider',
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
  return err instanceof Error ? err.message : i18n.t('settings:errors.operationFailed')
}

function formatDateTime(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatCountdown(remainingMs: number): string {
	if (remainingMs <= 0) return i18n.t('settings:recovery.overdue')
	const totalSeconds = Math.ceil(remainingMs / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) return i18n.t('settings:recovery.countdownHms', { hours, minutes, seconds })
	if (minutes > 0) return i18n.t('settings:recovery.countdownMs', { minutes, seconds })
	return i18n.t('settings:recovery.countdownS', { seconds })
}

function disabledAtMs(row: DisabledRecord): number {
	return new Date(row.disabledAt).getTime()
}

function isPastDeadline(row: DisabledRecord, durationMs: number): boolean {
	const ts = disabledAtMs(row)
	if (!Number.isFinite(ts)) return false
	return ts + durationMs - Date.now() <= 0
}

export function RecoverySettings() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('probe')
  const [recoveryMinutes, setRecoveryMinutes] = useState('')
  const [recoveryTimedMinutes, setRecoveryTimedMinutes] = useState('')
  // modeDirty: 用户切换过 dropdown；保存前先藏掉下面的表格，避免与
  // 未生效的模式混在一起展示。
  const [modeDirty, setModeDirty] = useState(false)
  const [savingInterval, setSavingInterval] = useState(false)
  const [recordsState, setRecordsState] = useState<RecordsState>({ kind: 'loading' })
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [recordsOffset, setRecordsOffset] = useState(0)
  const [handler, setHandler] = useState<RecoveryRequestHandler>({ ops: [], timeoutHours: 0 })
  const [handlerDialogOpen, setHandlerDialogOpen] = useState(false)
  const [savingHandler, setSavingHandler] = useState(false)
  const [previewRecord, setPreviewRecord] = useState<DisabledRecord | null>(null)
  const [providerNameById, setProviderNameById] = useState<ReadonlyMap<string, string>>(new Map())
  // 一次性快照：哪些记录已超时，按顺序逐个弹窗。
  const [pastDeadlineQueue, setPastDeadlineQueue] = useState<readonly DisabledRecord[] | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const [pastDeadlineDismissed, setPastDeadlineDismissed] = useState(false)
  const [extendedRecordIds, setExtendedRecordIds] = useState<ReadonlySet<string>>(new Set())
  const [, setCountdownTick] = useState(0)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        const modeRaw = settingsValue(settings, RECOVERY_MODE_KEY)
        setRecoveryMode(modeRaw === 'timed' ? 'timed' : 'probe')
        setRecoveryMinutes(settingsValue(settings, RECOVERY_INTERVAL_KEY))
        const timed = settingsValue(settings, RECOVERY_TIMED_MINUTES_KEY)
        setRecoveryTimedMinutes(timed === '' ? String(DEFAULT_TIMED_MINUTES) : timed)
        setHandler(parseHandler(settingsValue(settings, RECOVERY_HANDLER_KEY)))
        setModeDirty(false)
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : i18n.t('settings:errors.fetchSettingsFailed')
        setState({ kind: 'error', message })
      })
  }, [])

  const saveHandler = useCallback(async (next: RecoveryRequestHandler) => {
    setSavingHandler(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_HANDLER_KEY, JSON.stringify(next))
      setHandler(next)
      toast(t('toast.saved'))
      return true
    } catch (err) {
      toast.error(toErrorMessage(err))
      return false
    } finally {
      setSavingHandler(false)
    }
  }, [t])

  const loadRecords = useCallback(() => {
    setRecordsState({ kind: 'loading' })
    dashboardApi
      .listDisabledRecords()
      .then((records) => {
        setRecordsState({ kind: 'ready', records })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : i18n.t('settings:recovery.fetchRecordsFailed')
        setRecordsState({ kind: 'error', message })
      })
    dashboardApi.listProviders({ limit: 1000, offset: 0 }).then(({ providers }) => {
      setProviderNameById(new Map(providers.map((p) => [p.id, p.name])))
    }).catch(() => {
      // 供应商名字映射失败不影响表格主体展示
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    if (recoveryMode !== 'timed') return
    const interval = setInterval(() => setCountdownTick((n) => (n + 1) % 1_000_000), 1000)
    return () => clearInterval(interval)
  }, [recoveryMode])

  // 首次拿到记录时拍快照，弹窗队列只跑一次。
  useEffect(() => {
    if (pastDeadlineQueue !== null) return
    if (recordsState.kind !== 'ready') return
    if (recoveryMode !== 'timed') {
      setPastDeadlineQueue([])
      return
    }
    const timedMinutes = Number(recoveryTimedMinutes)
    if (!Number.isFinite(timedMinutes) || timedMinutes <= 0) {
      setPastDeadlineQueue([])
      return
    }
    const past = recordsState.records.filter((r) => isPastDeadline(r, timedMinutes * 60 * 1000))
    setPastDeadlineQueue(past)
  }, [recordsState, recoveryMode, recoveryTimedMinutes, pastDeadlineQueue])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    load()
  }

  const handleSaveInterval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const minutes = Number(recoveryMinutes)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error(t('recovery.intervalInvalid'))
      return
    }
    const timedMinutes = Number(recoveryTimedMinutes)
    if (!Number.isFinite(timedMinutes) || timedMinutes <= 0) {
      toast.error(t('recovery.timedMinutesInvalid'))
      return
    }
    setSavingInterval(true)
    try {
      await Promise.all([
        dashboardApi.updateSetting(RECOVERY_MODE_KEY, recoveryMode),
        dashboardApi.updateSetting(RECOVERY_INTERVAL_KEY, String(minutes)),
        dashboardApi.updateSetting(RECOVERY_TIMED_MINUTES_KEY, String(timedMinutes)),
      ])
      setModeDirty(false)
      loadRecords()
      toast(t('toast.saved'))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingInterval(false)
    }
  }

  const handleRestoreDirect = async (id: string) => {
    setReplayingId(id)
    try {
      const { resolved } = await dashboardApi.restoreDisabledRecordDirectly(id)
      if (resolved) {
        setRecordsState((current) =>
          current.kind === 'ready'
            ? { kind: 'ready', records: current.records.filter((r) => r.id !== id) }
            : current,
        )
        toast(t('recovery.restoredDirect'))
      }
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setReplayingId(null)
    }
  }

  const currentPastDeadlineRecord =
    !pastDeadlineDismissed &&
    pastDeadlineQueue !== null &&
    queueIndex < pastDeadlineQueue.length
      ? pastDeadlineQueue[queueIndex]
      : null

  const handleImmediateRestore = async () => {
    if (!currentPastDeadlineRecord) return
    const id = currentPastDeadlineRecord.id
    setReplayingId(id)
    setQueueIndex((i) => i + 1)
    try {
      const { resolved } = await dashboardApi.restoreDisabledRecordDirectly(id)
      if (resolved) {
        setRecordsState((current) =>
          current.kind === 'ready'
            ? { kind: 'ready', records: current.records.filter((r) => r.id !== id) }
            : current,
        )
        toast(t('recovery.restoredImmediate'))
      }
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setReplayingId(null)
    }
  }

  const handleExtendOneCycle = async () => {
    if (!currentPastDeadlineRecord) return
    const id = currentPastDeadlineRecord.id
    const minutes = Number(recoveryTimedMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast.error(t('recovery.durationNotSet'))
      return
    }
    setReplayingId(id)
    setQueueIndex((i) => i + 1)
    try {
      const { record: updated, extended } = await dashboardApi.extendDisabledRecordCountdown(id, minutes)
      if (extended) {
        setRecordsState((current) =>
          current.kind === 'ready'
            ? { kind: 'ready', records: current.records.map((r) => (r.id === id ? updated : r)) }
            : current,
        )
        setExtendedRecordIds((prev) => {
          const next = new Set(prev)
          next.add(id)
          return next
        })
        toast(t('recovery.extended', { minutes }))
      }
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

  const columns: ColumnDef<DisabledRecord>[] = useMemo(() => {
    const timedMinutes = Number(recoveryTimedMinutes)
    const isTimed = recoveryMode === 'timed' && Number.isFinite(timedMinutes) && timedMinutes > 0
    const timedMs = isTimed ? timedMinutes * 60 * 1000 : 0
    return [
      {
        key: 'disabledAt',
        label: t('recovery.colTime'),
        defaultWidth: { kind: 'pixel', value: 160 },
        isTime: true,
        accessor: (row) => formatDateTime(row.disabledAt),
      },
      {
        key: 'providerId',
        label: t('recovery.provider'),
        defaultWidth: { kind: 'pixel', value: 160 },
        accessor: (row) => providerNameById.get(row.providerId) ?? row.providerId,
      },
      {
        key: 'dimension',
        label: t('recovery.colDimension'),
        defaultWidth: { kind: 'pixel', value: 100 },
        accessor: (row) => t(DIMENSION_LABEL[row.dimension]),
      },
      {
        key: 'value',
        label: t('recovery.colValue'),
        defaultWidth: { kind: 'percent', value: 20 },
        defaultOverflow: 'ellipsis',
        accessor: (row) => {
          // provider 维度的 value 就是 provider ID 本身，直接显示名字即可
          if (row.dimension === 'provider') {
            return providerNameById.get(row.value) ?? null
          }
          return row.value
        },
      },
      {
        key: 'ruleName',
        label: t('recovery.colRule'),
        defaultWidth: { kind: 'pixel', value: 140 },
        defaultOverflow: 'ellipsis',
        // 规则被删除后仍显示快照名字；老记录没有规则时显示占位。
        accessor: (row) => row.ruleName || (row.ruleId ? row.ruleId : '—'),
      },
      isTimed
        ? {
            key: 'countdown',
            label: t('recovery.colCountdown'),
            defaultWidth: { kind: 'pixel', value: 140 },
            defaultAlign: 'right',
            accessor: (row) => {
              const disabledAt = disabledAtMs(row)
              if (!Number.isFinite(disabledAt)) return '-'
              const text = formatCountdown(disabledAt + timedMs - Date.now())
              return extendedRecordIds.has(row.id) ? t('recovery.extendedSuffix', { text }) : text
            },
          }
        : {
            key: 'retryCount',
            label: t('recovery.colRetryCount'),
            defaultWidth: { kind: 'pixel', value: 100 },
            defaultAlign: 'right',
          },
      {
        key: 'actions',
        label: t('table.actions'),
        defaultWidth: { kind: 'pixel', value: 200 },
        defaultAlign: 'right',
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <div className="inline-flex items-center gap-2">
            {!isTimed && (
              <Button
                variant="outline"
                size="sm"
                disabled={replayingId !== null}
                onClick={() => setPreviewRecord(row)}
              >
                {t('recovery.testUpstream')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={replayingId !== null}
              onClick={() => void handleRestoreDirect(row.id)}
            >
              {t('recovery.restoreDirect')}
            </Button>
          </div>
        ),
      },
    ]
  }, [replayingId, providerNameById, recoveryMode, recoveryTimedMinutes, extendedRecordIds, handleRestoreDirect, t])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="refresh" size={16} /> {t('recovery.cardTitle')}
          </CardTitle>
          <CardDescription>{t('recovery.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('loading')}
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
              </Button>
            </div>
          )}

          {state.kind === 'ready' && (
            <form className="flex flex-col gap-4" onSubmit={handleSaveInterval}>
              <div className="flex flex-wrap items-end gap-4">
                <label className="grid gap-1.5 text-sm">
                  {t('recovery.modeLabel')}
                  <Select
                    value={recoveryMode}
                    onValueChange={(next) => {
                      const nextMode = next as RecoveryMode
                      if (nextMode !== recoveryMode) {
                        setRecoveryMode(nextMode)
                        setModeDirty(true)
                      }
                    }}
                    disabled={savingInterval}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {RECOVERY_MODES.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                {recoveryMode === 'probe' ? (
                  <label className="grid gap-1.5 text-sm" htmlFor="automatic-disable-recovery-minutes">
                    {t('recovery.intervalLabel')}
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
                ) : (
                  <label className="grid gap-1.5 text-sm" htmlFor="recovery-timed-minutes">
                    {t('recovery.timedMinutesLabel')}
                    <Input
                      id="recovery-timed-minutes"
                      className="w-40"
                      type="number"
                      min={1}
                      value={recoveryTimedMinutes}
                      onChange={(event) => setRecoveryTimedMinutes(event.target.value)}
                      disabled={savingInterval}
                      placeholder={String(DEFAULT_TIMED_MINUTES)}
                    />
                  </label>
                )}
                <Button type="submit" disabled={savingInterval}>
                  {savingInterval && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  {t('common:action.save')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {recoveryMode === 'probe'
                  ? t('recovery.probeHint')
                  : t('recovery.timedHint')}
              </p>
            </form>
          )}
        </CardContent>
      </Card>

      {!modeDirty && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="history" size={16} /> {t('recovery.recordsTitle', { count: recordsCount })}
          </CardTitle>
          <CardDescription>{t('recovery.recordsDescription')}</CardDescription>
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
            emptyText={t('recovery.recordsEmpty')}
            onRetry={() => void loadRecords()}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHandlerDialogOpen(true)}
                  title={t('recovery.handlerButtonTitle')}
                >
                  <AppIcon name="settings" data-icon="inline-start" />
                  {t('recovery.handlerButton')}
                  {handler.ops.length > 0 && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[11px] leading-4 text-primary">
                      {handler.ops.length}
                    </span>
                  )}
                </Button>
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
                  {t('common:action.refresh')}
                </Button>
              </>
            }
          />

          <RecoveryHandlerDialog
            open={handlerDialogOpen}
            onOpenChange={setHandlerDialogOpen}
            handler={handler}
            saving={savingHandler}
            onSave={saveHandler}
          />
          <RequestPreviewDialog
            record={previewRecord}
            onClose={() => setPreviewRecord(null)}
            onResolved={(id) => {
              setRecordsState((current) =>
                current.kind === 'ready'
                  ? { kind: 'ready', records: current.records.filter((r) => r.id !== id) }
                  : current,
              )
            }}
          />
          <PastDeadlineDialog
            record={currentPastDeadlineRecord}
            remaining={(() => {
              if (!currentPastDeadlineRecord) return 0
              const timedMs = (Number(recoveryTimedMinutes) || 0) * 60 * 1000
              const ts = disabledAtMs(currentPastDeadlineRecord)
              return Number.isFinite(ts) ? ts + timedMs - Date.now() : 0
            })()}
            busy={replayingId !== null}
            onCancel={() => setPastDeadlineDismissed(true)}
            onSkip={() => setQueueIndex((i) => i + 1)}
            onImmediate={() => void handleImmediateRestore()}
            onExtend={() => void handleExtendOneCycle()}
          />
        </CardContent>
      </Card>
      )}
    </div>
  )
}

function PastDeadlineDialog({
  record,
  remaining,
  busy,
  onCancel,
  onSkip,
  onImmediate,
  onExtend,
}: {
  record: DisabledRecord | null
  remaining: number
  busy: boolean
  onCancel: () => void
  onSkip: () => void
  onImmediate: () => void
  onExtend: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <Dialog open={record !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>{t('recovery.pastDeadlineTitle')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {t('recovery.cancelAll')}
            </Button>
            <Button variant="outline" onClick={onSkip} disabled={busy}>
              {t('recovery.skipOne')}
            </Button>
            <Button variant="outline" onClick={onExtend} disabled={busy}>
              {busy && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              {t('recovery.extendOneCycle')}
            </Button>
            <Button onClick={onImmediate} disabled={busy}>
              {busy && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              {t('recovery.restoreImmediate')}
            </Button>
          </>
        }>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              {t('recovery.pastDeadlineLead')}
              {remaining < 0 && (
                <>
                  {t('recovery.pastDeadlineOverduePrefix')}
                  <span className="mx-1 font-medium text-foreground">{formatCountdown(-remaining)}</span>
                  {t('recovery.pastDeadlineOverdueSuffix')}
                </>
              )}
              {t('recovery.pastDeadlineTail')}
            </p>
          </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}

function RecoveryHandlerDialog({
  open,
  onOpenChange,
  handler,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  handler: RecoveryRequestHandler
  saving: boolean
  onSave: (next: RecoveryRequestHandler) => Promise<boolean>
}) {
  const { t } = useTranslation('settings')
  const [draft, setDraft] = useState<RecoveryRequestHandler>(handler)

  useEffect(() => {
    if (open) setDraft(handler)
  }, [open, handler])

  const handleSave = async () => {
    const cleaned: RecoveryRequestHandler = {
      ops: draft.ops
        .filter((op) => op.path.trim() !== '')
        .map((op) => ({ ...op, path: op.path.trim() })),
      timeoutHours: draft.timeoutHours,
    }
    const ok = await onSave(cleaned)
    if (ok) onOpenChange(false)
  }

  const updateOp = (i: number, next: RecoveryOp) => {
    setDraft((p) => ({ ...p, ops: p.ops.map((op, oi) => (oi === i ? next : op)) }))
  }
  const removeOp = (i: number) => {
    setDraft((p) => ({ ...p, ops: p.ops.filter((_, oi) => oi !== i) }))
  }
  const addOp = () => {
    setDraft((p) => ({ ...p, ops: [...p.ops, emptyOp()] }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>{t('recovery.handlerButton')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? t('savingEllipsis') : t('common:action.save')}
            </Button>
          </>
        }>
          <FieldGroup>
            <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {t('recovery.handlerDescription')}
            </p>
            {draft.ops.length === 0 ? (
              <div className="rounded-xs border border-dashed border-border-subtle px-3 py-6 text-center text-xs text-muted-foreground">
                {t('recovery.noRules')}
              </div>
            ) : (
              draft.ops.map((op, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xs border border-border-subtle bg-background px-2 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="mr-2 inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <Input
                        className="h-7 min-w-0 flex-1 font-mono text-xs"
                        value={op.path}
                        onChange={(e) => updateOp(i, { ...op, path: e.target.value })}
                        placeholder={t('recovery.pathPlaceholder')}
                      />
                      <Select
                        value={op.action}
                        onValueChange={(v) => updateOp(i, { ...op, action: v as 'delete' | 'replace' })}
                      >
                        <SelectTrigger className="h-7 w-[88px] shrink-0" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="replace">{t('recovery.opReplace')}</SelectItem>
                            <SelectItem value="delete">{t('common:action.delete')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    {op.action === 'replace' && (
                      <div className="flex items-center gap-2 pl-[24px]">
                        <span className="shrink-0 text-xs text-muted-foreground/60">{t('recovery.replaceWith')}</span>
                        <Input
                          className="h-7 min-w-0 flex-1 font-mono text-xs"
                          value={op.value}
                          onChange={(e) => updateOp(i, { ...op, value: e.target.value })}
                          placeholder={t('recovery.valuePlaceholder')}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOp(i)}
                    className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('recovery.removeRuleAria', { index: i + 1 })}
                  >
                    <AppIcon name="close" size={14} />
                  </button>
                </div>
              ))
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOp}
              >
                <AppIcon name="add" data-icon="inline-start" /> {t('recovery.addRule')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft({ ops: [...DEFAULT_HANDLER_OPS], timeoutHours: DEFAULT_TIMEOUT_HOURS })}
              >
                <AppIcon name="refresh" data-icon="inline-start" />
                {t('restoreDefaults')}
              </Button>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
              <label className="grid gap-1.5 text-sm">
                {t('recovery.timeoutHoursLabel')}
                <Input
                  className="w-40"
                  type="number"
                  min={0}
                  value={draft.timeoutHours === 0 ? '' : String(draft.timeoutHours)}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setDraft((p) => ({ ...p, timeoutHours: Number.isFinite(v) && v >= 0 ? v : 0 }))
                  }}
                  placeholder={t('recovery.timeoutHoursPlaceholder')}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {t('recovery.timeoutHoursHint')}
              </p>
            </div>
          </div>
        </FieldGroup>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function RequestPreviewDialog({
  record,
  onClose,
  onResolved,
}: {
  record: DisabledRecord | null
  onClose: () => void
  onResolved: (id: string) => void
}) {
  const { t } = useTranslation('settings')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' } | { kind: 'error'; message: string } | null>(null)

  const handleTest = async () => {
    if (!record || testing) return
    setTesting(true)
    setResult(null)
    try {
      const { record: updated, resolved } = await dashboardApi.replayDisabledRecord(record.id)
      if (resolved) {
        setResult({ kind: 'success' })
        onResolved(record.id)
      } else {
        setResult({ kind: 'error', message: updated.errorMessage || t('recovery.upstreamNotPassed') })
      }
    } catch (err) {
      setResult({ kind: 'error', message: toErrorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  const errorMessage = record?.errorMessage

  return (
    <Dialog open={record !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent width="md" scrollFooter>
        <DialogHeader>
          <DialogTitle>{t('recovery.testUpstream')}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t('common:action.close')}
            </Button>
          </>
        }>
        {record && (
          <div className="flex flex-col gap-3 text-xs">
            {errorMessage && !result && (
              <div className="rounded-xs border border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-1 font-medium text-destructive">{t('recovery.triggerReason')}</div>
                <div className="whitespace-pre-wrap break-words text-destructive/90">{errorMessage}</div>
              </div>
            )}
            {result?.kind === 'success' && (
              <div className="rounded-xs border border-success/30 bg-success/5 p-3 font-medium text-success">
                {t('recovery.testPassed')}
              </div>
            )}
            {result?.kind === 'error' && (
              <div className="rounded-xs border border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-1 font-medium text-destructive">{t('recovery.upstreamError')}</div>
                <div className="whitespace-pre-wrap break-words text-destructive/90">{result.message}</div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={testing}
                onClick={() => void handleTest()}
              >
                {testing && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                {t('recovery.startTest')}
              </Button>
              {testing && <span className="text-muted-foreground">{t('recovery.testing')}</span>}
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t('recovery.requestHeaders')}</div>
              <pre className="max-h-48 overflow-auto rounded-xs border border-border-subtle bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                {record.requestHeaders ? formatJson(record.requestHeaders) : '-'}
              </pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">{t('recovery.requestBodyPreview')}</div>
              <pre className="max-h-96 overflow-auto rounded-xs border border-border-subtle bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                {record.requestBody ? formatJson(record.requestBody) : '-'}
              </pre>
            </div>
          </div>
        )}
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}
