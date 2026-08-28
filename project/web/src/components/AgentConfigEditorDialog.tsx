import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { JsonLineEditor } from '@/components/JsonLineEditor'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { AgentConfigFile } from '@/lib/dashboard-api'
import { toast } from '@/components/ui/toast'

interface AgentConfigEditorDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly record: AgentConfigFile
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : fallback
}

export function AgentConfigEditorDialog({
  open,
  onOpenChange,
  record,
}: AgentConfigEditorDialogProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setContent(null)
      setLoading(false)
      setFetchError(null)
      setSaving(false)
      setSaveError(null)
      return
    }
    let cancelled = false
    setContent(null)
    setLoading(true)
    setFetchError(null)
    setSaveError(null)
    dashboardApi
      .getAgentConfigFileContent(record.id)
      .then((text) => {
        if (!cancelled) setContent(text)
      })
      .catch((err) => {
        if (!cancelled) setFetchError(toErrorMessage(err, '读取失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, record.id])

  const handleSave = async () => {
    if (content === null || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await dashboardApi.saveAgentConfigFileContent(record.id, content)
      toast('已保存')
      onOpenChange(false)
    } catch (err) {
      setSaveError(toErrorMessage(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const busy = loading || saving

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onOpenChange(false)
      }}
    >
      <DialogContent
        width="full"
        height="full"
        bare className="flex flex-col overflow-hidden"
      >
        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-6 py-4">
          <DialogTitle className="text-base">{record.record_name}</DialogTitle>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {record.path}
          </span>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          {fetchError && (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {fetchError}
              </div>
            </div>
          )}
          {saveError && (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {saveError}
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              正在加载文件内容…
            </div>
          ) : (
            content !== null && (
              <JsonLineEditor
                value={content}
                onChange={setContent}
                readOnly={saving}
                className="min-h-0 flex-1"
              />
            )
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy || content === null}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
