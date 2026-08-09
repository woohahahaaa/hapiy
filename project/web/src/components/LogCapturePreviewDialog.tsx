import { useEffect, useState, type ReactNode } from 'react'
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
import { dashboardApi } from '@/lib/dashboard-api'
import type { LogCapturePairFull, LogCaptureStageRow } from '@/lib/dashboard-api'

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
function formatBody(body: unknown): string {
  if (body === null || body === undefined) return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body, null, 2)
}

function renderBody(title: string, body: unknown) {
  const text = formatBody(body)
  if (!text) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-xs font-medium text-foreground">{title}</div>
      <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
        {text}
      </pre>
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
function Node({ label, defaultOpen = true, children }: {
  readonly label: ReactNode
  readonly defaultOpen?: boolean
  readonly children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-left font-mono text-xs font-medium text-foreground hover:text-foreground/80"
      >
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && children && (
        <div className="ml-4 flex flex-col gap-1.5 border-l border-border pl-3">{children}</div>
      )}
    </div>
  )
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
    const text = formatBody(node.before?.body ?? node.after?.body)
    bodyEl = text
      ? <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre">{text}</pre>
      : null
  }
  if (headersEl === null && bodyEl === null) return null
  return (
    <>
      {headersEl}
      {bodyEl}
    </>
  )
}

// ── Main export: dispatches on props.kind (exhaustive over the union) ──
export function LogCapturePreviewDialog(props: LogCapturePreviewDialogProps) {
  if (props.kind === 'pair') {
    return <PairDialog requestId={props.requestId} open={props.open} onClose={props.onClose} />
  }
  return <SystemDialog fileId={props.fileId} fileName={props.fileName} open={props.open} onClose={props.onClose} />
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
              {!pair.request && pair.responses.length === 0 ? (
                <div className="py-16 text-center text-xs text-muted-foreground">暂无内容</div>
              ) : (
                <>
                  {pair.request && (
                    <Node
                      label={
                        <span>请求{pair.request.modified ? <span className="text-amber-600 dark:text-amber-400"> ·修改过</span> : null}</span>
                      }
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
                        >
                          {renderStageBody(resp)}
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
