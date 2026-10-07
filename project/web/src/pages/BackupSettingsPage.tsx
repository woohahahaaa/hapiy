import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
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

// 预览阶段的占位数据：后端 /dashboard/backups 接口就绪后替换为真实数据。
// MOCK_BASE_DIR 模拟“运行后台服务的那台电脑”上备份的基准目录；接入后端后
// 由后端返回真实基准目录并把相对路径解析成绝对路径（Windows 为 C:\ 之类盘符）。
const MOCK_BASE_DIR = '/Users/you/.hapiy'

type BackupModule =
  | 'topology'
  | 'providers'
  | 'tokens'
  | 'policy'
  | 'agent'
  | 'settings'
  | 'usage'
  | 'logs'
// 频率：从不 = 只手动备份；其余为自动备份间隔。
type BackupFrequency = 'never' | 'hourly' | 'daily' | 'weekly'

type BackupRecord = {
  readonly id: string
  readonly createdAt: string
  readonly sizeBytes: number
  readonly modules: readonly BackupModule[]
  readonly path: string
  /** true = 和上次无差异，只记一条记录、没有新文件 */
  readonly unchanged?: boolean
}

// 模块清单 = 备份选择项；使用记录与日志默认不勾选。
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

const MOCK_BACKUPS: readonly BackupRecord[] = [
  {
    id: 'bk-20261007-0300',
    createdAt: '2026-10-07T03:00:00',
    sizeBytes: 0,
    modules: ['topology', 'providers', 'tokens', 'policy', 'agent', 'settings'],
    path: '/Users/you/.hapiy/backups',
    unchanged: true,
  },
  {
    id: 'bk-20261006-0300',
    createdAt: '2026-10-06T03:00:00',
    sizeBytes: 305_000_000,
    modules: ['topology', 'providers', 'tokens', 'policy', 'agent', 'settings'],
    path: '/Users/you/.hapiy/backups',
  },
  {
    id: 'bk-20261005-0300',
    createdAt: '2026-10-05T03:00:00',
    sizeBytes: 301_500_000,
    modules: ['topology', 'providers', 'tokens'],
    path: '/Users/you/.hapiy/backups',
  },
  {
    id: 'bk-20261004-1230',
    createdAt: '2026-10-04T12:30:00',
    sizeBytes: 312_400_000,
    modules: ['topology', 'providers', 'tokens', 'policy', 'agent', 'settings', 'usage', 'logs'],
    path: '/Volumes/Data/hapiy-backups',
  },
  {
    id: 'bk-20261003-0300',
    createdAt: '2026-10-03T03:00:00',
    sizeBytes: 288_100_000,
    modules: ['topology', 'providers'],
    path: '/Users/you/.hapiy/backups',
  },
  {
    id: 'bk-20261001-0900',
    createdAt: '2026-10-01T09:00:00',
    sizeBytes: 42_800_000,
    modules: ['tokens', 'settings'],
    path: '/Users/you/.hapiy/backups',
  },
]

// 下拉框顺序：从不放第一个，默认每周。
const FREQUENCIES: readonly BackupFrequency[] = ['never', 'daily', 'weekly', 'hourly']

const FREQUENCY_LABEL: Record<BackupFrequency, string> = {
  never: 'backup.frequencyNever',
  daily: 'backup.frequencyDaily',
  weekly: 'backup.frequencyWeekly',
  hourly: 'backup.frequencyHourly',
}

const BACKUP_PAGE_SIZE = 10

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

// 预览用：把相对路径拼到基准目录上并消掉 . / ..；绝对路径原样规范化。
// 接入后端后这一步由后端完成（它能知道真实系统是 Mac / Windows / Linux）。
function resolveAbsolutePath(baseDir: string, input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return baseDir
  const isAbsolute = trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)
  const combined = isAbsolute ? trimmed : `${baseDir}/${trimmed}`
  const drive = combined.match(/^[a-zA-Z]:/)?.[0] ?? ''
  const rest = drive ? combined.slice(drive.length) : combined
  const parts: string[] = []
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const sep = drive ? '\\' : '/'
  return drive + sep + parts.join(sep)
}

function moduleSignature(modules: readonly BackupModule[]): string {
  return [...modules].sort().join(',')
}

export function BackupSettingsPage() {
  const { t } = useTranslation('settings')
  const [selectedModules, setSelectedModules] = useState<ReadonlySet<BackupModule>>(
    () => new Set(DEFAULT_SELECTED_MODULES),
  )
  const [frequency, setFrequency] = useState<BackupFrequency>('weekly')
  const [path, setPath] = useState('backups')
  const [records, setRecords] = useState<readonly BackupRecord[]>(MOCK_BACKUPS)
  const [offset, setOffset] = useState(0)
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null)

  const pagedRecords = useMemo(() => records.slice(offset, offset + BACKUP_PAGE_SIZE), [records, offset])
  const absolutePath = useMemo(() => resolveAbsolutePath(MOCK_BASE_DIR, path), [path])

  const notifyPreview = () => toast(t('backup.previewToast'))

  const toggleModule = (module: BackupModule, checked: boolean) => {
    setSelectedModules((current) => {
      const next = new Set(current)
      if (checked) next.add(module)
      else next.delete(module)
      return next
    })
  }

  // 与上一条记录对比：内容一致时只加一条“和上次无差异”的记录，不生成新文件。
  const handleBackupNow = () => {
    const selected = BACKUP_MODULES.filter((module) => selectedModules.has(module.id)).map(
      (module) => module.id,
    )
    const last = records[0]
    const unchanged = last !== undefined && moduleSignature(last.modules) === moduleSignature(selected)
    setRecords((current) => [
      {
        id: `bk-preview-${Date.now()}`,
        createdAt: new Date().toISOString(),
        sizeBytes: 0,
        modules: selected,
        path: absolutePath,
        unchanged,
      },
      ...current,
    ])
    setOffset(0)
    notifyPreview()
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
              disabled={row.unchanged === true}
              onClick={() => setRestoreTarget(row)}
            >
              {t('backup.restore')}
            </Button>
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('backup.pageTitle')}
        description={t('backup.pageDescription')}
        actions={<Badge variant="outline">{t('backup.previewBadge')}</Badge>}
      />
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
                    <AppIcon name="layers" size={16} /> {t('backup.contentTitle')}
                  </CardTitle>
                  <CardDescription>{t('backup.contentHint')}</CardDescription>
                </CardHeader>
                <CardContent>
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
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button onClick={handleBackupNow}>
                      <AppIcon name="add" data-icon="inline-start" />
                      {t('backup.backupNow')}
                    </Button>
                    <Button variant="outline" onClick={notifyPreview}>
                      {t('common:action.save')}
                    </Button>
                    <label className="ml-auto flex items-center gap-2 text-sm">
                      {t('backup.frequencyLabel')}
                      <Select
                        value={frequency}
                        onValueChange={(v) => setFrequency(v as BackupFrequency)}
                      >
                        <SelectTrigger className="w-32">
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
                    </label>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{t('backup.noChangeHint')}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AppIcon name="link" size={16} /> {t('backup.locationTitle')}
                  </CardTitle>
                  <CardDescription>{t('backup.locationDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="grid min-w-64 flex-1 gap-1.5 text-sm" htmlFor="backup-path">
                      {t('backup.pathLabel')}
                      <Input
                        id="backup-path"
                        value={path}
                        onChange={(event) => setPath(event.target.value)}
                        placeholder={t('backup.pathPlaceholder')}
                      />
                    </label>
                    <Button variant="outline" onClick={notifyPreview}>
                      {t('common:action.save')}
                    </Button>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {t('backup.absolutePathLabel')}{' '}
                    <span className="font-mono text-foreground">{absolutePath}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t('backup.locationHint')}</p>
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
                    data={pagedRecords}
                    total={records.length}
                    offset={offset}
                    limit={BACKUP_PAGE_SIZE}
                    onOffsetChange={setOffset}
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
          if (!open) setRestoreTarget(null)
        }}
      >
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('backup.restoreTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <>
                <Button variant="outline" onClick={() => setRestoreTarget(null)}>
                  {t('common:action.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setRestoreTarget(null)
                    notifyPreview()
                  }}
                >
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
