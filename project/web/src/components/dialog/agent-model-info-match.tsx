import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { dashboardApi } from '@/lib/dashboard-api'
import {
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentConfigFile,
  type AgentModelInfoFieldPaths,
  type AgentModelProvider,
  type PriceConfig,
} from '@/lib/dashboard-api'

interface AgentModelInfoMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  providerId: string | null
  provider: AgentModelProvider | null
  modelInfoFields: AgentModelInfoFieldPaths
  onPreview: (input: { readonly content: string; readonly applied: number }) => void
}

// fieldValue extracts the raw value at a (possibly dotted) path inside an
// object, mirroring the backend's gjson walk.
function fieldValue(obj: unknown, path: string): unknown {
  if (!path || !obj || typeof obj !== 'object') return undefined
  const segs = path.split('.')
  let cur: unknown = obj
  for (const seg of segs) {
    if (!cur || typeof cur !== 'object') return undefined
    const next = (cur as Record<string, unknown>)[seg]
    if (next === undefined) return undefined
    cur = next
  }
  return cur
}

// coerceToShape adapts a model-info raw value to the shape the agent's
// config expects (boolean field → boolean; number field → number).
function coerceToShape(raw: unknown, targetShape: unknown): unknown {
  if (typeof targetShape === 'boolean') {
    const has = Array.isArray(raw) ? raw.length > 0 : raw !== undefined && raw !== null
    return has
  }
  if (typeof targetShape === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return raw
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface FieldChange {
  readonly key: string
  readonly label: string
  readonly path: string
  readonly oldValue: unknown
  readonly newValue: unknown
}

export function AgentModelInfoMatchDialog({
  open,
  onOpenChange,
  record,
  providerId,
  provider,
  modelInfoFields,
  onPreview,
}: AgentModelInfoMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<readonly PriceConfig[]>([])
  const [applying, setApplying] = useState(false)
  // sourceByModelId holds the currently chosen model-info source per
  // config-model id.
  const [sourceByModelId, setSourceByModelId] = useState<Record<string, string>>({})
  // selectedModelId drives the "right side" change preview.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setSourceByModelId({})
    dashboardApi
      .listPrices({ limit: 1000, offset: 0 })
      .then((res) => setSources(res.prices))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [open])

  const models = useMemo(() => provider?.models ?? [], [provider])

  // Auto-pick the first match per model once sources load.
  useEffect(() => {
    if (!open || sources.length === 0 || models.length === 0) return
    const picks: Record<string, string> = {}
    for (const m of models) {
      const match = findBestMatch(m.id, sources)
      if (match) picks[m.id] = match.id
    }
    setSourceByModelId((prev) => {
      const merged = { ...prev }
      for (const [k, v] of Object.entries(picks)) {
        if (!merged[k]) merged[k] = v
      }
      return merged
    })
    setSelectedModelId(models[0]?.id ?? null)
  }, [open, sources, models])

  const candidatesFor = (modelId: string): readonly PriceConfig[] => {
    const needle = modelId.toLowerCase()
    return sources.filter((s) => {
      const id = s.model.toLowerCase()
      const aliasMatch = s.aliases.some((a) => a.toLowerCase().includes(needle))
      return id === needle || id.includes(needle) || aliasMatch
    })
  }

  const changesFor = (modelId: string): readonly FieldChange[] => {
    const chosenId = sourceByModelId[modelId]
    if (!chosenId) return []
    const src = sources.find((s) => s.id === chosenId)
    const cfg = provider?.models.find((m) => m.id === modelId)?.config
    if (!src || !cfg || typeof cfg !== 'object') return []
    const changes: FieldChange[] = []
    const sourceMap: Record<string, unknown> = {
      max_context: src.contextLength,
      max_output_token: src.maxToken,
      input_types: src.supportedTypes,
      thinking_levels: src.thinkingLevels,
    }
    for (const key of MODEL_INFO_FIELD_KEYS) {
      const path = modelInfoFields[key]
      if (!path) continue
      const raw = sourceMap[key]
      if (raw === undefined || raw === null) continue
      const current = fieldValue(cfg, path)
      const next = coerceToShape(raw, current)
      if (next === undefined) continue
      if (!valuesEqual(current, next)) {
        changes.push({ key, label: MODEL_INFO_FIELD_LABELS[key], path, oldValue: current, newValue: next })
      }
    }
    return changes
  }

  const handleApply = async (modelId: string) => {
    if (!record || !providerId) return
    const chosenId = sourceByModelId[modelId]
    if (!chosenId) return
    const src = sources.find((s) => s.id === chosenId)
    const cfg = provider?.models.find((m) => m.id === modelId)?.config
    if (!src || !cfg || typeof cfg !== 'object') return
    const fields: Record<string, unknown> = {}
    const sourceMap: Record<string, unknown> = {
      max_context: src.contextLength,
      max_output_token: src.maxToken,
      input_types: src.supportedTypes,
      thinking_levels: src.thinkingLevels,
    }
    let count = 0
    for (const key of MODEL_INFO_FIELD_KEYS) {
      const path = modelInfoFields[key]
      if (!path) continue
      const raw = sourceMap[key]
      if (raw === undefined || raw === null) continue
      const current = fieldValue(cfg, path)
      const next = coerceToShape(raw, current)
      if (next === undefined) continue
      if (valuesEqual(current, next)) continue
      fields[path] = next
      count++
    }
    if (count === 0) {
      toast('该模型与所选项无字段差异')
      return
    }
    setApplying(true)
    try {
      const res = await dashboardApi.syncAgentConfigFileModelFields(record.id, {
        provider_id: providerId,
        model_id: modelId,
        fields,
      })
      onPreview({ content: res.content, applied: res.applied })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败')
    } finally {
      setApplying(false)
    }
  }

  const selectedChanges = selectedModelId ? changesFor(selectedModelId) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg" height="full" className="flex flex-col">
        <DialogHeader>
          <DialogTitle>从模型信息同步模型</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && models.length === 0 && (
            <Placeholder>该供应商下没有可同步的模型</Placeholder>
          )}
          {!loading && !error && models.length > 0 && (
            <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(260px,380px)] gap-3">
              <div className="flex min-h-0 flex-col">
                <div className="overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">模型</th>
                        <th className="px-3 py-2 text-left font-medium">数据源选择</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {models.map((m) => {
                        const candidates = candidatesFor(m.id)
                        const chosen = sourceByModelId[m.id]
                        return (
                          <tr
                            key={m.id}
                            className={
                              'cursor-pointer ' +
                              (selectedModelId === m.id ? 'bg-primary/10' : 'hover:bg-muted')
                            }
                            onClick={() => setSelectedModelId(m.id)}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">{m.id}</div>
                            </td>
                            <td className="px-3 py-2">
                              {candidates.length === 0 ? (
                                <span className="text-muted-foreground">暂无匹配模型</span>
                              ) : (
                                <Select
                                  value={chosen}
                                  onValueChange={(v) =>
                                    setSourceByModelId((prev) => ({ ...prev, [m.id]: v }))
                                  }
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue placeholder="选择数据源" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {candidates.map((s) => (
                                      <SelectItem key={s.id} value={s.id}>
                                        {s.model}
                                        {s.providerId ? ` · ${s.providerId}` : ''}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex min-h-0 flex-col gap-2">
                <div className="border-b border-border pb-1 text-xs font-medium text-muted-foreground">
                  将改动的字段
                </div>
                <div className="flex-1 overflow-auto">
                  {!selectedModelId ? (
                    <Placeholder>请选择左侧模型查看变更</Placeholder>
                  ) : selectedChanges.length === 0 ? (
                    <Placeholder>所选数据源与当前配置无字段差异</Placeholder>
                  ) : (
                    <ul className="space-y-1.5">
                      {selectedChanges.map((c) => (
                        <li
                          key={c.key}
                          className="rounded-none border border-warning/30 bg-warning/10 p-2"
                        >
                          <div className="font-medium">{c.label}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-warning">
                            {c.path}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            <span className="line-through">{JSON.stringify(c.oldValue)}</span>
                            <span className="mx-1">→</span>
                            <span>{JSON.stringify(c.newValue)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={applying || !selectedModelId || !sourceByModelId[selectedModelId] || selectedChanges.length === 0}
                  onClick={() => selectedModelId && void handleApply(selectedModelId)}
                >
                  {applying ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '应用所选模型'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function findBestMatch(modelId: string, sources: readonly PriceConfig[]): PriceConfig | null {
  const needle = modelId.toLowerCase()
  const exact = sources.find((s) => s.model.toLowerCase() === needle)
  if (exact) return exact
  const contains = sources.find((s) => s.model.toLowerCase().includes(needle) || needle.includes(s.model.toLowerCase()))
  if (contains) return contains
  const alias = sources.find((s) => s.aliases.some((a) => a.toLowerCase() === needle))
  if (alias) return alias
  return null
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
        'rounded-md border border-dashed border-border p-3 text-xs ' +
        (tone === 'error' ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  )
}