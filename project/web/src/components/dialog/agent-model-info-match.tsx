import { Fragment, useEffect, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
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
import { findModelsDevProviderRow, isModelsDevLab, loadModelsDevModels, providersForModel, type ModelsDevModel } from '@/lib/models-dev'
import {
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentConfigFile,
  type AgentModelConfigSources,
  type AgentModelInfoFieldPaths,
  type AgentModelInfoFieldSpec,
  type AgentModelProvider,
  type AgentProtocol,
  type AgentRecommendation,
} from '@/lib/dashboard-api'

interface AgentModelInfoMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  /** 全文件模式：文件里全部 provider（含各自 models），跨 provider 聚合展示。 */
  providers: readonly AgentModelProvider[]
  modelInfoFields: AgentModelInfoFieldPaths
  /** 规则推荐（common + protocols），弹窗内按 provider 匹配后计算 diff 与应用。 */
  recommendations: readonly AgentRecommendation[]
  protocols: readonly AgentProtocol[]
  onPreview: (input: { readonly content: string; readonly applied: number }) => void
}

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

function applySpecOp(raw: unknown, spec: AgentModelInfoFieldSpec): unknown {
  switch (spec.op) {
    case 'bool': {
      if (raw === undefined || raw === null) return undefined
      return Array.isArray(raw) ? raw.length > 0 : Boolean(raw)
    }
    case 'first':
      return Array.isArray(raw) && raw.length > 0 ? raw[0] : undefined
    case 'join':
      return Array.isArray(raw) && raw.length > 0 ? raw.join(spec.sep ?? ',') : undefined
    default:
      if (raw === undefined || raw === null) return undefined
      if (Array.isArray(raw) && raw.length === 0) return undefined
      return raw
  }
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

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// protocolMatches: 用现有 agent-models 相同规则判断协议是否作用于该
// provider（对照其配置字段与协议条件）。
function protocolMatchesProviderConfig(cfg: unknown, protocol: AgentProtocol): boolean {
  if ((protocol.conditions ?? []).length === 0) return false
  for (const cond of protocol.conditions) {
    const actual = fieldValue(cfg, cond.field)
    const asString = actual === undefined || actual === null ? '' : String(actual)
    switch (cond.op) {
      case 'equals': if (asString === cond.value) return true; break
      case 'not_equals': if (asString !== cond.value) return true; break
      case 'contains': if (asString.includes(cond.value)) return true; break
      case 'not_contains': if (!asString.includes(cond.value)) return true; break
    }
  }
  return false
}

export function AgentModelInfoMatchDialog({
  open,
  onOpenChange,
  record,
  providers,
  modelInfoFields,
  recommendations,
  protocols,
  onPreview,
}: AgentModelInfoMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [checkedProviders, setCheckedProviders] = useState<Record<string, boolean>>({})
  const [checkedModels, setCheckedModels] = useState<Record<string, boolean>>({})
  const [supplierByModelId, setSupplierByModelId] = useState<Record<string, string>>({})
  const [persistedSources, setPersistedSources] = useState<AgentModelConfigSources | null>(null)
  const [applying, setApplying] = useState(false)
  const [_savingSources, setSavingSources] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setCheckedProviders({})
    setCheckedModels({})
    setSupplierByModelId({})
    setPersistedSources(null)
    let cancelled = false
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) setSnapshot(models)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    if (record) {
      dashboardApi
        .getAgentModelConfigSources(record.id)
        .then((sources) => {
          if (!cancelled) setPersistedSources(sources)
        })
        .catch(() => {
          // 持久化加载失败不阻断弹窗，仅失去上次选择预填。
        })
    }
    return () => { cancelled = true }
  }, [open, record])

  // provider 有效推荐（common + 匹配协议）。与主弹窗 effectiveProviderRecs
  // 同语义。
  const effectiveRecsFor = (p: AgentModelProvider) => {
    const base: AgentRecommendation[] = [...recommendations.filter((r) => r.scope === 'provider')]
    for (const proto of protocols) {
      if (protocolMatchesProviderConfig(p.other_fields, proto)) {
        base.push(...proto.recommendations.filter((r) => r.scope === 'provider'))
      }
    }
    return base
  }
  const effectiveModelRecsFor = (p: AgentModelProvider) => {
    const base: AgentRecommendation[] = [...recommendations.filter((r) => r.scope === 'model')]
    for (const proto of protocols) {
      if (protocolMatchesProviderConfig(p.other_fields, proto)) {
        base.push(...proto.recommendations.filter((r) => r.scope === 'model'))
      }
    }
    return base
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

  const sourceFor = (modelId: string): ModelsDevModel | null => {
    const supplier = supplierByModelId[modelId]
    if (!supplier) return null
    return findModelsDevProviderRow(snapshot ?? [], modelId, supplier)
  }

  // 单个模型的基础字段变更（models.dev 参考供应商）。
  const modelInfoChangesFor = (config: unknown, modelId: string): FieldChange[] => {
    const source = sourceFor(modelId)
    if (!source) return []
    if (!config || typeof config !== 'object') return []
    const sourceMap = sourceMapFor(source)
    const changes: FieldChange[] = []
    for (const key of MODEL_INFO_FIELD_KEYS) {
      const spec = modelInfoFields[key]
      const path = typeof spec === 'string' ? spec : spec.path
      if (!path) continue
      const raw = sourceMap[key]
      if (raw === undefined || raw === null) continue
      const current = fieldValue(config, path)
      const next = typeof spec === 'string' ? coerceToShape(raw, current) : applySpecOp(raw, spec)
      if (next === undefined) continue
      if (!valuesEqual(current, next)) {
        changes.push({ key, label: MODEL_INFO_FIELD_LABELS[key], path, oldValue: current, newValue: next })
      }
    }
    return changes
  }

  // 模型级模板推荐字段 diff。
  const modelRecChangesFor = (config: unknown, provider: AgentModelProvider): FieldChange[] => {
    const recs = effectiveModelRecsFor(provider)
    const changes: FieldChange[] = []
    for (const r of recs) {
      if (r.recommended === null || r.recommended === undefined) {
        const current = fieldValue(config, r.key)
        if (!valuesEqual(current, undefined)) {
          changes.push({ key: r.key, label: r.key, path: r.key, oldValue: current, newValue: undefined })
        }
        continue
      }
      const current = fieldValue(config, r.key)
      if (!valuesEqual(current, r.recommended)) {
        changes.push({ key: r.key, label: r.key, path: r.key, oldValue: current, newValue: r.recommended })
      }
    }
    return changes
  }

  // provider 级模板推荐 diff。
  const providerRecChangesFor = (p: AgentModelProvider): FieldChange[] => {
    const recs = effectiveRecsFor(p)
    const changes: FieldChange[] = []
    for (const r of recs) {
      if (r.recommended === null || r.recommended === undefined) {
        const current = fieldValue(p.other_fields, r.key)
        if (!valuesEqual(current, undefined)) {
          changes.push({ key: r.key, label: r.key, path: r.key, oldValue: current, newValue: undefined })
        }
        continue
      }
      const current = fieldValue(p.other_fields, r.key)
      if (!valuesEqual(current, r.recommended)) {
        changes.push({ key: r.key, label: r.key, path: r.key, oldValue: current, newValue: r.recommended })
      }
    }
    return changes
  }

  const modelKey = (providerId: string, modelId: string) => `${providerId}\u0000${modelId}`
  const providerCheckedCount = providers.filter((p) => checkedProviders[p.provider_id]).length
  const modelCheckedCount = providers.reduce(
    (n, p) => n + p.models.filter((m) => checkedModels[modelKey(p.provider_id, m.id)]).length,
    0,
  )

  // 参考供应商预填：优先使用上次持久化的选择（同样会校验候选有效，
  // 若上次的参考厂商这次已不在候选则留空让用户重新选择）；没有上次
  // 选择时才取每个模型首个候选（与旧逻辑一致）。
  useEffect(() => {
    if (!open) return
    let changed = false
    const next: Record<string, string> = { ...supplierByModelId }
    for (const p of providers) {
      for (const m of p.models) {
        if (next[m.id] !== undefined) continue
        const persisted = persistedSources?.[p.provider_id]?.[m.id]
        const candidates = providersForModel(snapshot ?? [], m.id)
        if (persisted?.mode === 'self' && persisted.self_supplier) {
          if (candidates.some((x) => x.providerName === persisted.self_supplier)) {
            next[m.id] = persisted.self_supplier
            changed = true
          }
          continue
        }
        if (candidates.length > 0) {
          next[m.id] = candidates[0].providerName
          changed = true
        }
      }
    }
    if (changed) setSupplierByModelId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot, providers, persistedSources])

  // 一键官方：所有模型设为官方（lab）参考厂商；模型没有官方来源时
  // 取其候选列表第一个（官方优先排序后的首位，即字母序第一个）。
  const applyOfficialToAll = () => {
    if (snapshot === null) return
    let changed = false
    const next: Record<string, string> = { ...supplierByModelId }
    for (const p of providers) {
      for (const m of p.models) {
        const c = providersForModel(snapshot, m.id)
        if (c.length === 0) continue
        next[m.id] = c[0].providerName
        if (supplierByModelId[m.id] !== next[m.id]) changed = true
      }
    }
    setSupplierByModelId(next)
    void persistSources(next)
    toast(changed ? '已把全部模型设为官方参考厂商（无官方的取候选第一个）' : '模型均已是最佳参考厂商')
  }

  // persistSources 把当前每个模型的参考厂商选择按「配置文件 + provider + model」
  // 持久化保存，下次打开使用推荐配置时默认填回。
  const persistSources = async (next: Record<string, string>) => {
    if (!record) return
    setSavingSources(true)
    try {
      const sources: Record<string, Record<string, {
        mode: 'none' | 'self' | 'link'
        self_supplier: string
        link_provider_id: string
      }>> = {}
      for (const p of providers) {
        for (const m of p.models) {
          const supplier = next[m.id]
          if (!supplier) continue
          sources[p.provider_id] ??= {}
          sources[p.provider_id][m.id] = {
            mode: 'self',
            self_supplier: supplier,
            link_provider_id: '',
          }
        }
      }
      await dashboardApi.saveAgentModelConfigSources(record.id, sources)
    } catch {
      toast.error('保存参考厂商选择失败')
    } finally {
      setSavingSources(false)
    }
  }

  const handleApply = async () => {
    if (!record) return
    if (providerCheckedCount === 0 && modelCheckedCount === 0) {
      toast('请至少勾选一个供应商或模型')
      return
    }
    setApplying(true)
    try {
      // checked: provider_id → 勾选模型列表（空=全模型）。
      const checked: Record<string, readonly string[]> = {}
      const modelFields: Record<string, Record<string, Record<string, unknown>>> = {}
      for (const p of providers) {
        const providerWantsDefaults = checkedProviders[p.provider_id]
        const modelIds = p.models
          .filter((m) => checkedModels[modelKey(p.provider_id, m.id)])
          .map((m) => m.id)
        if (!providerWantsDefaults && modelIds.length === 0) continue
        checked[p.provider_id] = providerWantsDefaults ? [] : modelIds
        // 勾选模型的 models.dev 基础字段。
        if (modelIds.length > 0) {
          modelFields[p.provider_id] = {}
          for (const m of p.models) {
            if (!modelIds.includes(m.id)) continue
            const source = sourceFor(m.id)
            if (!source) continue
            const sourceMap = sourceMapFor(source)
            const fields: Record<string, unknown> = {}
            for (const key of MODEL_INFO_FIELD_KEYS) {
              const spec = modelInfoFields[key]
              const path = typeof spec === 'string' ? spec : spec.path
              if (!path) continue
              const raw = sourceMap[key]
              if (raw === undefined || raw === null) continue
              const current = fieldValue(m.config, path)
              const next = typeof spec === 'string' ? coerceToShape(raw, current) : applySpecOp(raw, spec)
              if (next === undefined) continue
              if (valuesEqual(current, next)) continue
              fields[path] = next
            }
            if (Object.keys(fields).length > 0) modelFields[p.provider_id][m.id] = fields
          }
        }
      }
      const res = await dashboardApi.applyRecommendationConfig(record.id, checked, modelFields)
      if (res.applied === 0) {
        toast('没有可应用的变更（勾选项均已符合推荐）')
        onOpenChange(false)
        return
      }
      onPreview({ content: res.content, applied: res.applied })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '应用失败')
    } finally {
      setApplying(false)
    }
  }

  const allChecked = providerCheckedCount + modelCheckedCount ===
    providers.reduce((n, p) => n + 1 + p.models.length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg" height="auto" scrollFooter className="flex max-h-[70vh] flex-col">
        <DialogHeader>
          <DialogTitle>使用推荐配置</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button
              variant="default"
              disabled={applying || loading || (providerCheckedCount === 0 && modelCheckedCount === 0)}
              onClick={() => void handleApply()}
            >
              {applying ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '使用推荐配置'}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>关闭</Button>
          </>
        }>
        <div className="flex min-h-0 flex-1 flex-col">
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && providers.length === 0 && (
            <Placeholder>该配置文件下没有可配置的供应商</Placeholder>
          )}
          {!loading && !error && providers.length > 0 && (
            <>
              <div className="mb-2 flex items-center justify-end gap-3">
                <div className="text-xs text-muted-foreground">
                  已勾选 {providerCheckedCount + modelCheckedCount} / {providers.reduce((n, p) => n + 1 + p.models.length, 0)} 项
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={snapshot === null}
                  onClick={applyOfficialToAll}
                  title="把全部模型设为官方（lab）参考厂商；没有官方来源的取其候选列表第一个"
                >
                  <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                  批量设置参考厂商
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-md border border-border">
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                      <th className="w-10 py-2 pr-1 pl-2 align-middle text-left">
                        <Checkbox
                          checked={allChecked ? true : providerCheckedCount + modelCheckedCount > 0 ? 'indeterminate' : false}
                          onCheckedChange={(v) => {
                            const next = v === true
                            const cp: Record<string, boolean> = {}
                            const cm: Record<string, boolean> = {}
                            for (const p of providers) {
                              cp[p.provider_id] = next
                              for (const m of p.models) cm[modelKey(p.provider_id, m.id)] = next
                            }
                            setCheckedProviders(cp)
                            setCheckedModels(cm)
                          }}
                          aria-label="全选"
                        />
                      </th>
                      <th className="w-[26%] border-l border-border px-3 py-2 text-left font-medium">名称</th>
                      <th className="w-[24%] border-l border-border px-3 py-2 text-left font-medium">从 models.dev 同步模型配置</th>
                      <th className="border-l border-border px-3 py-2 text-left font-medium">字段对比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => {
                      const pChanges = providerRecChangesFor(p)
                      const providerChecked = checkedProviders[p.provider_id]
                      return (
                        <Fragment key={p.provider_id}>
                          {/* 供应商行：勾选即套整供应商默认推荐；参考在供应商级直接画两个杠表示不需要 */}
                          <tr
                            className={
                              'border-b border-border text-xs hover:bg-muted/40 transition-colors ' +
                              (providerChecked ? 'bg-primary/5' : '')
                            }
                          >
                            <td className="py-2 pr-1 pl-2 align-top">
                              <Checkbox
                                checked={providerChecked}
                                onCheckedChange={(v) =>
                                  setCheckedProviders((prev) => ({ ...prev, [p.provider_id]: v === true }))
                                }
                                aria-label={`勾选供应商 ${p.provider_id}`}
                              />
                            </td>
                            <td className="border-l border-border px-3 py-2 align-top">
                              <div className="truncate font-medium">{p.provider_id}</div>
                              <div className="text-[10px] text-muted-foreground">供应商级推荐</div>
                            </td>
                            <td className="border-l border-border px-3 py-2 align-top font-mono text-muted-foreground">--</td>
                            <td className="border-l border-border px-3 py-2 align-top">
                              {pChanges.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <ul className="space-y-1">
                                  {pChanges.slice(0, 4).map((c, i) => (
                                    <li key={i} className="break-all text-[11px] leading-snug">
                                      <span className="font-medium">{c.key}</span>
                                      <span className="mx-1 text-muted-foreground">
                                        {displayValue(c.oldValue)} → {displayValue(c.newValue)}
                                      </span>
                                    </li>
                                  ))}
                                  {pChanges.length > 4 && (
                                    <li className="text-[11px] text-muted-foreground">…等 {pChanges.length} 项</li>
                                  )}
                                </ul>
                              )}
                            </td>
                          </tr>

                          {/* 模型行 */}
                          {p.models.map((m) => {
                            const changes = [
                              ...modelInfoChangesFor(m.config, m.id),
                              ...modelRecChangesFor(m.config, p),
                            ]
                            const supplier = supplierByModelId[m.id] ?? ''
                            const source = supplier ? findModelsDevProviderRow(snapshot ?? [], m.id, supplier) : null
                            const key = modelKey(p.provider_id, m.id)
                            const checked = checkedModels[key]
                            return (
                              <tr
                                key={m.id}
                                className={
                                  'border-b border-border text-xs hover:bg-muted/40 transition-colors ' +
                                  (checked ? 'bg-primary/5' : '')
                                }
                              >
                                <td className="py-2 pr-1 pl-2 align-top">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) =>
                                      setCheckedModels((prev) => ({ ...prev, [key]: v === true }))
                                    }
                                    aria-label={`勾选模型 ${m.id}`}
                                  />
                                </td>
                                <td className="border-l border-border px-3 py-2 align-top">
                                  <div className="break-all pl-2 font-mono">{m.id}</div>
                                  <div className="pl-2 text-[10px] text-muted-foreground">模型级推荐</div>
                                </td>
                                <td className="border-l border-border px-3 py-2 align-top">
                                  <Select
                                    value={supplier}
                                    onValueChange={(v) => {
                                      const next = { ...supplierByModelId, [m.id]: v }
                                      setSupplierByModelId(next)
                                      void persistSources(next)
                                    }}
                                    disabled={snapshot === null}
                                  >
                                    <SelectTrigger className="h-7 w-full text-xs">
                                      <SelectValue placeholder={snapshot === null ? '加载中…' : '选择参考厂商'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {snapshot !== null && (
                                        <>
                                          <SelectItem value="">不同步</SelectItem>
                                          {providersForModel(snapshot, m.id).map((x) => (
                                            <SelectItem key={x.providerId} value={x.providerName}>
                                              {x.providerName}{isModelsDevLab(m.id, x.providerId) ? '（官方）' : ''}
                                            </SelectItem>
                                          ))}
                                        </>
                                      )}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="border-l border-border px-3 py-2 align-top">
                                  {!source ? (
                                    <div className="break-all text-[11px] text-muted-foreground">
                                      {supplier ? '未在 models.dev 查到该模型信息' : '请先选择参考厂商'}
                                    </div>
                                  ) : changes.length === 0 ? (
                                    <div className="text-[11px] text-muted-foreground">— 已符合推荐</div>
                                  ) : (
                                    <ul className="space-y-1">
                                      {changes.slice(0, 3).map((c, i) => (
                                        <li key={i} className="break-all text-[11px] leading-snug">
                                          <span className="font-medium">{c.label}</span>
                                          <span className="mx-1 text-muted-foreground">
                                            {displayValue(c.oldValue)} → {displayValue(c.newValue)}
                                          </span>
                                        </li>
                                      ))}
                                      {changes.length > 3 && (
                                        <li className="text-[11px] text-muted-foreground">…等 {changes.length} 项</li>
                                      )}
                                    </ul>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        </DialogScrollBody>
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