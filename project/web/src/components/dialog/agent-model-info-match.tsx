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
  findModelsDevProviderRow,
  loadModelsDevModels,
  providersForModel,
  type ModelsDevModel,
} from '@/lib/models-dev'
import {
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentConfigFile,
  type AgentModelConfigSource,
  type AgentModelConfigSources,
  type AgentModelInfoFieldPaths,
  type AgentModelProvider,
  type Provider,
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
      if (!isRecord(p)) return false
      if (isRecord(p.models)) return Object.prototype.hasOwnProperty.call(p.models, modelId)
      if (Array.isArray(p.models)) {
        return p.models.some((m) => isRecord(m) && String((m as Record<string, unknown>).id) === modelId)
      }
      return false
    })
    if (!providerKey) continue
    const p = providers[providerKey] as Record<string, unknown>
    const models = p.models
    let modelValue: unknown
    if (isRecord(models)) {
      modelValue = models[modelId]
    } else {
      const arr = Array.isArray(models) ? (models as unknown[]) : []
      const idx = arr.findIndex((m) => isRecord(m) && String((m as Record<string, unknown>).id) === modelId)
      if (idx < 0) continue
      modelValue = arr[idx]
    }
    if (merged === null) merged = {}
    const root = (merged[rootKey] ?? {}) as Record<string, unknown>
    merged[rootKey] = root
    const provRoot = (root[providerKey] ?? { ...p }) as Record<string, unknown>
    if (isRecord(provRoot.models)) {
      provRoot.models = { ...{ ...(isRecord(provRoot.models) ? provRoot.models : {}) }, [modelId]: modelValue }
    } else {
      const arr = Array.isArray(provRoot.models) ? [...provRoot.models] : []
      const idx = arr.findIndex((m) => isRecord(m) && String((m as Record<string, unknown>).id) === modelId)
      if (idx >= 0) arr[idx] = modelValue
      provRoot.models = arr
    }
    root[providerKey] = provRoot
    break
  }
  return merged
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// A 模型配置参考供应商 option for one config model. Options are built fresh
// on every open: 不同步 (none), each models.dev supplier for the model (self),
// and one entry per our provider carrying the same-named model with a
// reference set (link, kept separate on purpose — no dedup). Only the
// *reference* is carried; linked values resolve to nothing persisted.
type SourceOption =
  | { readonly kind: 'none'; readonly key: string }
  | { readonly kind: 'self'; readonly key: string; readonly supplier: string }
  | { readonly kind: 'link'; readonly key: string; readonly sourceProviderId: string; readonly sourceProviderName: string; readonly referenceName: string }

type ResolvedStatus =
  | { readonly status: 'none' }
  | { readonly status: 'row'; readonly row: ModelsDevModel }
  | { readonly status: 'lost' }
  | { readonly status: 'unknown' }

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
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [allProviders, setAllProviders] = useState<readonly Provider[]>([])
  const [persisted, setPersisted] = useState<AgentModelConfigSources>({})
  const [optionByModelId, setOptionByModelId] = useState<Record<string, string>>({})
  const [checkedByModelId, setCheckedByModelId] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setOptionByModelId({})
    setCheckedByModelId({})
    const load = async () => {
      try {
        const [models, providers, sources] = await Promise.all([
          loadModelsDevModels(),
          dashboardApi.listProviders({ limit: 10000, offset: 0 }),
          record ? dashboardApi.getAgentModelConfigSources(record.id) : Promise.resolve({}),
        ])
        setSnapshot(models)
        setAllProviders(providers.providers)
        setPersisted(sources)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [open, record])

  const models = useMemo(() => provider?.models ?? [], [provider])

  // Candidate options for one config model. Self options are the models.dev
  // suppliers carrying the model; link options are one entry per our
  // provider whose same-named model has a 模型价格参考供应商 set.
  const buildOptions = useMemo(() => (modelId: string): readonly SourceOption[] => {
    const opts: SourceOption[] = [{ kind: 'none', key: 'none' }]
    for (const candidate of providersForModel(snapshot ?? [], modelId)) {
      opts.push({ kind: 'self', key: `self:${candidate.providerName}`, supplier: candidate.providerName })
    }
    for (const p of allProviders) {
      const match = p.models.find((m) =>
        m.referenceProvider !== null &&
        m.model.trim().toLowerCase() === modelId.trim().toLowerCase(),
      )
      if (match) {
        opts.push({
          kind: 'link',
          key: `link:${p.id}`,
          sourceProviderId: p.id,
          sourceProviderName: p.name,
          referenceName: match.referenceProvider ?? '',
        })
      }
    }
    return opts
  }, [snapshot, allProviders])

  const isEmptyLifetime = (obj: Record<string, unknown>): boolean => Object.keys(obj).length === 0

  // Prefill each row from the persisted selection (kept even when its target
  // vanished so the 丢失 state can render), else the first link candidate,
  // else the first models.dev match, else 不同步. In-session edits are never
  // overwritten; the checkbox set defaults to checked once.
  useEffect(() => {
    if (!open || snapshot === null || models.length === 0) return
    setOptionByModelId((prev) => {
      const merged = { ...prev }
      for (const m of models) {
        if (merged[m.id] !== undefined) continue
        const opts = buildOptions(m.id)
        const sourcesForProvider = persisted[providerId ?? ''] ?? {}
        const saved = sourcesForProvider[m.id]
        let picked: string | null = null
        if (saved) {
          if (saved.mode === 'self') {
            picked = opts.find((o) => o.kind === 'self' && saved.self_supplier !== '' && o.supplier.toLowerCase() === saved.self_supplier.toLowerCase())?.key ?? null
            if (!picked && saved.self_supplier) picked = `self:${saved.self_supplier}`
          } else if (saved.mode === 'link') {
            picked = opts.find((o) => o.kind === 'link' && saved.link_provider_id !== '' && o.sourceProviderId === saved.link_provider_id)?.key ?? null
            if (!picked && saved.link_provider_id) picked = `link:${saved.link_provider_id}`
          } else {
            picked = 'none'
          }
        }
        if (!picked) {
          picked = opts.find((o) => o.kind === 'link')?.key
            ?? opts.find((o) => o.kind === 'self')?.key
            ?? 'none'
        }
        merged[m.id] = picked
      }
      return merged
    })
    setCheckedByModelId((prev) => (isEmptyLifetime(prev) ? Object.fromEntries(models.map((m) => [m.id, true])) : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot, models, persisted, providerId, buildOptions])

  // Resolve a selected option against live data. Link options report lost
  // when our provider no longer carries it (or its reference supplier is no
  // longer on models.dev for the model); self options report unknown when
  // models.dev has no (model, supplier) row.
  const resolvedFor = (modelId: string, option: string | undefined): ResolvedStatus => {
    const opt = buildOptions(modelId).find((o) => o.key === option)
    if (!opt || opt.kind === 'none') {
      if (option && option.startsWith('link:')) return { status: 'lost' }
      if (option && option.startsWith('self:')) return { status: 'unknown' }
      return { status: 'none' }
    }
    if (opt.kind === 'self') {
      const row = findModelsDevProviderRow(snapshot ?? [], modelId, opt.supplier)
      return row ? { status: 'row', row } : { status: 'unknown' }
    }
    const row = findModelsDevProviderRow(snapshot ?? [], modelId, opt.referenceName)
    return row ? { status: 'row', row } : { status: 'lost' }
  }

  const sourceMapFor = (row: ModelsDevModel): Record<string, unknown> => {
    const types = [...new Set([...row.inputTypes, ...row.outputTypes])]
    return {
      max_context: row.contextLength > 0 ? row.contextLength : undefined,
      max_output_token: row.maxOutput > 0 ? row.maxOutput : undefined,
      input_types: types.length > 0 ? types : undefined,
      thinking_levels: row.reasoning ? ['high'] : [],
    }
  }

  const changesFor = (modelId: string): readonly FieldChange[] => {
    const chosen = optionByModelId[modelId]
    const resolved = resolvedFor(modelId, chosen)
    if (resolved.status !== 'row') return []
    const cfg = provider?.models.find((m) => m.id === modelId)?.config
    if (!cfg || typeof cfg !== 'object') return []
    const sourceMap = sourceMapFor(resolved.row)
    const changes: FieldChange[] = []
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

  const checkedCount = models.filter((m) => !!checkedByModelId[m.id]).length
  const allChecked = models.length > 0 && checkedCount === models.length

  const toggleAll = () => {
    const next = !allChecked
    setCheckedByModelId(Object.fromEntries(models.map((m) => [m.id, next])))
  }

  const persistable = (option: string): { mode: 'none' | 'self' | 'link'; self_supplier: string; link_provider_id: string } => {
    if (option === 'none') return { mode: 'none', self_supplier: '', link_provider_id: '' }
    if (option.startsWith('link:')) return { mode: 'link', self_supplier: '', link_provider_id: option.slice('link:'.length) }
    return { mode: 'self', self_supplier: option.slice('self:'.length), link_provider_id: '' }
  }

  const handleSave = async () => {
    if (!record || !providerId) return
    const perModel: Record<string, AgentModelConfigSource> = {}
    for (const m of models) {
      perModel[m.id] = persistable(optionByModelId[m.id] ?? 'none')
    }
    const sources: AgentModelConfigSources = { [providerId]: perModel }
    const rows = models
      .filter((m) => !!checkedByModelId[m.id] && changesFor(m.id).length > 0)
      .map((m) => ({ modelId: m.id, changes: changesFor(m.id) }))
    if (rows.length === 0) {
      toast('没有勾选的模型存在可应用的字段差异')
      return
    }
    setApplying(true)
    try {
      await dashboardApi.saveAgentModelConfigSources(record.id, sources)
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
          <DialogTitle>同步模型参考配置</DialogTitle>
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
                    <th className="min-w-[220px] px-3 py-2 text-left font-medium">模型配置参考供应商</th>
                    <th className="min-w-[260px] px-3 py-2 text-left font-medium">将应用的修改</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.map((m) => {
                    const opts = buildOptions(m.id)
                    const chosen = optionByModelId[m.id] ?? 'none'
                    const changes = changesFor(m.id)
                    const resolved = resolvedFor(m.id, chosen)
                    const staleLink = chosen.startsWith('link:') && !opts.some((o) => o.kind === 'link' && o.key === chosen)
                    const staleSelf = chosen.startsWith('self:') && !opts.some((o) => o.kind === 'self' && o.key === chosen)
                    const staleSelfName = chosen.slice('self:'.length)
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
                            onValueChange={(v) =>
                              setOptionByModelId((prev) => ({ ...prev, [m.id]: v }))
                            }
                          >
                            <SelectTrigger
                              className={`h-7 text-xs ${staleLink ? 'border-destructive ring-1 ring-destructive/30' : ''}`}
                            >
                              <SelectValue placeholder="不同步" />
                            </SelectTrigger>
                            <SelectContent>
                              {staleSelf && (
                                <SelectItem value={chosen}>{staleSelfName}（自选的供应商已失效）</SelectItem>
                              )}
                              {staleLink && (
                                <SelectItem value={chosen}>同步的供应商信息丢失</SelectItem>
                              )}
                              {opts.map((o) => (
                                <SelectItem key={o.key} value={o.key}>
                                  {o.kind === 'none'
                                    ? '不同步'
                                    : o.kind === 'self'
                                      ? o.supplier
                                      : `${o.referenceName}（同步于我们的${o.sourceProviderName}配置）`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {staleLink && (
                            <p className="mt-1 text-[11px] text-destructive">
                              该联动来源已丢失，右侧不会产生可应用的修改。
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {resolved.status === 'none' ? (
                            <div className="text-muted-foreground">—</div>
                          ) : resolved.status === 'lost' ? (
                            <div className="text-[11px] text-destructive">同步的供应商信息丢失</div>
                          ) : resolved.status === 'unknown' ? (
                            <div className="text-[11px] text-muted-foreground">未在 models.dev 查到该模型信息</div>
                          ) : changes.length === 0 ? (
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
            disabled={applying || loading || models.length === 0 || checkedCount === 0}
            onClick={() => void handleSave()}
          >
            {applying ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '确认应用'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
        'rounded-md border border-dashed border-border p-3 text-xs ' +
        (tone === 'error' ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  )
}