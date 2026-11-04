import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/wooh/dialog'
import { cn } from '@/lib/utils'

// 历史版本弹窗的公共外壳：左侧版本列表 + 右侧预览 + 恢复确认，接管拓扑和
// 接管 Agent 的配置文件历史共用。数据读取与预览渲染由调用方通过 source /
// renderPreview 注入，两边只写各自的领域适配。
export type VersionPreviewTarget =
  { kind: 'current' } | { kind: 'version'; id: string }

export interface VersionsModalItem {
  readonly id: string
  readonly createdAt: string
  readonly summary: string
}

export interface VersionsModalCurrent {
  readonly archived: boolean
  readonly summary: string
  readonly updatedAt?: string | null
}

export interface VersionsModalList {
  readonly current: VersionsModalCurrent | null
  readonly versions: readonly VersionsModalItem[]
}

export interface VersionsModalMessages {
  readonly title: string
  readonly current: string
  readonly archived: string
  readonly archive: string
  readonly restore: string
  readonly empty: string
  readonly loading: string
  readonly previewHint: string
  readonly restoreTitle: string
  readonly restoreBody: string
  readonly restoreConfirm: string
  readonly archivedToast: string
  readonly restoredToast: string
  readonly loadFailed: string
  readonly previewFailed: string
  readonly archiveFailed: string
  readonly restoreFailed: string
}

export interface VersionsModalSource<P> {
  readonly list: () => Promise<VersionsModalList>
  readonly currentPreview: () => Promise<P | null>
  readonly versionPreview: (id: string) => Promise<P | null>
  readonly archive: () => Promise<VersionsModalList>
  readonly restore: (id: string) => Promise<VersionsModalList>
  /** 恢复前执行（例如先保存当前编辑中的内容）。 */
  readonly beforeRestore?: () => Promise<void>
  readonly onRestored?: () => void
}

export interface VersionsModalProps<P> {
  readonly open: boolean
  readonly onClose: () => void
  readonly messages: VersionsModalMessages
  readonly source: VersionsModalSource<P>
  /** 右侧预览内容；返回 null 时显示「选择左侧条目以预览」。 */
  readonly renderPreview: (args: {
    readonly target: VersionPreviewTarget
    readonly value: P
    readonly current: P | null
  }) => ReactNode
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

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function VersionsModal<P>({
  open,
  onClose,
  messages,
  source,
  renderPreview,
}: VersionsModalProps<P>) {
  const [list, setList] = useState<VersionsModalList | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [target, setTarget] = useState<VersionPreviewTarget>({
    kind: 'current',
  })
  const [currentValue, setCurrentValue] = useState<P | null>(null)
  const [selectedValue, setSelectedValue] = useState<P | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(open)
  const [busy, setBusy] = useState<'archive' | 'restore' | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // 调用方每次渲染都会新建 source / messages（里面带着 t），放进依赖会让
  // 打开期间每次父级更新都重新拉一遍列表；用 ref 保持取到最新实现即可。
  const sourceRef = useRef(source)
  useEffect(() => {
    sourceRef.current = source
  }, [source])
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 递增后旧请求的结果作废，避免连续点版本时后到的响应覆盖新选择。
  const previewRequestRef = useRef(0)

  // 每次打开都回到「当前版本」并清掉上一次的数据。这里用渲染期重置而不是
  // effect：effect 里同步 setState 会多一轮渲染，也被 lint 拦。
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setList(null)
      setListError(null)
      setTarget({ kind: 'current' })
      setCurrentValue(null)
      setSelectedValue(null)
      setPreviewError(null)
      setPreviewLoading(true)
      setBusy(null)
      setConfirmId(null)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const request = ++previewRequestRef.current

    void sourceRef.current
      .list()
      .then((data) => {
        if (!cancelled) setList(data)
      })
      .catch((err) => {
        if (!cancelled)
          setListError(errorMessage(err, messagesRef.current.loadFailed))
      })

    void sourceRef.current
      .currentPreview()
      .then((value) => {
        if (!cancelled && request === previewRequestRef.current)
          setCurrentValue(value)
      })
      .catch((err) => {
        if (!cancelled && request === previewRequestRef.current) {
          setPreviewError(errorMessage(err, messagesRef.current.previewFailed))
        }
      })
      .finally(() => {
        if (!cancelled && request === previewRequestRef.current)
          setPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const handleSelectCurrent = (): void => {
    previewRequestRef.current += 1
    setTarget({ kind: 'current' })
    setSelectedValue(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }

  const handleSelectVersion = (id: string): void => {
    const request = ++previewRequestRef.current
    setTarget({ kind: 'version', id })
    setSelectedValue(null)
    setPreviewError(null)
    setPreviewLoading(true)
    void sourceRef.current
      .versionPreview(id)
      .then((value) => {
        if (request === previewRequestRef.current) setSelectedValue(value)
      })
      .catch((err) => {
        if (request === previewRequestRef.current) {
          setPreviewError(errorMessage(err, messagesRef.current.previewFailed))
        }
      })
      .finally(() => {
        if (request === previewRequestRef.current) setPreviewLoading(false)
      })
  }

  const handleArchive = async (): Promise<void> => {
    setBusy('archive')
    try {
      setList(await sourceRef.current.archive())
      toast.success(messagesRef.current.archivedToast)
    } catch (err) {
      toast.error(errorMessage(err, messagesRef.current.archiveFailed))
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async (): Promise<void> => {
    if (!confirmId) return
    setBusy('restore')
    try {
      await sourceRef.current.beforeRestore?.()
      setList(await sourceRef.current.restore(confirmId))
      setConfirmId(null)
      toast.success(messagesRef.current.restoredToast)
      sourceRef.current.onRestored?.()
      // 恢复后当前内容已变，重新取一次并回到「当前版本」预览。
      previewRequestRef.current += 1
      setTarget({ kind: 'current' })
      setSelectedValue(null)
      setPreviewError(null)
      setPreviewLoading(false)
      try {
        setCurrentValue(await sourceRef.current.currentPreview())
      } catch {
        setCurrentValue(null)
      }
    } catch (err) {
      toast.error(errorMessage(err, messagesRef.current.restoreFailed))
    } finally {
      setBusy(null)
    }
  }

  const activeValue = target.kind === 'current' ? currentValue : selectedValue
  const preview =
    !previewLoading && previewError === null && activeValue !== null
      ? renderPreview({ target, value: activeValue, current: currentValue })
      : null
  const hasVersions =
    list !== null && (list.current !== null || list.versions.length > 0)

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent
          width="max"
          height="auto"
          minHeight="640px"
          className="grid-rows-[auto_minmax(0,1fr)]"
        >
          <DialogHeader>
            <DialogTitle>{messages.title}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 gap-4">
            <div className="w-72 shrink-0 overflow-y-auto rounded-xl border border-border bg-muted p-2">
              {list === null && listError === null && (
                <div className="flex items-center gap-2 p-4 text-muted-foreground">
                  <AppIcon
                    name="progress_activity"
                    size={16}
                    className="animate-spin"
                  />
                  <span className="text-sm">{messages.loading}</span>
                </div>
              )}
              {listError !== null && (
                <div className="p-4 text-sm text-destructive">{listError}</div>
              )}
              {list?.current && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={handleSelectCurrent}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleSelectCurrent()
                    }
                  }}
                  className={cn(
                    'mb-1 cursor-pointer rounded-lg border p-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                    target.kind === 'current'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {messages.current}
                    </span>
                    {list.current.archived ? (
                      <span className="text-sm text-muted-foreground">
                        {messages.archived}
                      </span>
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
                        {busy === 'archive' ? (
                          <AppIcon
                            name="progress_activity"
                            size={12}
                            className="animate-spin"
                          />
                        ) : (
                          messages.archive
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {list.current.summary}
                  </p>
                  {list.current.archived && list.current.updatedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(list.current.updatedAt)}
                    </p>
                  )}
                </div>
              )}
              {list?.versions.map((version) => (
                <div
                  key={version.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectVersion(version.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      handleSelectVersion(version.id)
                    }
                  }}
                  className={cn(
                    'mb-1 cursor-pointer rounded-lg border p-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                    target.kind === 'version' && target.id === version.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {formatTime(version.createdAt)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmId(version.id)
                      }}
                      disabled={busy !== null}
                    >
                      {messages.restore}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {version.summary}
                  </p>
                </div>
              ))}
              {list !== null && !hasVersions && (
                <div className="p-4 text-sm text-muted-foreground">
                  {messages.empty}
                </div>
              )}
            </div>

            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-border">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <AppIcon
                    name="progress_activity"
                    size={20}
                    className="animate-spin"
                  />
                </div>
              ) : previewError !== null ? (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-destructive">
                  {previewError}
                </div>
              ) : (
                (preview ?? (
                  <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
                    {messages.previewHint}
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmId(null)
        }}
      >
        <DialogContent scrollFooter>
          <DialogHeader>
            <DialogTitle>{messages.restoreTitle}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <Button
                onClick={() => void handleRestore()}
                disabled={busy !== null}
              >
                {busy === 'restore' && (
                  <AppIcon
                    name="progress_activity"
                    size={16}
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                {messages.restoreConfirm}
              </Button>
            }
          >
            <p className="text-sm text-muted-foreground">
              {messages.restoreBody}
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
