import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { DiffView } from '@/components/DiffView'
import { JsonTokens } from '@/components/JsonHighlight'
import { toast } from '@/components/ui/toast'
import { dashboardApi, type AgentConfigFile, type AgentConfigVersionList } from '@/lib/dashboard-api'
import { cn } from '@/lib/utils'

interface AgentConfigVersionsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
  readonly onRestored: () => void
}

type PreviewTarget = { kind: 'current' } | { kind: 'version'; id: string }

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
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [currentContent, setCurrentContent] = useState<string | null>(null)
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'archive' | 'restore' | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setList(null)
    setError(null)
    setPreview(null)
    setPreviewContent(null)
    setPreviewLoading(false)
    setCurrentContent(null)
    setCurrentError(null)
    setCompare(false)
    setConfirmId(null)
    setBusy(null)
    dashboardApi.listAgentConfigFileVersions(record.id)
      .then((data) => { if (!cancelled) setList(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t('errors.loadFailed')) })
    dashboardApi.getAgentConfigFileContent(record.id)
      .then((content) => { if (!cancelled) setCurrentContent(content) })
      .catch((err) => { if (!cancelled) setCurrentError(err instanceof Error ? err.message : t('errors.readFailed')) })
    return () => { cancelled = true }
  }, [open, record.id, t])

  const handlePreviewCurrent = () => {
    setPreview({ kind: 'current' })
    setPreviewContent(currentContent)
    setPreviewLoading(false)
    setCompare(false)
  }

  const handlePreviewVersion = async (id: string) => {
    setPreview({ kind: 'version', id })
    setPreviewContent(null)
    setPreviewLoading(true)
    setCompare(false)
    try {
      const content = await dashboardApi.getAgentConfigFileVersion(record.id, id)
      setPreviewContent(content)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.readFailed'))
    } finally {
      setPreviewLoading(false)
    }
  }

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
      const data = await dashboardApi.restoreAgentConfigFileVersion(record.id, confirmId)
      setList(data)
      setConfirmId(null)
      setPreview(null)
      setPreviewContent(null)
      setCompare(false)
      setCurrentContent(await dashboardApi.getAgentConfigFileContent(record.id))
      toast.success(t('versions.restored'))
      onRestored()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.restoreFailed'))
    } finally {
      setBusy(null)
    }
  }

  const previewBody = useMemo(() => {
    if (!preview) return null
    if (preview.kind === 'current') {
      if (currentContent !== null) return currentContent
      return currentError
    }
    return previewContent
  }, [preview, currentContent, currentError, previewContent])

  const compareReady =
    preview?.kind === 'version' && currentContent !== null && previewContent !== null && currentContent !== previewContent
  const hasVersions = list !== null && (list.current !== null || list.versions.length > 0)
  const summary = (lines: number, size: number) => t('versions.summary', { lines, size: formatSize(size) })

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
        <DialogContent width="md" height="auto" minHeight="640px" className="grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{t('versions.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 gap-4">
            <div className="w-72 shrink-0 overflow-y-auto rounded-xs border border-border-subtle bg-muted p-2">
              {list === null && !error && (
                <div className="flex items-center gap-2 p-4 text-muted-foreground">
                  <AppIcon name="progress_activity" size={16} className="animate-spin" />
                  <span className="text-sm">{t('common:state.loading')}</span>
                </div>
              )}
              {error && <div className="p-4 text-sm text-destructive">{error}</div>}
              {list?.current && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={handlePreviewCurrent}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handlePreviewCurrent()
                    }
                  }}
                  className={cn(
                    'mb-1 cursor-pointer rounded-xs border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                    preview?.kind === 'current' ? 'border-primary bg-primary/5' : 'border-border-subtle',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t('versions.current')}</span>
                    {list.current.archived ? (
                      <span className="text-sm text-muted-foreground">{t('versions.archived')}</span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleArchive()
                        }}
                        disabled={busy !== null}
                      >
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
                  onClick={() => void handlePreviewVersion(version.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void handlePreviewVersion(version.id)
                    }
                  }}
                  className={cn(
                    'mb-1 cursor-pointer rounded-xs border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                    preview?.kind === 'version' && preview.id === version.id ? 'border-primary bg-primary/5' : 'border-border-subtle',
                  )}
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

            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xs border border-border-subtle">
              {preview?.kind === 'version' && (
                <Button
                  variant={compare ? 'default' : 'outline'}
                  size="sm"
                  className="absolute top-2 left-2 z-10"
                  onClick={() => setCompare((value) => !value)}
                  disabled={!compareReady || previewLoading}
                >
                  <AppIcon name="call_split" data-icon="inline-start" />
                  {t('versions.compareCurrent')}
                </Button>
              )}
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <AppIcon name="progress_activity" size={20} className="animate-spin" />
                </div>
              ) : compare && compareReady ? (
                <div className="absolute inset-0 overflow-auto p-3 pt-12">
                  <DiffView before={currentContent} after={previewContent} />
                </div>
              ) : previewBody !== null ? (
                <pre className="absolute inset-0 m-0 overflow-auto p-3 pt-12 font-mono text-xs leading-relaxed whitespace-pre">
                  <JsonTokens text={previewBody} />
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
                  {t('versions.previewHint')}
                </div>
              )}
            </div>
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
