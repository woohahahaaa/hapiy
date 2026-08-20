import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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

// ── Type label recomputed from pair shape (LogCapturePairFull has no type_label field) ──
function computeTypeLabel(pair: LogCapturePairFull): string {
  const hasRequest = !!pair.request
  const n = pair.responses.length
  if (!hasRequest && n > 0) return '响应'
  if (hasRequest && n === 0) return '请求'
  if (n === 1) return '请求+响应'
  return `请求+响应×${n}`
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

// ── RawSseView splits raw SSE text into per-event blocks so chunks are
// readable one by one instead of one escaped line. Each block is collapsed
// by default and shows the data payload's `id` field as its title. Falls
// back to a plain <pre> when the text has no `data:` lines (not an SSE body).
function RawSseView({ text }: { readonly text: string }) {
  const blocks = useMemo(() => {
    if (!/data:/.test(text)) return null
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return normalized.split('\n\n').filter((b) => b.trim() !== '')
  }, [text])

  if (blocks === null) {
    return (
      <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((block, i) => (
        <SseBlock key={i} index={i} block={block} />
      ))}
    </div>
  )
}

// ── SseBlock: one SSE event — collapsed by default, title shows the data
// payload's `id` (falling back to event type when absent).
function SseBlock({ index, block }: { readonly index: number; readonly block: string }) {
  const [open, setOpen] = useState(false)
  const lines = block.split('\n')
  const eventLine = lines.find((l) => l.startsWith('event:'))
  const data = lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n')
  const eventType = eventLine ? eventLine.slice(6).trim() : 'data'
  const isDone = data === '[DONE]'
  const title = useMemo(() => {
    if (isDone) return '[DONE]'
    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        return parsed.id
      }
    } catch {
      // fall through to event type
    }
    return eventType
  }, [data, eventType, isDone])

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border/60 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted/50"
      >
        <span className="shrink-0">{open ? '▾' : '▸'}</span>
        <span className="shrink-0">#{index + 1}</span>
        <span className="truncate font-medium text-foreground/80">{title}</span>
        <span className="ml-auto shrink-0">{isDone ? '0 B' : `${data.length} B`}</span>
      </button>
      {open && (
        <div className="px-2 py-1.5">
          <div className="mb-1 font-mono text-[10px] text-muted-foreground">event: {eventType}</div>
          {isDone ? (
            <div className="font-mono text-[10px] text-muted-foreground">[DONE]</div>
          ) : data ? (
            <JsonHighlight value={data} className="border-0 bg-transparent p-0" />
          ) : (
            <div className="font-mono text-[10px] text-muted-foreground">（无 data）</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ResponseStageBody renders a stage row's body with a 原始内容 / 整合 JSON
// toggle. Toggle is hidden when the stage has no "raw" text or its
// content-type is not SSE.
function ResponseStageBody({ stageRow }: { readonly stageRow: LogCaptureStageRow }) {
  const [mode, setMode] = useState<'raw' | 'merged'>('merged')
  const [merged, setMerged] = useState<unknown>(undefined)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const rawText = responseStageRawText(stageRow.body)
  const contentType = responseStageContentType(stageRow.headers)
  const canMerge = rawText !== null && contentType.toLowerCase().includes('text/event-stream')

  const loadMerged = useCallback(() => {
    const stageNode = findResponseNodeForStageRow(stageRow)
    if (!stageNode) return
    setMergeLoading(true)
    setMergeError(null)
    dashboardApi
      .readLogCaptureMergedResponse(stageNode.requestId, {
        stage: stageNode.stage,
        index: stageNode.index,
      })
      .then((result) => setMerged(result.value))
      .catch((err: unknown) =>
        setMergeError(err instanceof Error ? err.message : '整合失败'),
      )
      .finally(() => setMergeLoading(false))
  }, [stageRow])

  // Eagerly fetch merged JSON on first render when the toggle is visible;
  // this matches the default 'merged' mode and avoids an extra click.
  // setState only happens in async callbacks, never synchronously in the
  // effect body (loading state is implied by merged === undefined).
  useEffect(() => {
    if (!canMerge || merged !== undefined) return
    const stageNode = findResponseNodeForStageRow(stageRow)
    if (!stageNode) return
    let cancelled = false
    dashboardApi
      .readLogCaptureMergedResponse(stageNode.requestId, {
        stage: stageNode.stage,
        index: stageNode.index,
      })
      .then((result) => {
        if (!cancelled) setMerged(result.value)
      })
      .catch((err: unknown) => {
        if (!cancelled) setMergeError(err instanceof Error ? err.message : '整合失败')
      })
      .finally(() => {
        if (!cancelled) setMergeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canMerge, merged, stageRow])

  const switchTo = useCallback(
    (next: 'raw' | 'merged') => {
      setMode(next)
      if (next === 'merged' && merged === undefined && canMerge) loadMerged()
    },
    [merged, canMerge, loadMerged],
  )

  if (!canMerge) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-xs font-medium text-foreground">响应体</div>
        <JsonHighlight value={stageRow.body} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-xs font-medium text-foreground">响应体</div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={mode === 'merged' ? 'default' : 'outline'}
            disabled={mergeLoading}
            onClick={() => switchTo('merged')}
          >
            {mergeLoading ? '整合中…' : '整合JSON'}
          </Button>
          <Button
            size="sm"
            variant={mode === 'raw' ? 'default' : 'outline'}
            onClick={() => switchTo('raw')}
          >
            原始内容
          </Button>
        </div>
      </div>
      {mode === 'merged' ? (
        mergeError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {mergeError}
          </div>
        ) : merged === undefined ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            整合中…
          </div>
        ) : (
          <JsonHighlight value={merged} />
        )
      ) : rawText !== null ? (
        <RawSseView text={rawText} />
      ) : (
        <JsonHighlight value={stageRow.body} />
      )}
    </div>
  )
}

// ── Module-level stage-row registry: ResponseStageBody needs the
// (requestId, stage, index) triple to call readLogCaptureMergedResponse.
// Each row is registered once during render and forgotten on unmount.
const stageRowRegistry = new Map<
  LogCaptureStageRow,
  { readonly requestId: string; readonly stage: 'before' | 'after'; readonly index: number }
>()
function findResponseNodeForStageRow(stageRow: LogCaptureStageRow) {
  return stageRowRegistry.get(stageRow)
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

  // Register each response stage row in the module-level map so
  // ResponseStageBody can resolve its merge-endpoint coords. Entries are
  // removed on unmount or when the pair reloads.
  useEffect(() => {
    if (!pair) return
    const registered: LogCaptureStageRow[] = []
    for (let i = 0; i < pair.responses.length; i++) {
      const node = pair.responses[i]
      if (node.before) {
        stageRowRegistry.set(node.before, { requestId, stage: 'before', index: i })
        registered.push(node.before)
      }
      if (node.after) {
        stageRowRegistry.set(node.after, { requestId, stage: 'after', index: i })
        registered.push(node.after)
      }
    }
    return () => {
      for (const row of registered) stageRowRegistry.delete(row)
    }
  }, [pair, requestId])

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
                      {pair.responses.map((resp, i) => (
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
                      ))}
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
