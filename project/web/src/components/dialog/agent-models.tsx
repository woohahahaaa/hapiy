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
            <Button
              variant="outline"
              size="sm"
              disabled={applying || providerDiff.filter((d) => d.status !== 'ok').length === 0}
              onClick={() => void handleApply('provider')}
            >
              <AppIcon name="auto_fix_high" size={14} data-icon="inline-start" />
              一键套用 provider 推荐值
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                applying ||
                !selectedModel ||
                modelDiff.filter((d) => d.status !== 'ok').length === 0
              }
              onClick={() => void handleApply('model')}
            >
              <AppIcon name="auto_fix_high" size={14} data-icon="inline-start" />
              一键套用模型推荐值
            </Button>
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
            <ColumnHeader>
              {selectedProvider ? `供应商配置 · ${selectedProvider.provider_id}` : '供应商配置'}
            </ColumnHeader>
            <div className="max-h-[40%] overflow-auto border-b border-border p-2">
              {selectedProvider ? (
                <JsonDiffHighlight value={selectedProvider.other_fields} markers={providerDiff} />
              ) : (
                <Placeholder>未选择 provider</Placeholder>
              )}
            </div>
            <ColumnHeader>模型列表</ColumnHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {selectedProvider && selectedProvider.models.length === 0 && (
                <Placeholder>该 provider 下没有模型</Placeholder>
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
            <ColumnHeader>
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

const STATUS_CLASS: Record<DiffStatus, string> = {
  ok: 'border-success/40 bg-success/5',
  missing: 'border-warning/40 bg-warning/10',
  mismatch: 'border-destructive/40 bg-destructive/10',
  extra: 'border-border bg-muted/30',
  'no-recommendation': '',
}

const STATUS_LABEL: Record<DiffStatus, string> = {
  ok: '✓',
  missing: '缺',
  mismatch: '≠',
  extra: '额外',
  'no-recommendation': '',
}

const STATUS_TEXT_CLASS: Record<DiffStatus, string> = {
  ok: 'text-success',
  missing: 'text-warning',
  mismatch: 'text-destructive',
  extra: 'text-muted-foreground',
  'no-recommendation': 'text-muted-foreground',
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
  const byPath = new Map(markers.map((m) => [m.path, m]))
  const lines = formatLines(value)
  return (
    <div className="font-mono text-xs leading-relaxed">
      {lines.map((line, i) => {
        const key = topLevelKey(line)
        const marker = key ? byPath.get(key) : undefined
        const cls = marker ? STATUS_CLASS[marker.status] : ''
        const label = marker ? STATUS_LABEL[marker.status] : ''
        const textCls = marker ? STATUS_TEXT_CLASS[marker.status] : ''
        const recommendedHint =
          marker && marker.recommended !== null && marker.recommended !== undefined
            ? String(marker.recommended)
            : ''
        return (
          <div
            key={i}
            className={
              'group flex items-start gap-2 rounded-none border-l-2 py-0.5 pl-2 pr-1 ' +
              (cls || 'border-transparent')
            }
          >
            <span className={'shrink-0 w-4 text-center font-bold ' + textCls}>
              {label}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">
              <JsonTokens text={line} />
              {marker?.status === 'missing' && recommendedHint && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  推荐: {recommendedHint}
                </span>
              )}
              {marker?.status === 'mismatch' && recommendedHint && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  推荐: {recommendedHint}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function formatLines(value: unknown): string[] {
  const text = JSON.stringify(value, null, 2)
  return text.split('\n')
}

function topLevelKey(line: string): string | null {
  const m = line.match(/^\s*"([^"\\]+)"\s*:/)
  return m ? m[1] : null
}

function ColumnHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
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