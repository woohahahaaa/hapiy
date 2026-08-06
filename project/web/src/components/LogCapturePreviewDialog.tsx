import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { dashboardApi } from '@/lib/dashboard-api'

interface LogCapturePreviewDialogProps {
  readonly fileId: string
  readonly fileName: string
  readonly open: boolean
  readonly onClose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderContent(content: unknown) {
  if (!isRecord(content)) {
    return (
      <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
        {JSON.stringify(content, null, 2)}
      </pre>
    )
  }

  const entries = Object.entries(content)
  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        文件内容为空
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <div className="font-mono text-xs font-medium text-foreground">{key}</div>
          <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  )
}

export function LogCapturePreviewDialog({
  fileId,
  fileName,
  open,
  onClose,
}: LogCapturePreviewDialogProps) {
  const [content, setContent] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)
    dashboardApi
      .readLogCaptureFile(fileId)
      .then((data) => {
        if (!cancelled) setContent(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fileId, open, reloadKey])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>日志预览</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{fileName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              加载中...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <span className="text-xs text-destructive">{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                重试
              </Button>
            </div>
          ) : (
            renderContent(content)
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
