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
import { dashboardApi, type AgentConfigFile, type AgentConfigVersion } from '@/lib/dashboard-api'
import { cn } from '@/lib/utils'

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

export function AgentConfigVersionsDialog({ open, onOpenChange, record, onRestored }: AgentConfigVersionsDialogProps) {
  const { t } = useTranslation('agentConfig')
  const [versions, setVersions] = useState<readonly AgentConfigVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setVersions(null)
    setError(null)
    setConfirmId(null)
    setRestoring(false)
    dashboardApi.listAgentConfigFileVersions(record.id)
      .then((data) => {
        if (!cancelled) setVersions(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('errors.loadFailed'))
      })
    return () => { cancelled = true }
  }, [open, record.id, t])

  const doRestore = async () => {
    if (!confirmId || restoring) return
    setRestoring(true)
    try {
      const data = await dashboardApi.restoreAgentConfigFileVersion(record.id, confirmId)
      setVersions(data)
      setConfirmId(null)
      toast.success(t('versions.restored'))
      onRestored()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.restoreFailed'))
    } finally {
      setRestoring(false)
    }
  }

  const summary = (version: AgentConfigVersion) => {
    if (version.restoredFrom) {
      return t('versions.restoredFrom', { time: formatTime(version.restoredFrom.createdAt) })
    }
    return version.current ? t('versions.currentHint') : ''
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !restoring && onOpenChange(next)}>
        <DialogContent width="sm" minHeight="420px" className="grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{t('versions.title')}</DialogTitle>
            <DialogDescription>{t('versions.description', { name: record.record_name })}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            {versions === null && !error && (
              <div className="flex items-center gap-2 p-4 text-muted-foreground">
                <AppIcon name="progress_activity" size={16} className="animate-spin" />
                <span className="text-sm">{t('common:state.loading')}</span>
              </div>
            )}
            {error && <div className="p-4 text-sm text-destructive">{error}</div>}
            {versions?.map((version) => (
              <div
                key={version.id}
                role={version.current ? undefined : 'button'}
                tabIndex={version.current ? undefined : 0}
                onClick={version.current ? undefined : () => setConfirmId(version.id)}
                onKeyDown={version.current ? undefined : (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setConfirmId(version.id)
                  }
                }}
                className={cn(
                  'mb-1 rounded-md border p-3 transition-colors',
                  version.current ? 'border-primary bg-primary/5' : 'cursor-pointer border-border/50 outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">
                    {version.current && <span className="mr-1 font-sans font-medium">{t('versions.current')}</span>}
                    {formatTime(version.createdAt)}
                  </span>
                  {!version.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmId(version.id)
                      }}
                      disabled={restoring}
                    >
                      {t('versions.restore')}
                    </Button>
                  )}
                </div>
                {summary(version) && <p className="mt-1 text-xs text-muted-foreground">{summary(version)}</p>}
              </div>
            ))}
            {versions !== null && versions.length === 0 && (
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
            <Button onClick={() => void doRestore()} disabled={restoring}>
              {restoring && <AppIcon name="progress_activity" size={16} className="animate-spin" data-icon="inline-start" />}
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
