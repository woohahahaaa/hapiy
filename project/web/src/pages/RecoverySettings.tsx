import { useEffect, useState, useCallback, useMemo } from 'react'
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
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  dashboardApi,
  DashboardApiError,
  type DisabledRecord,
  type DisabledRecordDimension,
} from '@/lib/dashboard-api'

const RECOVERY_INTERVAL_KEY = 'automatic_disable_recovery_minutes'
const RECOVERY_TTFB_KEY = 'recovery_ttfb_seconds'
const RECOVERY_MODE_KEY = 'recovery_mode'
const RECOVERY_TIMED_MINUTES_KEY = 'recovery_timed_minutes'
const RECOVERY_HANDLER_KEY = 'recovery_request_handler'
const DISABLED_RECORDS_PAGE_SIZE = 50

type RecoveryMode = 'probe' | 'timed'
const RECOVERY_MODES: readonly { value: RecoveryMode; label: string }[] = [
  { value: 'probe', label: '测试上游恢复' },
  { value: 'timed', label: '定时恢复' },
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

function formatCountdown(remainingMs: number): string {
	if (remainingMs <= 0) return '已超时'
	const totalSeconds = Math.ceil(remainingMs / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
	if (minutes > 0) return `${minutes}分${seconds}秒`
	return `${seconds}秒`
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
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('probe')
  const [recoveryMinutes, setRecoveryMinutes] = useState('')
  const [recoveryTTFB, setRecoveryTTFB] = useState('')
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
        setRecoveryTTFB(settingsValue(settings, RECOVERY_TTFB_KEY))
        const timed = settingsValue(settings, RECOVERY_TIMED_MINUTES_KEY)
        setRecoveryTimedMinutes(timed === '' ? String(DEFAULT_TIMED_MINUTES) : timed)
        setHandler(parseHandler(settingsValue(settings, RECOVERY_HANDLER_KEY)))
        setModeDirty(false)
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : '获取设置失败'
        setState({ kind: 'error', message })
      })
  }, [])

  const saveHandler = useCallback(async (next: RecoveryRequestHandler) => {
    setSavingHandler(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_HANDLER_KEY, JSON.stringify(next))
      setHandler(next)
      toast('已保存')
      return true
    } catch (err) {
      toast.error(toErrorMessage(err))
      return false
    } finally {
      setSavingHandler(false)
    }
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
    const seconds = recoveryTTFB.trim() === '' ? null : Number(recoveryTTFB)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error('时间间隔必须是非负数字')
      return
    }
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) {
      toast.error('首字超时必须是非负数字')
      return
    }
    const timedMinutes = Number(recoveryTimedMinutes)
    if (!Number.isFinite(timedMinutes) || timedMinutes <= 0) {
      toast.error('定时恢复时长必须是正数')
      return
    }
    setSavingInterval(true)
    try {
      await Promise.all([
        dashboardApi.updateSetting(RECOVERY_MODE_KEY, recoveryMode),
        dashboardApi.updateSetting(RECOVERY_INTERVAL_KEY, String(minutes)),
        dashboardApi.updateSetting(RECOVERY_TTFB_KEY, seconds === null ? '' : String(seconds)),
        dashboardApi.updateSetting(RECOVERY_TIMED_MINUTES_KEY, String(timedMinutes)),
      ])
      setModeDirty(false)
      loadRecords()
      toast('已保存')
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
        toast('已直接恢复')
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
        toast('已立即恢复')
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
      toast.error('恢复时长未设置')
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
        toast(`已延后 ${minutes} 分钟`)
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
        label: '时间',
        defaultWidth: { kind: 'pixel', value: 160 },
        isTime: true,
        accessor: (row) => formatDateTime(row.disabledAt),
      },
      {
        key: 'providerId',
        label: '供应商',
        defaultWidth: { kind: 'pixel', value: 160 },
        accessor: (row) => providerNameById.get(row.providerId) ?? row.providerId,
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
        accessor: (row) => {
          // provider 维度的 value 就是 provider ID 本身，直接显示名字即可
          if (row.dimension === 'provider') {
            return providerNameById.get(row.value) ?? null
          }
          return row.value
        },
      },
      isTimed
        ? {
            key: 'countdown',
            label: '剩余倒计时',
            defaultWidth: { kind: 'pixel', value: 140 },
            defaultAlign: 'right',
            accessor: (row) => {
              const disabledAt = disabledAtMs(row)
              if (!Number.isFinite(disabledAt)) return '-'
              const text = formatCountdown(disabledAt + timedMs - Date.now())
              return extendedRecordIds.has(row.id) ? `${text}（延长）` : text
            },
          }
        : {
            key: 'retryCount',
            label: '测试上游次数',
            defaultWidth: { kind: 'pixel', value: 100 },
            defaultAlign: 'right',
          },
      {
        key: 'actions',
        label: '操作',
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
                测试上游
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={replayingId !== null}
              onClick={() => void handleRestoreDirect(row.id)}
            >
              直接恢复
            </Button>
          </div>
        ),
      },
    ]
  }, [replayingId, providerNameById, recoveryMode, recoveryTimedMinutes, extendedRecordIds, handleRestoreDirect])

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
            <form className="flex flex-col gap-4" onSubmit={handleSaveInterval}>
              <div className="flex flex-wrap items-end gap-4">
                <label className="grid gap-1.5 text-sm">
                  恢复模式
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
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                {recoveryMode === 'probe' ? (
                  <>
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
                    <label className="grid gap-1.5 text-sm" htmlFor="recovery-ttfb-seconds">
                      限制最低首字速度（秒）
                      <Input
                        id="recovery-ttfb-seconds"
                        className="w-40"
                        type="number"
                        min={0}
                        value={recoveryTTFB}
                        onChange={(event) => setRecoveryTTFB(event.target.value)}
                        disabled={savingInterval}
                        placeholder="留空"
                      />
                    </label>
                  </>
                ) : (
                  <label className="grid gap-1.5 text-sm" htmlFor="recovery-timed-minutes">
                    自动恢复时长（分钟）
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
                  保存
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {recoveryMode === 'probe'
                  ? '轮询间隔：0 = 关闭；建议 ≥ 60；默认 60。首字限时：留空只判断响应正常；填了则要求首字在 N 秒内。'
                  : '禁用后倒计时归零自动恢复；倒计时从禁用瞬间开始算，切换到此模式后立刻按保存时刻起算。'}
              </p>
            </form>
          )}
        </CardContent>
      </Card>

      {!modeDirty && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="history" size={16} /> 待恢复记录（{recordsCount} 条）
          </CardTitle>
          <CardDescription>上游仍异常、可手动测试上游的禁用记录；恢复后会从列表移除。</CardDescription>
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
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHandlerDialogOpen(true)}
                  title="被禁用的瞬间保存请求，按 JSON 处理方法简化后再存储"
                >
                  <AppIcon name="settings" data-icon="inline-start" />
                  测试方法
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
                  刷新
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
  return (
    <Dialog open={record !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>自动恢复已超时</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              全部取消
            </Button>
            <Button variant="outline" onClick={onSkip} disabled={busy}>
              跳过这条
            </Button>
            <Button variant="outline" onClick={onExtend} disabled={busy}>
              {busy && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              下个周期再恢复
            </Button>
            <Button onClick={onImmediate} disabled={busy}>
              {busy && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              立即恢复
            </Button>
          </>
        }>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              该条禁用记录的自动恢复已超过设定的恢复时长
              {remaining < 0 && (
                <>
                  （已超时
                  <span className="mx-1 font-medium text-foreground">{formatCountdown(-remaining)}</span>
                  ）
                </>
              )}
              。可立即解除，或为它再延后恢复时长，等下个周期再判断。
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
          <DialogTitle>测试方法</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </>
        }>
          <FieldGroup>
            <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              禁用瞬间保存请求，按下列 JSON 规则简化；字段不存在时自动跳过。
            </p>
            {draft.ops.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                暂无规则，点击「添加规则」开始配置
              </div>
            ) : (
              draft.ops.map((op, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="mr-2 inline-block w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <Input
                        className="h-7 min-w-0 flex-1 font-mono text-xs"
                        value={op.path}
                        onChange={(e) => updateOp(i, { ...op, path: e.target.value })}
                        placeholder="gjson 路径，如 messages.0.content"
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
                            <SelectItem value="replace">替换</SelectItem>
                            <SelectItem value="delete">删除</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    {op.action === 'replace' && (
                      <div className="flex items-center gap-2 pl-[24px]">
                        <span className="shrink-0 text-xs text-muted-foreground/60">替换为</span>
                        <Input
                          className="h-7 min-w-0 flex-1 font-mono text-xs"
                          value={op.value}
                          onChange={(e) => updateOp(i, { ...op, value: e.target.value })}
                          placeholder="你好"
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOp(i)}
                    className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`删除规则 ${i + 1}`}
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
                <AppIcon name="add" data-icon="inline-start" /> 添加规则
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft({ ops: [...DEFAULT_HANDLER_OPS], timeoutHours: DEFAULT_TIMEOUT_HOURS })}
              >
                <AppIcon name="refresh" data-icon="inline-start" />
                恢复默认
              </Button>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <label className="grid gap-1.5 text-sm">
                缺失请求体的记录，超时自动恢复（小时）
                <Input
                  className="w-40"
                  type="number"
                  min={0}
                  value={draft.timeoutHours === 0 ? '' : String(draft.timeoutHours)}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setDraft((p) => ({ ...p, timeoutHours: Number.isFinite(v) && v >= 0 ? v : 0 }))
                  }}
                  placeholder="0 = 立即测试上游"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                查漏补缺等无请求体的记录，会在禁用满该时长后自动尝试恢复；0 表示不等待。
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
        setResult({ kind: 'error', message: updated.errorMessage || '上游未通过' })
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
          <DialogTitle>测试上游</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </>
        }>
        {record && (
          <div className="flex flex-col gap-3 text-xs">
            {errorMessage && !result && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-1 font-medium text-destructive">触发原因</div>
                <div className="whitespace-pre-wrap break-words text-destructive/90">{errorMessage}</div>
              </div>
            )}
            {result?.kind === 'success' && (
              <div className="rounded-md border border-success/30 bg-success/5 p-3 font-medium text-success">
                上游测试通过，已恢复
              </div>
            )}
            {result?.kind === 'error' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-1 font-medium text-destructive">上游报错</div>
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
                开始测试
              </Button>
              {testing && <span className="text-muted-foreground">正在测试…</span>}
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">请求头</div>
              <pre className="max-h-48 overflow-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                {record.requestHeaders ? formatJson(record.requestHeaders) : '-'}
              </pre>
            </div>
            <div>
              <div className="mb-1 font-medium text-muted-foreground">请求体预览</div>
              <pre className="max-h-96 overflow-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
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
