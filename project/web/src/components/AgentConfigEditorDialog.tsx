import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { JsonTokens } from '@/components/JsonHighlight'
import { splitJsonLines } from '@/lib/json-lines'
import { cn } from '@/lib/utils'
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

// BareJsonEditor — same in-memory layout as JsonLineEditor but without the
// outer rounded/border wrapper so it can stretch edge-to-edge inside the
// full-screen editor dialog.
function BareJsonEditor({
  value,
  onChange,
  readOnly,
  className,
}: {
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly readOnly?: boolean
  readonly className?: string
}) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lines = splitJsonLines(value)

  const syncScroll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop
      gutterRef.current.scrollLeft = textarea.scrollLeft
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = textarea.scrollTop
      backdropRef.current.scrollLeft = textarea.scrollLeft
    }
  }

  return (
    <div
      className={cn(
        'relative flex w-full overflow-hidden font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
        className,
      )}
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="w-14 shrink-0 select-none overflow-hidden border-r border-border bg-muted/40 py-3 text-right text-muted-foreground/70"
      >
        {lines.map((_, index) => (
          <div key={index} className="pr-2 leading-relaxed tabular-nums">
            {index + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <pre
          ref={backdropRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden text-transparent p-3"
        >
          <JsonTokens text={value} />
        </pre>
        <textarea
          ref={textareaRef}
          className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none p-3"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          wrap="soft"
          readOnly={readOnly}
          aria-label="JSON 内容"
        />
      </div>
    </div>
  )
}

export function AgentConfigEditorDialog({
  open,
  onOpenChange,
  record,
}: AgentConfigEditorDialogProps) {
  const [content, setContent] = useState<string | null>(null)
  const [original, setOriginal] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmSave, setConfirmSave] = useState(false)

  useEffect(() => {
    if (!open) {
      setContent(null)
      setOriginal(null)
      setLoading(false)
      setFetchError(null)
      setSaving(false)
      setSaveError(null)
      setConfirmSave(false)
      return
    }
    let cancelled = false
    setContent(null)
    setOriginal(null)
    setLoading(true)
    setFetchError(null)
    setSaveError(null)
    setConfirmSave(false)
    dashboardApi
      .getAgentConfigFileContent(record.id)
      .then((text) => {
        if (cancelled) return
        setContent(text)
        setOriginal(text)
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

  const dirty = content !== null && original !== null && content !== original

  const requestSave = () => {
    if (!dirty) {
      void doSave()
    } else {
      setConfirmSave(true)
    }
  }

  const doSave = async () => {
    if (content === null || saving) return
    setSaving(true)
    setSaveError(null)
    setConfirmSave(false)
    try {
      await dashboardApi.saveAgentConfigFileContent(record.id, content)
      toast('已保存')
      onOpenChange(false)
    } catch (err) {
      setSaveError(toErrorMessage(err, '保存失败'))
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
        bare
        className="flex flex-col overflow-hidden p-0"
      >
        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-6 py-4">
          <DialogTitle className="text-base">{record.record_name}</DialogTitle>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {record.path}
          </span>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
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
              <BareJsonEditor
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
          <Button onClick={requestSave} disabled={busy || content === null}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>

        {confirmSave && (
          <Dialog open={confirmSave} onOpenChange={(o) => !saving && setConfirmSave(o)}>
            <DialogContent width="sm">
              <DialogHeader>
                <DialogTitle>确认保存修改</DialogTitle>
                <DialogDescription>
                  检测到文件内容已修改，是否覆盖写入「{record.path}」？
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmSave(false)} disabled={saving}>取消</Button>
                <Button onClick={() => void doSave()} disabled={saving}>
                  {saving ? '保存中...' : '确认保存'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}