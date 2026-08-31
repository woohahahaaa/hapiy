import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPathValue(obj: Record<string, unknown>, segments: readonly string[]): unknown {
  let cur: unknown = obj
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

// mergeSyncContent accumulates the per-model sync previews into a single
// document. Each sync call re-reads the file from disk and only carries
// that one model's changes, so we walk each returned content, locate the
// model this round wrote (opencode `provider.<id>` or openclaw
// `models.providers.<id>` shape), and copy it into the merged document at
// the same spot. The first round's full content becomes the skeleton, so
// every checked model's fields end up in the final preview.
function mergeSyncContent(
  merged: Record<string, unknown> | null,
  content: string,
  modelId: string,
): Record<string, unknown> | null {
  let parsed: Record<string, unknown>
  try {
    const raw = JSON.parse(content) as unknown
    if (!isRecord(raw)) return merged
    parsed = raw
  } catch {
    return merged
  }
  const roots: ReadonlyArray<[string, readonly string[]]> = [
    ['models', ['models', 'providers']],
    ['provider', ['provider']],
  ]
  for (const [rootKey, prefix] of roots) {
    const providers = readPathValue(parsed, prefix)
    if (!isRecord(providers)) continue
    const providerKey = Object.keys(providers).find((k) => {
      const p = providers[k]
      return isRecord(p) && isRecord(p.models) && Object.prototype.hasOwnProperty.call(p.models, modelId)
    })
    if (!providerKey) continue
    const p = providers[providerKey] as Record<string, unknown>
    const models = p.models as Record<string, unknown>
    const modelValue = models[modelId]
    if (merged === null) merged = {}
    const root = (merged[rootKey] ?? {}) as Record<string, unknown>
    merged[rootKey] = root
    const provider = (root[providerKey] ?? {}) as Record<string, unknown>
    root[providerKey] = provider
    const nextModels = (provider.models ?? {}) as Record<string, unknown>
    provider.models = nextModels
    nextModels[modelId] = modelValue
    return merged
  }
  return merged
}

// displayValue renders a field value for the diff column.
function displayValue(value: unknown): string {
  return value === undefined || value === null ? '(无)' : JSON.stringify(value)
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
  // checkedByModelId tracks which rows the 保存 button should sync.
  const [checkedByModelId, setCheckedByModelId] = useState<Record<string, boolean>>({})

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

  // Auto-pick the first match per model once sources load, and default
  // every row to checked.
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
    setCheckedByModelId(Object.fromEntries(models.map((m) => [m.id, true])))
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

  const checkedCount = models.filter((m) => checkedByModelId[m.id]).length
  const allChecked = models.length > 0 && checkedCount === models.length

  const toggleAll = () => {
    const next = !allChecked
    setCheckedByModelId(Object.fromEntries(models.map((m) => [m.id, next])))
  }

  // handleSave syncs every checked row. The endpoint always re-reads the
  // file from disk and returns a preview of only that model's changes, so
  // we loop per model and merge the returned contents locally into one
  // document before handing it to the parent for preview.
  const handleSave = async () => {
    if (!record || !providerId) return
    const rows = models
      .filter((m) => checkedByModelId[m.id])
      .map((m) => ({ modelId: m.id, changes: changesFor(m.id) }))
      .filter((r) => r.changes.length > 0)
    if (rows.length === 0) {
      toast('没有勾选的模型存在字段差异')
      return
    }
    setApplying(true)
    try {
      let applied = 0
      let merged: Record<string, unknown> | null = null
      let lastRaw = ''
      for (const { modelId, changes } of rows) {
        const fields: Record<string, unknown> = {}
        for (const c of changes) fields[c.path] = c.newValue
        const res = await dashboardApi.syncAgentConfigFileModelFields(record.id, {
          provider_id: providerId,
          model_id: modelId,
          fields,
        })
        applied += res.applied
        lastRaw = res.content
        merged = mergeSyncContent(merged, res.content, modelId)
      }
      onPreview({ content: merged ? JSON.stringify(merged) : lastRaw, applied })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg" height="auto" className="flex max-h-[70vh] flex-col">
        <DialogHeader>
          <DialogTitle>从模型信息同步模型</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && models.length === 0 && (
            <Placeholder>该供应商下没有可同步的模型</Placeholder>
          )}
          {!loading && !error && models.length > 0 && (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        checked={allChecked ? true : checkedCount > 0 ? 'indeterminate' : false}
                        onCheckedChange={toggleAll}
                        aria-label="全选"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium">模型</th>
                    <th className="min-w-[180px] px-3 py-2 text-left font-medium">数据源选择</th>
                    <th className="px-3 py-2 text-left font-medium">字段调整</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.map((m) => {
                    const candidates = candidatesFor(m.id)
                    const chosen = sourceByModelId[m.id]
                    const changes = changesFor(m.id)
                    return (
                      <tr key={m.id} className="align-top hover:bg-muted">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={!!checkedByModelId[m.id]}
                            onCheckedChange={(v) =>
                              setCheckedByModelId((prev) => ({ ...prev, [m.id]: v === true }))
                            }
                            aria-label={`选择 ${m.id}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{m.id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={chosen}
                            disabled={candidates.length === 0}
                            onValueChange={(v) =>
                              setSourceByModelId((prev) => ({ ...prev, [m.id]: v }))
                            }
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue
                                placeholder={candidates.length === 0 ? '暂无可选' : '选择数据源'}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {candidates.length === 0 ? (
                                <SelectItem value="__none__" disabled>
                                  暂无可选
                                </SelectItem>
                              ) : (
                                candidates.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.model}
                                    {s.providerId ? ` · ${s.providerId}` : ''}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          {changes.length === 0 ? (
                            <div className="text-muted-foreground">—</div>
                          ) : (
                            <ul className="space-y-1.5">
                              {changes.map((c) => (
                                <li key={c.key} className="text-[11px] leading-snug">
                                  <div className="font-medium">{c.label}</div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    <span className="line-through">{displayValue(c.oldValue)}</span>
                                    <span className="mx-1">→</span>
                                    <span>{displayValue(c.newValue)}</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-2">
          <Button
            variant="default"
            disabled={applying || models.length === 0 || checkedCount === 0}
            onClick={() => void handleSave()}
          >
            {applying ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '确认同步'}
          </Button>
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
