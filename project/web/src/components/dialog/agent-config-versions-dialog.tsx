import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi, type AgentConfigFile, type AgentConfigVersionList } from '@/lib/dashboard-api'

interface AgentConfigVersionsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
  readonly onRestored: () => void
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AgentConfigVersionsDialog({ open, onOpenChange, record, onRestored }: AgentConfigVersionsDialogProps) {
  const { t } = useTranslation('agentConfig')
  const [list, setList] = useState<AgentConfigVersionList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'archive' | 'restore' | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setList(null)
    setError(null)
    setConfirmId(null)
    setBusy(null)
    dashboardApi.listAgentConfigFileVersions(record.id)
      .then((data) => {
        if (!cancelled) setList(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.loadFailed'))
      })
    return () => { cancelled = true }
  }, [open, record.id, t])

  const handleArchive = async () => {
    setBusy('archive')
    try {
      setList(await dashboardApi.archiveAgentConfigFileVersion(record.id))
      toast.success(t('versions.archivedToast'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.archiveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async () => {
    if (!confirmId) return
    setBusy('restore')
    try {
      setList(await dashboardApi.restoreAgentConfigFileVersion(record.id, confirmId))
      setConfirmId(null)
      toast.success(t('versions.restored'))
      onRestored()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.restoreFailed'))
    } finally {
      setBusy(null)
    }
  }

  const summary = (lines: number, size: number) => t('versions.summary', { lines, size: formatSize(size) })
  const hasVersions = list !== null && (list.current !== null || list.versions.length > 0)

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
        <DialogContent width="sm" minHeight="480px" className="grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{t('versions.title')}</DialogTitle>
            <DialogDescription>{t('versions.description', { name: record.record_name })}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto rounded-md border border-border/60 bg-muted p-2">
            {list === null && !error && (
              <div className="flex items-center gap-2 p-4 text-muted-foreground">
                <AppIcon name="progress_activity" size={16} className="animate-spin" />
                <span className="text-sm">{t('common:state.loading')}</span>
              </div>
            )}
            {error && <div className="p-4 text-sm text-destructive">{error}</div>}
            {list?.current && (
              <div className="mb-1 rounded-md border border-primary bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t('versions.current')}</span>
                  {list.current.archived ? (
                    <span className="text-sm text-muted-foreground">{t('versions.archived')}</span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void handleArchive()} disabled={busy !== null}>
                      {busy === 'archive' ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : t('versions.archive')}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{summary(list.current.lines, list.current.size)}</p>
                {list.current.archived && list.current.updatedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">{formatTime(list.current.updatedAt)}</p>
                )}
              </div>
            )}
            {list?.versions.map((version) => (
              <div
                key={version.id}
                role="button"
                tabIndex={0}
                onClick={() => setConfirmId(version.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setConfirmId(version.id)
                  }
                }}
                className="mb-1 cursor-pointer rounded-md border border-border/50 p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{formatTime(version.createdAt)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      setConfirmId(version.id)
                    }}
                    disabled={busy !== null}
                  >
                    {t('versions.restore')}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{summary(version.lines, version.size)}</p>
              </div>
            ))}
            {list !== null && !hasVersions && (
              <div className="p-4 text-sm text-muted-foreground">{t('versions.empty')}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmId !== null} onOpenChange={(next) => { if (!next) setConfirmId(null) }}>
        <DialogContent scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('versions.restoreDialogTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <Button onClick={() => void handleRestore()} disabled={busy !== null}>
              {busy === 'restore' && <AppIcon name="progress_activity" size={16} className="animate-spin" data-icon="inline-start" />}
              {t('versions.restoreConfirm')}
            </Button>
          }>
            <p className="text-sm text-muted-foreground">{t('versions.restoreDialogBody')}</p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
