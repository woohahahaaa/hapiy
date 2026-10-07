import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { DataTable, type ColumnDef } from '@/components/data-table'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'
import {
  dashboardApi,
  DashboardApiError,
  type BackupModule,
  type BackupRecord,
} from '@/lib/dashboard-api'

const BACKUP_MODULES_KEY = 'backup_modules'
const BACKUP_FREQUENCY_KEY = 'backup_frequency'
const BACKUP_PATH_KEY = 'backup_path'
const DEFAULT_BACKUP_PATH = 'backups'
const BACKUP_PAGE_SIZE = 10

type BackupFrequency = 'never' | 'daily' | 'weekly'

// UI 侧模块清单：顺序、文案与默认勾选。
const BACKUP_MODULES: readonly {
  readonly id: BackupModule
  readonly labelKey: string
  readonly hintKey: string
  readonly defaultChecked: boolean
}[] = [
  { id: 'topology', labelKey: 'backup.moduleTopology', hintKey: 'backup.moduleTopologyHint', defaultChecked: true },
  { id: 'providers', labelKey: 'backup.moduleProviders', hintKey: 'backup.moduleProvidersHint', defaultChecked: true },
  { id: 'tokens', labelKey: 'backup.moduleTokens', hintKey: 'backup.moduleTokensHint', defaultChecked: true },
  { id: 'policy', labelKey: 'backup.modulePolicy', hintKey: 'backup.modulePolicyHint', defaultChecked: true },
  { id: 'agent', labelKey: 'backup.moduleAgent', hintKey: 'backup.moduleAgentHint', defaultChecked: true },
  { id: 'settings', labelKey: 'backup.moduleSettings', hintKey: 'backup.moduleSettingsHint', defaultChecked: true },
  { id: 'usage', labelKey: 'backup.moduleUsage', hintKey: 'backup.moduleUsageHint', defaultChecked: false },
  { id: 'logs', labelKey: 'backup.moduleLogs', hintKey: 'backup.moduleLogsHint', defaultChecked: false },
]

const DEFAULT_SELECTED_MODULES: readonly BackupModule[] = BACKUP_MODULES.filter(
  (module) => module.defaultChecked,
).map((module) => module.id)

const MODULE_LABEL: Record<BackupModule, string> = Object.fromEntries(
  BACKUP_MODULES.map((module) => [module.id, module.labelKey]),
) as Record<BackupModule, string>

const FREQUENCIES: readonly BackupFrequency[] = ['never', 'daily', 'weekly']

const FREQUENCY_LABEL: Record<BackupFrequency, string> = {
  never: 'backup.frequencyNever',
  daily: 'backup.frequencyDaily',
  weekly: 'backup.frequencyWeekly',
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

type RecordsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly records: readonly BackupRecord[]; readonly total: number }

function settingsValue(settings: readonly { key: string; value: string }[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? ''
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : i18n.t('settings:errors.operationFailed')
}

function parseBackupModules(raw: string): ReadonlySet<BackupModule> {
  if (raw.trim() === '') return new Set(DEFAULT_SELECTED_MODULES)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set(DEFAULT_SELECTED_MODULES)
    const known = new Set<string>(BACKUP_MODULES.map((module) => module.id))
    const selected = parsed.filter((id): id is BackupModule => typeof id === 'string' && known.has(id))
    return selected.length > 0 ? new Set(selected) : new Set(DEFAULT_SELECTED_MODULES)
  } catch {
    return new Set(DEFAULT_SELECTED_MODULES)
  }
}

function parseBackupFrequency(raw: string): BackupFrequency {
  return FREQUENCIES.includes(raw as BackupFrequency) ? (raw as BackupFrequency) : 'weekly'
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function BackupSettingsPage() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [recordsState, setRecordsState] = useState<RecordsState>({ kind: 'loading' })
  const [selectedModules, setSelectedModules] = useState<ReadonlySet<BackupModule>>(
    () => new Set(DEFAULT_SELECTED_MODULES),
  )
  const [frequency, setFrequency] = useState<BackupFrequency>('weekly')
  const [path, setPath] = useState(DEFAULT_BACKUP_PATH)
  const [resolvedPath, setResolvedPath] = useState('')
  const [offset, setOffset] = useState(0)
  const [saving, setSaving] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null)

  const orderedModules = useMemo(
    () => BACKUP_MODULES.filter((module) => selectedModules.has(module.id)).map((module) => module.id),
    [selectedModules],
  )

  const loadSettings = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setSelectedModules(parseBackupModules(settingsValue(settings, BACKUP_MODULES_KEY)))
        setFrequency(parseBackupFrequency(settingsValue(settings, BACKUP_FREQUENCY_KEY)))
        setPath(settingsValue(settings, BACKUP_PATH_KEY) || DEFAULT_BACKUP_PATH)
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        setState({ kind: 'error', message: toErrorMessage(err) })
      })
  }, [])

  const loadRecords = useCallback((nextOffset: number) => {
    dashboardApi
      .listBackups(BACKUP_PAGE_SIZE, nextOffset)
      .then((list) => {
        setRecordsState({ kind: 'ready', records: list.records, total: list.total })
        if (nextOffset === 0 && list.resolvedPath) setResolvedPath(list.resolvedPath)
      })
      .catch((err) => {
        setRecordsState({ kind: 'error', message: toErrorMessage(err) })
      })
  }, [])

  useEffect(() => {
    loadSettings()
    loadRecords(0)
  }, [loadSettings, loadRecords])

  const reloadSettings = () => {
    setState({ kind: 'loading' })
    loadSettings()
  }

  const reloadRecords = (nextOffset: number) => {
    setOffset(nextOffset)
    setRecordsState({ kind: 'loading' })
    loadRecords(nextOffset)
  }

  // 相对路径 -> 后端解析出的绝对地址（带防抖）。
  useEffect(() => {
    const handle = window.setTimeout(() => {
      dashboardApi
        .resolveBackupPath(path)
        .then(setResolvedPath)
        .catch(() => {})
    }, 300)
    return () => window.clearTimeout(handle)
  }, [path])

  const toggleModule = (module: BackupModule, checked: boolean) => {
    setSelectedModules((current) => {
      const next = new Set(current)
      if (checked) next.add(module)
      else next.delete(module)
      return next
    })
  }

  const handleSave = async () => {
    if (orderedModules.length === 0) {
      toast.error(t('backup.noModulesError'))
      return
    }
    setSaving(true)
    try {
      await Promise.all([
        dashboardApi.updateSetting(BACKUP_MODULES_KEY, JSON.stringify(orderedModules)),
        dashboardApi.updateSetting(BACKUP_FREQUENCY_KEY, frequency),
        dashboardApi.updateSetting(BACKUP_PATH_KEY, path.trim() || DEFAULT_BACKUP_PATH),
      ])
      toast(t('toast.saved'))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleBackupNow = async () => {
    if (orderedModules.length === 0) {
      toast.error(t('backup.noModulesError'))
      return
    }
    setBackingUp(true)
    try {
      const { fileCreated } = await dashboardApi.createBackup(orderedModules, path.trim())
      toast(fileCreated ? t('backup.created') : t('backup.createdUnchanged'))
      reloadRecords(0)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await dashboardApi.restoreBackup(restoreTarget.id)
      toast(t('backup.restored'))
      setRestoreTarget(null)
      reloadRecords(0)
      // 恢复可能覆盖系统设置（包括备份设置本身），重新拉一次保持一致。
      loadSettings()
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setRestoring(false)
    }
  }

  const columns: ColumnDef<BackupRecord>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        label: t('backup.colTime'),
        defaultWidth: { kind: 'pixel', value: 180 },
        isTime: true,
        accessor: (row) => formatDateTime(row.createdAt),
      },
      {
        key: 'modules',
        label: t('backup.colModules'),
        defaultWidth: { kind: 'percent', value: 32 },
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <span>
            {row.modules.map((module) => t(MODULE_LABEL[module])).join(t('backup.moduleSeparator'))}
            {row.unchanged && (
              <span className="text-muted-foreground">{t('backup.noChangeNote')}</span>
            )}
          </span>
        ),
      },
      {
        key: 'size',
        label: t('backup.colSize'),
        defaultWidth: { kind: 'pixel', value: 100 },
        defaultAlign: 'right',
        accessor: (row) => (row.sizeBytes > 0 ? formatSize(row.sizeBytes) : '—'),
      },
      {
        key: 'location',
        label: t('backup.colLocation'),
        defaultWidth: { kind: 'percent', value: 28 },
        defaultOverflow: 'ellipsis',
        showEmptyPlaceholder: false,
        render: (_, row) => <span className="font-mono text-xs">{row.path}</span>,
      },
      {
        key: 'actions',
        label: t('table.actions'),
        defaultWidth: { kind: 'pixel', value: 100 },
        defaultAlign: 'right',
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <span title={row.unchanged ? t('backup.noChangeRestoreDisabled') : undefined}>
            <Button
              variant="outline"
              size="sm"
              disabled={row.unchanged === true || restoring}
              onClick={() => setRestoreTarget(row)}
            >
              {t('backup.restore')}
            </Button>
          </span>
        ),
      },
    ],
    [t, restoring],
  )

  const records = recordsState.kind === 'ready' ? recordsState.records : []
  const total = recordsState.kind === 'ready' ? recordsState.total : 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('backup.pageTitle')} description={t('backup.pageDescription')} />
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="backup" className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="mb-5 !h-[50px] w-full justify-start gap-6 border-b border-border-subtle p-0">
            <TabsTrigger value="backup" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('backup.tab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="backup" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <div className="flex flex-col gap-6 pb-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AppIcon name="settings" size={16} /> {t('backup.paramsTitle')}
                  </CardTitle>
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
                      <Button variant="outline" size="sm" onClick={reloadSettings}>
                        <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
                      </Button>
                    </div>
                  )}

                  {state.kind === 'ready' && (
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="text-sm font-medium">{t('backup.contentTitle')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{t('backup.contentHint')}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-3">
                          {BACKUP_MODULES.map((module) => (
                            <label
                              key={module.id}
                              className="flex cursor-pointer items-start gap-2.5 text-sm"
                            >
                              <Checkbox
                                className="mt-0.5 size-[18px] bg-background"
                                checked={selectedModules.has(module.id)}
                                onCheckedChange={(v) => toggleModule(module.id, v === true)}
                                aria-label={t(module.labelKey)}
                              />
                              <span className="flex min-w-0 flex-col">
                                <span className="font-medium">{t(module.labelKey)}</span>
                                <span className="text-xs text-muted-foreground">{t(module.hintKey)}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-medium">{t('backup.frequencyLabel')}</div>
                        <div>
                          <Select
                            value={frequency}
                            onValueChange={(v) => setFrequency(v as BackupFrequency)}
                          >
                            <SelectTrigger className="w-40" aria-label={t('backup.frequencyLabel')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {FREQUENCIES.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {t(FREQUENCY_LABEL[value])}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('backup.noChangeHint')}</p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-medium">{t('backup.locationTitle')}</div>
                        <p className="text-xs text-muted-foreground">{t('backup.locationDescription')}</p>
                        <label className="grid max-w-xl gap-1.5 text-sm" htmlFor="backup-path">
                          {t('backup.pathLabel')}
                          <Input
                            id="backup-path"
                            value={path}
                            onChange={(event) => setPath(event.target.value)}
                            placeholder={t('backup.pathPlaceholder')}
                          />
                        </label>
                        <div className="text-xs text-muted-foreground">
                          {t('backup.absolutePathLabel')}{' '}
                          <span className="font-mono text-foreground">{resolvedPath || '—'}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <Button variant="outline" onClick={handleSave} disabled={saving}>
                          {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                          {t('common:action.save')}
                        </Button>
                        <Button onClick={handleBackupNow} disabled={backingUp || state.kind !== 'ready'}>
                          {backingUp ? (
                            <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <AppIcon name="add" data-icon="inline-start" />
                          )}
                          {t('backup.backupNow')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AppIcon name="history" size={16} /> {t('backup.historyTitle')}
                  </CardTitle>
                  <CardDescription>{t('backup.historyDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DataTable
                    id="backup-records"
                    columns={columns}
                    data={records}
                    total={total}
                    loading={recordsState.kind === 'loading'}
                    error={recordsState.kind === 'error' ? recordsState.message : null}
                    offset={offset}
                    limit={BACKUP_PAGE_SIZE}
                    onOffsetChange={reloadRecords}
                    onRetry={() => reloadRecords(offset)}
                    emptyText={t('backup.empty')}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) setRestoreTarget(null)
        }}
      >
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('backup.restoreTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <>
                <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={restoring}>
                  {t('common:action.cancel')}
                </Button>
                <Button onClick={() => void handleRestore()} disabled={restoring}>
                  {restoring && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  {t('backup.restoreConfirm')}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              {restoreTarget ? t('backup.restoreWarning', { time: formatDateTime(restoreTarget.createdAt) }) : ''}
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
