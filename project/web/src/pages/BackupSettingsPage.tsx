import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
type BackupModule = 'data' | 'software'
type BackupFrequency = 'daily' | 'weekly' | 'monthly'
type BackupLocation = 'server' | 'local'

type BackupRecord = {
  readonly id: string
  readonly createdAt: string
  readonly sizeBytes: number
  readonly modules: readonly BackupModule[]
  readonly location: BackupLocation
  readonly path: string
}

const MOCK_BACKUPS: readonly BackupRecord[] = [
  {
    id: 'bk-20261006-0300',
    createdAt: '2026-10-06T03:00:00',
    sizeBytes: 305_000_000,
    modules: ['data', 'software'],
    location: 'server',
    path: '/var/backups/hapiy',
  },
  {
    id: 'bk-20261005-0300',
    createdAt: '2026-10-05T03:00:00',
    sizeBytes: 301_500_000,
    modules: ['data'],
    location: 'server',
    path: '/var/backups/hapiy',
  },
  {
    id: 'bk-20261004-1230',
    createdAt: '2026-10-04T12:30:00',
    sizeBytes: 298_400_000,
    modules: ['data', 'software'],
    location: 'local',
    path: '/Users/you/Backups/hapiy',
  },
  {
    id: 'bk-20261003-0300',
    createdAt: '2026-10-03T03:00:00',
    sizeBytes: 288_100_000,
    modules: ['data'],
    location: 'server',
    path: '/var/backups/hapiy',
  },
  {
    id: 'bk-20261001-0900',
    createdAt: '2026-10-01T09:00:00',
    sizeBytes: 42_800_000,
    modules: ['software'],
    location: 'local',
    path: '/Users/you/Backups/hapiy',
  },
  {
    id: 'bk-20260930-0300',
    createdAt: '2026-09-30T03:00:00',
    sizeBytes: 296_700_000,
    modules: ['data', 'software'],
    location: 'server',
    path: '/var/backups/hapiy',
  },
]

const FREQUENCIES: readonly BackupFrequency[] = ['daily', 'weekly', 'monthly']

const FREQUENCY_LABEL: Record<BackupFrequency, string> = {
  daily: 'backup.frequencyDaily',
  weekly: 'backup.frequencyWeekly',
  monthly: 'backup.frequencyMonthly',
}

const MODULE_LABEL: Record<BackupModule, string> = {
  data: 'backup.moduleData',
  software: 'backup.moduleSoftware',
}

const LOCATION_LABEL: Record<BackupLocation, string> = {
  server: 'backup.locationServer',
  local: 'backup.locationLocal',
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

function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{title}</div>
        <Switch
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={title}
          className="shrink-0"
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

export function BackupSettingsPage() {
  const { t } = useTranslation('settings')
  const [autoData, setAutoData] = useState(true)
  const [autoSoftware, setAutoSoftware] = useState(false)
  const [frequency, setFrequency] = useState<BackupFrequency>('daily')
  const [location, setLocation] = useState<BackupLocation>('server')
  const [path, setPath] = useState('/var/backups/hapiy')
  const [offset, setOffset] = useState(0)
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null)

  const records = MOCK_BACKUPS
  const pagedRecords = useMemo(() => records.slice(offset, offset + BACKUP_PAGE_SIZE), [records, offset])

  const notifyPreview = () => toast(t('backup.previewToast'))

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
        defaultWidth: { kind: 'percent', value: 25 },
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <div className="flex flex-wrap items-center gap-1">
            {row.modules.map((module) => (
              <Badge key={module} variant="secondary">
                {t(MODULE_LABEL[module])}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        key: 'size',
        label: t('backup.colSize'),
        defaultWidth: { kind: 'pixel', value: 100 },
        defaultAlign: 'right',
        accessor: (row) => formatSize(row.sizeBytes),
      },
      {
        key: 'location',
        label: t('backup.colLocation'),
        defaultWidth: { kind: 'percent', value: 30 },
        defaultOverflow: 'ellipsis',
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <div className="flex min-w-0 flex-col">
            <span>{t(LOCATION_LABEL[row.location])}</span>
            <span className="truncate text-xs text-muted-foreground">{row.path}</span>
          </div>
        ),
      },
      {
        key: 'actions',
        label: t('table.actions'),
        defaultWidth: { kind: 'pixel', value: 120 },
        defaultAlign: 'right',
        showEmptyPlaceholder: false,
        render: (_, row) => (
          <Button variant="outline" size="sm" onClick={() => setRestoreTarget(row)}>
            {t('backup.restore')}
          </Button>
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
                    <AppIcon name="settings" size={16} /> {t('backup.settingsTitle')}
                  </CardTitle>
                  <CardDescription>{t('backup.settingsDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-5">
                    <SettingToggle
                      title={t('backup.dataBackupLabel')}
                      description={t('backup.dataBackupHint')}
                      checked={autoData}
                      onChange={setAutoData}
                    />
                    <SettingToggle
                      title={t('backup.softwareBackupLabel')}
                      description={t('backup.softwareBackupHint')}
                      checked={autoSoftware}
                      onChange={setAutoSoftware}
                    />
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="grid gap-1.5 text-sm">
                        {t('backup.frequencyLabel')}
                        <Select value={frequency} onValueChange={(v) => setFrequency(v as BackupFrequency)}>
                          <SelectTrigger className="w-40">
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
                      <label className="grid gap-1.5 text-sm">
                        {t('backup.locationLabel')}
                        <Select value={location} onValueChange={(v) => setLocation(v as BackupLocation)}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="server">{t('backup.locationServer')}</SelectItem>
                              <SelectItem value="local">{t('backup.locationLocal')}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </label>
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
                    <p className="text-xs text-muted-foreground">{t('backup.locationHint')}</p>
                  </div>
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
                    actions={
                      <Button onClick={notifyPreview}>
                        <AppIcon name="add" data-icon="inline-start" />
                        {t('backup.backupNow')}
                      </Button>
                    }
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
