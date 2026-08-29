import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { JsonTokens } from '@/components/JsonHighlight'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi } from '@/lib/dashboard-api'
import type {
  AgentConfigFile,
  AgentModelProvider,
  AgentModelSummary,
  AgentRecommendation,
} from '@/lib/dashboard-api'
import { AgentModelInfoMatchDialog } from '@/components/dialog/agent-model-info-match'

type DiffStatus = 'ok' | 'missing' | 'mismatch' | 'extra' | 'no-recommendation'

interface DiffMarker {
  readonly path: string
  readonly status: DiffStatus
  readonly recommended: unknown
  readonly actual: unknown
}

interface AgentModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  fetchModels: (id: string) => Promise<AgentModelSummary>
}

export function AgentModelsDialog({
  open,
  onOpenChange,
  record,
  fetchModels,
}: AgentModelsDialogProps) {
  const [summary, setSummary] = useState<AgentModelSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [syncingFromInfo, setSyncingFromInfo] = useState(false)

  const reload = () => {
    if (!record) return
    setLoading(true)
    setError(null)
    fetchModels(record.id)
      .then((res) => setSummary(res))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open || !record) return
    setSummary(null)
    setError(null)
    setSelectedProviderId(null)
    setSelectedModelId(null)
    reload()
  }, [open, record]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-select the first provider/model whenever summary arrives/changes.
  useEffect(() => {
    if (!summary) return
    if (selectedProviderId && summary.providers.some((p) => p.provider_id === selectedProviderId)) {
      const provider = summary.providers.find((p) => p.provider_id === selectedProviderId)!
      if (selectedModelId && provider.models.some((m) => m.id === selectedModelId)) return
      setSelectedModelId(provider.models[0]?.id ?? null)
      return
    }
    const first = summary.providers[0]
    setSelectedProviderId(first?.provider_id ?? null)
    setSelectedModelId(first?.models[0]?.id ?? null)
  }, [summary, selectedProviderId, selectedModelId])

  const selectedProvider = useMemo<AgentModelProvider | null>(() => {
    if (!summary || !selectedProviderId) return null
    return summary.providers.find((p) => p.provider_id === selectedProviderId) ?? null
  }, [summary, selectedProviderId])

  const selectedModel = useMemo(() => {
    if (!selectedProvider) return null
    if (!selectedModelId) return null
    return selectedProvider.models.find((m) => m.id === selectedModelId) ?? null
  }, [selectedProvider, selectedModelId])

  const providerRecs = useMemo(
    () => (summary?.recommendations ?? []).filter((r) => r.scope === 'provider'),
    [summary],
  )
  const modelRecs = useMemo(
    () => (summary?.recommendations ?? []).filter((r) => r.scope === 'model'),
    [summary],
  )

  const providerDiff = useMemo(
    () => computeDiff(selectedProvider?.other_fields, providerRecs),
    [selectedProvider, providerRecs],
  )
  const modelDiff = useMemo(
    () => computeDiff(selectedModel?.config, modelRecs),
    [selectedModel, modelRecs],
  )

  const problemCount =
    providerDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length +
    modelDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length

  const handleApply = async (scope: 'provider' | 'model') => {
    if (!record || !selectedProviderId) return
    setApplying(true)
    try {
      const res = await dashboardApi.applyAgentRecommendations(record.id, {
        provider_id: selectedProviderId,
        ...(scope === 'model' && selectedModelId ? { model_id: selectedModelId } : {}),
      })
      toast(`已写入 ${res.applied} 个推荐字段`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '套用失败')
    } finally {
      setApplying(false)
    }
  }

  const handleSelectProvider = (id: string) => {
    setSelectedProviderId(id)
    const provider = summary?.providers.find((p) => p.provider_id === id)
    setSelectedModelId(provider?.models[0]?.id ?? null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="full"
        height="full"
        bare
        showCloseButton={false}
        className="flex flex-col !gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>管理模型 · {record?.record_name ?? ''}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {record?.agent_type ?? ''} · {record?.path ?? ''}
              {problemCount > 0 && (
                <span className="ml-2 text-destructive">· {problemCount} 处与推荐值不符</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}>
              <AppIcon name="close" size={16} />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(320px,1fr)_minmax(360px,1.4fr)] divide-x divide-border">
          {/* Left: providers */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader>供应商</ColumnHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {loading && <Placeholder>加载中…</Placeholder>}
              {error && <Placeholder tone="error">{error}</Placeholder>}
              {!loading && !error && summary && summary.providers.length === 0 && (
                <Placeholder>未解析到任何 provider</Placeholder>
              )}
              {summary?.providers.map((p) => (
                <button
                  key={p.provider_id}
                  type="button"
                  onClick={() => handleSelectProvider(p.provider_id)}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-none px-2 py-1.5 text-left text-xs transition-colors ' +
                    (selectedProviderId === p.provider_id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted')
                  }
                >
                  <span className="truncate font-medium">{p.provider_id}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {p.models.length} 模型
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Middle: provider other_fields + models */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader
              action={
                <Button
                  variant="outline"
                  size="xs"
                  disabled={applying || providerDiff.filter((d) => d.status !== 'ok' && d.status !== 'no-recommendation').length === 0}
                  onClick={() => void handleApply('provider')}
                >
                  <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                  套用推荐值
                </Button>
              }
            >
              {selectedProvider ? `供应商配置 · ${selectedProvider.provider_id}` : '供应商配置'}
            </ColumnHeader>
            <div className="max-h-[40%] overflow-auto border-b border-border p-2">
              {selectedProvider ? (
                <JsonDiffHighlight value={selectedProvider.other_fields} markers={providerDiff} />
              ) : (
                <Placeholder>未选择供应商</Placeholder>
              )}
            </div>
            <ColumnHeader
              action={
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!selectedProvider || !selectedModelId}
                  onClick={() => setSyncingFromInfo(true)}
                  title="从我们维护的模型信息（models.dev）同步到当前模型"
                >
                  <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                  从模型信息同步模型基本配置
                </Button>
              }
            >
              模型列表
            </ColumnHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {selectedProvider && selectedProvider.models.length === 0 && (
                <Placeholder>该供应商下没有模型</Placeholder>
              )}
              {selectedProvider?.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModelId(m.id)}
                  className={
                    'flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-xs transition-colors ' +
                    (selectedModelId === m.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted')
                  }
                >
                  <AppIcon name="robot" size={12} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{m.id}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: model config */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader
              action={
                <Button
                  variant="outline"
                  size="xs"
                  disabled={
                    applying ||
                    !selectedModel ||
                    modelDiff.filter((d) => d.status !== 'ok' && d.status !== 'no-recommendation').length === 0
                  }
                  onClick={() => void handleApply('model')}
                >
                  <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                  套用推荐值
                </Button>
              }
            >
              {selectedModel ? `模型配置 · ${selectedModel.id}` : '模型配置'}
            </ColumnHeader>
            <div className="flex-1 overflow-auto p-2">
              {selectedModel ? (
                <JsonDiffHighlight value={selectedModel.config} markers={modelDiff} />
              ) : (
                <Placeholder>未选择模型</Placeholder>
              )}
            </div>
          </div>
        </div>

        <AgentModelInfoMatchDialog
          open={syncingFromInfo}
          onOpenChange={setSyncingFromInfo}
          record={record}
          providerId={selectedProviderId}
          modelId={selectedModelId}
          onApplied={reload}
        />
      </DialogContent>
    </Dialog>
  )
}

function computeDiff(
  value: unknown,
  recs: readonly AgentRecommendation[],
): readonly DiffMarker[] {
  const out: DiffMarker[] = []
  const recByKey = new Map(recs.map((r) => [r.key, r]))
  const visited = new Set<string>()

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      const rec = recByKey.get(key)
      if (rec) {
        visited.add(key)
        out.push(evaluateMarker(key, (value as Record<string, unknown>)[key], rec))
      }
    }
  }

  // Recommendations for keys that aren't present.
  for (const rec of recs) {
    if (visited.has(rec.key)) continue
    out.push({
      path: rec.key,
      status: 'missing',
      recommended: rec.recommended,
      actual: undefined,
    })
  }
  return out
}

function evaluateMarker(key: string, actual: unknown, rec: AgentRecommendation): DiffMarker {
  if (rec.recommended === null || rec.recommended === undefined) {
    return { path: key, status: 'no-recommendation', recommended: null, actual }
  }
  if (deepEqual(rec.recommended, actual)) {
    return { path: key, status: 'ok', recommended: rec.recommended, actual }
  }
  return { path: key, status: 'mismatch', recommended: rec.recommended, actual }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    for (const k of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}

function JsonDiffHighlight({
  value,
  markers,
}: {
  value: unknown
  markers: readonly DiffMarker[]
}) {
  if (value === null || value === undefined) {
    return <Placeholder>为空</Placeholder>
  }
  const lines = buildUnifiedDiff(value, markers)
  return (
    <div className="font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} />
      ))}
    </div>
  )
}

interface DiffRowData {
  readonly prefix: ' ' | '-' | '+'
  readonly text: string
  readonly status?: DiffStatus
}

const PREFIX_BG: Record<DiffRowData['prefix'], string> = {
  ' ': '',
  '-': 'bg-destructive/10',
  '+': 'bg-success/10',
}

const PREFIX_COLOR: Record<DiffRowData['prefix'], string> = {
  ' ': 'text-muted-foreground/40',
  '-': 'text-destructive',
  '+': 'text-success',
}

function DiffRow({ line }: { line: DiffRowData }) {
  const statusText =
    line.status === 'missing'
      ? '缺'
      : line.status === 'mismatch'
        ? '≠'
        : line.status === 'ok'
          ? '✓'
          : ''
  return (
    <div className={'flex items-start gap-1 ' + PREFIX_BG[line.prefix]}>
      <span
        className={
          'w-3 shrink-0 select-none text-center font-bold ' + PREFIX_COLOR[line.prefix]
        }
      >
        {line.prefix === ' ' ? '' : line.prefix}
      </span>
      <span className="w-3 shrink-0 select-none text-center text-[10px] text-muted-foreground">
        {statusText}
      </span>
      <span className="flex-1 whitespace-pre-wrap break-all">
        <JsonTokens text={line.text} />
      </span>
    </div>
  )
}

// buildUnifiedDiff produces a unified-diff-style rendering of an object
// against a recommendation set. Each diff row has a prefix of ` ` (no
// change), `-` (actual — to be removed), or `+` (recommended — to be
// added). Nested objects are walked recursively so recommendations like
// `options.timeout` can target a leaf inside the rendered tree.
function buildUnifiedDiff(value: unknown, recs: readonly AgentRecommendation[]): DiffRowData[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [
      {
        prefix: ' ',
        text: JSON.stringify(value, null, 2),
        status: 'no-recommendation',
      },
    ]
  }
  const out: DiffRowData[] = []
  out.push({ prefix: ' ', text: '{' })
  out.push(...renderObject(value as Record<string, unknown>, recs, 1))
  out.push({ prefix: ' ', text: '}' })
  return out
}

function renderObject(
  obj: Record<string, unknown>,
  recs: readonly AgentRecommendation[],
  indent: number,
): DiffRowData[] {
  const pad = '  '.repeat(indent)
  const out: DiffRowData[] = []

  // Split recs by whether their key targets this scope directly or a
  // descendant. Descendant recs are re-rooted with the first segment
  // stripped so the recursive call can apply them at the right depth.
  const directRecs = new Map<string, AgentRecommendation>()
  const nestedByFirst = new Map<string, AgentRecommendation[]>()
  for (const r of recs) {
    const dot = r.key.indexOf('.')
    if (dot < 0) {
      directRecs.set(r.key, r)
    } else {
      const first = r.key.substring(0, dot)
      const rest = r.key.substring(dot + 1)
      const sub: AgentRecommendation = { ...r, key: rest }
      const arr = nestedByFirst.get(first) ?? []
      arr.push(sub)
      nestedByFirst.set(first, arr)
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    const directRec = directRecs.get(k)
    const nestedRecs = nestedByFirst.get(k) ?? []

    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push({ prefix: ' ', text: `${pad}"${k}": {` })
      out.push(...renderObject(v as Record<string, unknown>, nestedRecs, indent + 1))
      out.push({ prefix: ' ', text: `${pad}}` })
      if (directRec) {
        const status = computeStatus(v, directRec)
        if (status !== 'no-recommendation' && status !== 'ok') {
          out[out.length - 2] = { ...out[out.length - 2], status }
        }
      }
      continue
    }

    const valText = formatValue(v)
    const status = directRec ? computeStatus(v, directRec) : 'no-recommendation'
    if (status === 'mismatch') {
      out.push({ prefix: '-', text: `${pad}"${k}": ${valText}`, status: 'mismatch' })
      out.push({
        prefix: '+',
        text: `${pad}"${k}": ${formatValue(directRec!.recommended)}`,
        status: 'mismatch',
      })
    } else {
      out.push({ prefix: ' ', text: `${pad}"${k}": ${valText}`, status })
    }
  }

  for (const [k, r] of directRecs) {
    if (k in obj) continue
    out.push({
      prefix: '+',
      text: `${pad}"${k}": ${formatValue(r.recommended)}`,
      status: 'missing',
    })
  }

  return out
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function computeStatus(actual: unknown, rec: AgentRecommendation): DiffStatus {
  if (rec.recommended === null || rec.recommended === undefined) {
    return 'no-recommendation'
  }
  return deepEqual(rec.recommended, actual) ? 'ok' : 'mismatch'
}

function ColumnHeader({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">{children}</span>
      {action}
    </div>
  )
}

function Placeholder({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <div
      className={
        'p-3 text-xs ' +
        (tone === 'error' ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  )
}