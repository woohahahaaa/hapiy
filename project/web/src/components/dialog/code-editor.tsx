import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { JsonTokens } from '@/components/JsonHighlight'
import { toast } from '@/components/ui/toast'
import { i18n } from '@/i18n/i18n'
import { splitJsonLines } from '@/lib/json-lines'
import { cn } from '@/lib/utils'

type DialogCodeEditorProps = {
  readonly mode: 'preview' | 'editable'
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly subtitle: string
  readonly loadContent: () => Promise<string>
  readonly onSave?: (content: string) => Promise<void>
  readonly onSaved?: () => void
  /** Extra top-right header buttons (e.g. the history entry). */
  readonly headerActions?: ReactNode
}

function jsonWarning(text: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : i18n.t('agentConfig:codeEditor.cannotParseJson')
    const position = message.match(/position (\d+)/i)
    if (!position) return i18n.t('agentConfig:codeEditor.notValidJson', { message })
    const index = Number(position[1])
    const before = text.slice(0, index)
    const line = before.split('\n').length
    const column = index - before.lastIndexOf('\n')
    return i18n.t('agentConfig:codeEditor.jsonProblemNear', { line, column, message })
  }
}

function CodeSurface({ value, onChange, readOnly }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly readOnly: boolean
}) {
  const { t } = useTranslation('agentConfig')
  const gutterRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lines = splitJsonLines(value)
  const isJson = jsonWarning(value) === null

  const syncScroll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop
    if (backdropRef.current) backdropRef.current.scrollTop = textarea.scrollTop
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
      <div
        ref={gutterRef}
        aria-hidden
        className="flex w-14 shrink-0 select-none flex-col overflow-hidden border-r border-border-subtle bg-muted/40 text-right text-muted-foreground/70"
      >
        {lines.map((_, index) => (
          <div key={index} className="flex-1 whitespace-nowrap pl-2 pr-2 pt-3 leading-relaxed tabular-nums">
            {index + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {readOnly ? (
          <pre className={cn('absolute inset-0 m-0 overflow-auto p-3', isJson ? undefined : 'text-foreground')}>
            {isJson ? <JsonTokens text={value} /> : value}
          </pre>
        ) : (
          <>
            <pre
              ref={backdropRef}
              aria-hidden
              className={cn('pointer-events-none absolute inset-0 m-0 overflow-hidden p-3', isJson ? 'text-transparent' : 'text-foreground')}
            >
              {isJson ? <JsonTokens text={value} /> : value}
            </pre>
            <textarea
              ref={textareaRef}
              className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-3 text-transparent caret-foreground outline-none"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              wrap="soft"
              readOnly={readOnly}
              aria-label={t('codeEditor.codeAria')}
            />
          </>
        )}
      </div>
    </div>
  )
}

export function DialogCodeEditor({ mode, open, onOpenChange, title, subtitle, loadContent, onSave, onSaved, headerActions }: DialogCodeEditorProps) {
  const { t } = useTranslation('agentConfig')
  const [content, setContent] = useState<string | null>(null)
  const [original, setOriginal] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setContent(null)
    setOriginal(null)
    setError(null)
    setLoading(true)
    setConfirmSave(false)
    loadContent().then((text) => {
      if (!cancelled) {
        setContent(text)
        setOriginal(text)
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : t('errors.readFailed'))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, loadContent])

  const dirty = mode === 'editable' && content !== null && original !== null && content !== original
  const warning = content === null ? null : jsonWarning(content)
  // 美化格式只改写编辑器里的工作副本，不落盘；用户仍需点击「保存」。
  const prettify = () => {
    if (content === null || saving) return
    try {
      setContent(JSON.stringify(JSON.parse(content), null, 2) + '\n')
    } catch {
      toast.error(t('errors.cannotPrettify'))
    }
  }
  const doSave = async () => {
    if (content === null || !onSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(content)
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent width="full" height="full" bare showCloseButton={false} className="flex flex-col !gap-0 overflow-hidden p-0">
        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border-subtle py-4 pl-6 pr-4">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{subtitle}</span>
          <div className="flex shrink-0 items-center gap-2">
            {mode === 'editable' && (
              <Button
                variant="outline"
                size="sm"
                title={t('codeEditor.prettifyTitle')}
                onClick={prettify}
                disabled={loading || saving}
              >
                {t('codeEditor.prettify')}
              </Button>
            )}
            {headerActions}
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {error && <div className="m-3 shrink-0 rounded-none border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">{error}</div>}
          {loading ? <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t('codeEditor.loadingContent')}</div> : content !== null && <CodeSurface value={content} onChange={setContent} readOnly={mode === 'preview' || saving} />}
        </div>
<DialogFooter className="shrink-0 border-t border-border-subtle px-6 py-3">
          {mode === 'editable' && (
            <Button onClick={() => setConfirmSave(true)} disabled={loading || saving || !dirty}>{saving ? t('codeEditor.saving') : t('common:action.save')}</Button>
          )}
        </DialogFooter>
        {confirmSave && (
          <Dialog open={confirmSave} onOpenChange={(next) => !saving && setConfirmSave(next)}>
            <DialogContent width="sm" scrollFooter>
              <DialogHeader>
                <DialogTitle>{warning ? t('codeEditor.jsonWarningTitle') : t('codeEditor.confirmSaveTitle')}</DialogTitle>
                <DialogDescription className={warning ? 'text-destructive' : undefined}>{warning ? t('codeEditor.jsonWarningDescription', { name: subtitle }) : t('codeEditor.confirmSaveDescription', { name: subtitle })}</DialogDescription>
                {warning && <p className="text-destructive">{warning}</p>}
              </DialogHeader>
              <DialogScrollBody footer={
                <>
                  <Button variant={warning ? 'destructive' : 'default'} onClick={() => void doSave()} disabled={saving}>{saving ? t('codeEditor.saving') : warning ? t('codeEditor.saveAnyway') : t('codeEditor.confirmSave')}</Button>
                </>
              } />
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
