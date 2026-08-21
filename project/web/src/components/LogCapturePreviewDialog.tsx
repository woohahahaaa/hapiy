import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DiffView } from '@/components/DiffView'
import { JsonHighlight } from '@/components/JsonHighlight'
import { dashboardApi } from '@/lib/dashboard-api'
import type { LogCapturePairFull, LogCaptureStageRow, LogCaptureTiming } from '@/lib/dashboard-api'

// ── Props (discriminated union — TypeScript exhaustiveness on `kind`) ──
type LogCapturePreviewDialogProps =
  | { readonly kind: 'pair'; readonly requestId: string; readonly open: boolean; readonly onClose: () => void }
  | { readonly kind: 'system'; readonly fileId: string; readonly fileName: string; readonly open: boolean; readonly onClose: () => void }

// ── LogCaptureRow (kept for the system branch) ──
interface LogCaptureRow {
  readonly id: string
  readonly request_id: string
  readonly type: string
  readonly stage: string
  readonly prefix: string
  readonly source: string
  readonly provider_id: string
  readonly headers: Record<string, string> | null
  readonly request_body: unknown
  readonly response_body: unknown
  readonly response_status: number
  readonly system_log: readonly string[]
  readonly error: string
  readonly created_at: string
}

// ── Helpers kept verbatim from the previous version ──
function renderBody(title: string, body: unknown) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs font-medium text-foreground">{title}</div>
      <JsonHighlight value={body} />
    </div>
  )
}

function renderHeaders(headers: Record<string, string> | null) {
  if (!headers || Object.keys(headers).length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs font-medium text-foreground">请求头</div>
      <div className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
        {Object.entries(headers).map(([k, v]) => (
          <div key={k} className="truncate">
            <span className="text-muted-foreground">{k}: </span>{v}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Circled numbers for response labels (①-⑯ for 1-16; ⑰-⑳ for 17-20) ──
const CIRCLED_NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯',
  '⑰', '⑱', '⑲', '⑳',
]

function circledNumber(n: number): string {
  if (n < 1 || n > 20) return `(${n})`
  return CIRCLED_NUMBERS[n - 1]
}

// ── Type label recomputed from pair shape (LogCapturePairFull has no type_label field).
// Counts only response nodes that actually have a stage row, matching what's
// rendered below (the backend can produce empty entries from failover retries).
// Suffixes (+报错 / +不完整) mirror the backend's label so the dialog header
// matches the list view.
function computeTypeLabel(pair: LogCapturePairFull): string {
  const hasRequest = !!pair.request
  const live = pair.responses.filter((r) => r.before || r.after)
  const n = live.length
  let base: string
  if (!hasRequest && n > 0) base = '响应'
  else if (hasRequest && n === 0) base = '请求'
  else if (n === 1) base = '请求+响应'
  else base = `请求+响应×${n}`
  const hasError = pair.error !== '' || live.some((r) => r.status >= 400)
  const isIncomplete = hasRequest && live.some((r) => r.before && !r.after)
  if (hasError) base += '+报错'
  if (isIncomplete) base += '+不完整'
  return base
}

// ── Inline hand-rolled collapsible Node (not exported) ──
// `actions` slot lives on the right of the toggle so callers can attach a
// Copy button or other per-section affordances without nesting buttons.
function Node({ label, defaultOpen = true, actions, children }: {
  readonly label: ReactNode
  readonly defaultOpen?: boolean
  readonly actions?: ReactNode
  readonly children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-mono text-xs font-medium text-foreground hover:text-foreground/80"
        >
          <span className="shrink-0 text-muted-foreground">{open ? '▾' : '▸'}</span>
          <span className="truncate">{label}</span>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {open && children && (
        <div className="ml-4 flex flex-col gap-1.5 border-l border-border pl-3">{children}</div>
      )}
    </div>
  )
}

// ── CopyButton: writes text to the clipboard and flashes "已复制" for 1.2s.
// `getText` is a thunk so the copy reads the current value at click time
// (the pair may have reloaded since this button mounted).
function CopyButton({ getText }: { readonly getText: () => string }) {
  const [copied, setCopied] = useState(false)
  const onClick = useCallback(() => {
    const text = getText()
    if (!text) return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        // clipboard unavailable (insecure context) — silently noop
      })
  }, [getText])
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

// ── stageNodeCopyText: builds the plain text representation of a stage row
// for clipboard export. Headers dump as `key: value` lines, body follows
// after a blank line. Streaming bodies keep their raw SSE text; everything
// else serialises as pretty JSON. Modified rows use the `after` stage.
function stageNodeCopyText(node: StageNode): string {
  const row = node.after ?? node.before
  if (!row) return ''
  const parts: string[] = []
  if (row.headers && Object.keys(row.headers).length > 0) {
    parts.push(
      Object.entries(row.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    )
  }
  const rawText = responseStageRawText(row.body)
  const ct = responseStageContentType(row.headers)
  if (rawText !== null && ct.toLowerCase().includes('text/event-stream')) {
    parts.push(rawText)
  } else if (row.body !== null && row.body !== undefined) {
    if (typeof row.body === 'string') {
      parts.push(row.body)
    } else {
      try {
        parts.push(JSON.stringify(row.body, null, 2))
      } catch {
        parts.push(String(row.body))
      }
    }
  }
  return parts.join('\n\n')
}

// ── renderStageBody: headers + body (DiffView when modified, plain pre otherwise) ──
type StageNode = {
  readonly before?: LogCaptureStageRow
  readonly after?: LogCaptureStageRow
  readonly modified: boolean
}

function renderStageBody(node: StageNode): ReactNode {
  const headersEl = renderHeaders(node.before?.headers ?? node.after?.headers ?? null)
  let bodyEl: ReactNode
  if (node.modified) {
    bodyEl = <DiffView before={node.before?.body} after={node.after?.body} />
  } else {
    bodyEl = <JsonHighlight value={node.before?.body ?? node.after?.body} />
  }
  if (headersEl === null && bodyEl === null) return null
  return (
    <>
      {headersEl}
      {bodyEl}
    </>
  )
}

// ── responseStageRawText pulls the raw text out of a stored body shape.
// Capture writer wraps non-JSON string bodies as {raw: "<text>"}; bodies
// that were JSON-parsed at capture time arrive as a map with no "raw".
function responseStageRawText(body: unknown): string | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null
  const v = (body as Record<string, unknown>)['raw']
  return typeof v === 'string' ? v : null
}

function responseStageContentType(headers: Record<string, string> | null): string {
  if (!headers) return ''
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') return v
  }
  return ''
}

// ── ResponseStageBody renders a stage row's body. SSE responses are shown
// as plain text so the raw event stream stays inspectable without parsing.
function ResponseStageBody({ stageRow }: { readonly stageRow: LogCaptureStageRow }) {
  const rawText = responseStageRawText(stageRow.body)
  const contentType = responseStageContentType(stageRow.headers)
  const isSSE = contentType.toLowerCase().includes('text/event-stream')

  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs font-medium text-foreground">响应体</div>
      {isSSE && rawText !== null ? (
        <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {rawText}
        </pre>
      ) : (
        <JsonHighlight value={stageRow.body} />
      )}
    </div>
  )
}



// ── Main export: dispatches on props.kind (exhaustive over the union) ──
export function LogCapturePreviewDialog(props: LogCapturePreviewDialogProps) {
  if (props.kind === 'pair') {
    return <PairDialog requestId={props.requestId} open={props.open} onClose={props.onClose} />
  }
  return <SystemDialog fileId={props.fileId} fileName={props.fileName} open={props.open} onClose={props.onClose} />
}

// ── Timing block: request-level stage timings from the pair read ──
function TimingBlock({ timing }: { timing: LogCaptureTiming }) {
  const fmtMs = (val: number) => (val >= 0 ? `${val}ms` : '-')
  const rows: ReadonlyArray<[string, number]> = [
    ['排队', timing.queueWaitMs],
    ['请求改写', timing.requestRewriteMs],
    ['连接', timing.connectMs],
    ['首字', timing.firstByteMs],
    ['响应改写', timing.responseRewriteMs],
    ['流式改写', timing.streamRewriteMs],
  ]
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-3">
        <h4 className="shrink-0 font-medium text-muted-foreground">耗时</h4>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-baseline gap-2">
            <span className="shrink-0 min-w-[4rem] text-muted-foreground">{label}</span>
            <span className="break-words text-foreground">{fmtMs(val)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pair branch (kind === 'pair') ──
function PairDialog({ requestId, open, onClose }: {
  readonly requestId: string
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [pair, setPair] = useState<LogCapturePairFull | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    if (!requestId) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect -- synchronous reset before the async fetch is the intentional imperative pattern; the cascading-render concern is accepted for the loading/error lifecycle. setState calls inside the .then/.catch/.finally callbacks are not synchronous in the effect body and remain covered by the rule. */
    setLoading(true)
    setError(null)
    setPair(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    dashboardApi
      .readLogCapturePair(requestId)
      .then((data) => {
        if (!cancelled) setPair(data)
      })
      .catch((err: unknown) => {
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
  }, [requestId, open, reloadKey])

  const typeLabel = pair ? computeTypeLabel(pair) : ''

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent width="md" height="auto" className="flex flex-col overflow-hidden !w-[1024px] !max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{pair?.request_id ?? requestId}</span>
            {pair && <Badge variant="default">{typeLabel}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="py-16 text-center text-xs text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <span className="text-xs text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>重试</Button>
            </div>
          ) : pair ? (
            <div className="flex flex-col gap-3">
              {pair.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {pair.error}
                </div>
              )}
              {pair.timing && <TimingBlock timing={pair.timing} />}
              {!pair.request && pair.responses.length === 0 ? (
                <div className="py-16 text-center text-xs text-muted-foreground">暂无内容</div>
              ) : (
                <>
                  {pair.request && (
                    <Node
                      label={
                        <span>请求{pair.request.modified ? <span className="text-amber-600 dark:text-amber-400"> ·修改过</span> : null}</span>
                      }
                      actions={<CopyButton getText={() => stageNodeCopyText(pair.request!)} />}
                    >
                      {renderStageBody(pair.request)}
                    </Node>
                  )}
                  {pair.responses.length > 0 && (
                    <Node label={<span>响应</span>}>
                      {pair.responses.map((resp, i) => {
                        // Skip nodes that have neither before nor after; they
                        // come from a failover attempt that didn't log any
                        // stage rows and would render as an empty expandable
                        // block.
                        if (!resp.before && !resp.after) return null
                        return (
                        <Node
                          key={i}
                          label={
                            <span>
                              响应 {circledNumber(i + 1)}{resp.status ? ` · ${resp.status}` : ''}
                              {resp.modified ? <span className="text-amber-600 dark:text-amber-400"> ·修改过</span> : null}
                            </span>
                          }
                          actions={<CopyButton getText={() => stageNodeCopyText(resp)} />}
                        >
                          <ResponseNodeBody resp={resp} />
                        </Node>
                        )
                      })}
                    </Node>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="py-16 text-center text-xs text-muted-foreground">暂无内容</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ResponseNodeBody: DiffView when modified, otherwise toggle on the
// available stage row (after preferred, falls back to before).
function ResponseNodeBody({ resp }: { readonly resp: import('@/lib/dashboard-api').LogCaptureResponseNode }) {
  if (resp.modified) {
    return <DiffView before={resp.before?.body} after={resp.after?.body} />
  }
  if (resp.after) return <ResponseStageBody stageRow={resp.after} />
  if (resp.before) return <ResponseStageBody stageRow={resp.before} />
  return null
}

// ── System branch (kind === 'system') — kept identical to the previous system branch ──
function SystemDialog({ fileId, fileName, open, onClose }: {
  readonly fileId: string
  readonly fileName: string
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [row, setRow] = useState<LogCaptureRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect -- synchronous reset before the async fetch is the intentional imperative pattern; the cascading-render concern is accepted for the loading/error lifecycle. setState calls inside the .then/.catch/.finally callbacks are not synchronous in the effect body and remain covered by the rule. */
    setLoading(true)
    setError(null)
    setRow(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    dashboardApi
      .readLogCaptureFile(fileId)
      .then((data) => {
        if (!cancelled) setRow(data as LogCaptureRow)
      })
      .catch((err: unknown) => {
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
      <DialogContent width="md" height="auto" className="flex flex-col overflow-hidden !w-[1024px] !max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{fileName}</span>
            {row && <Badge variant="outline">系统</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="py-16 text-center text-xs text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <span className="text-xs text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>重试</Button>
            </div>
          ) : row ? (
            <div className="flex flex-col gap-3">
              {row.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {row.error}
                </div>
              )}
              {row.type === 'system' && row.system_log ? (
                <div className="flex flex-col gap-1.5">
                  <div className="font-mono text-xs font-medium text-foreground">系统日志</div>
                  <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                    {Array.isArray(row.system_log) ? row.system_log.join('\n') : String(row.system_log)}
                  </pre>
                </div>
              ) : (
                <>
                  {renderHeaders(row.headers)}
                  {renderBody('请求体', row.request_body)}
                  {renderBody('响应体', row.response_body)}
                  {row.response_status > 0 && (
                    <div className="text-xs text-muted-foreground">响应状态码: {row.response_status}</div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
