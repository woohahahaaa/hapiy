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
import { toast } from '@/components/ui/toast'
import { dashboardApi } from '@/lib/dashboard-api'
import { findModelsDevModel, loadModelsDevModels, type ModelsDevModel } from '@/lib/models-dev'
import {
  MODEL_INFO_FIELD_KEYS,
  MODEL_INFO_FIELD_LABELS,
  type AgentConfigFile,
  type AgentModelInfoFieldPaths,
  type AgentModelProvider,
} from '@/lib/dashboard-api'

interface AgentModelInfoMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  /** 全文件模式：文件里全部 provider（含各自 models），跨 provider 聚合展示。 */
  providers: readonly AgentModelProvider[]
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

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// SyncRow = 一个 (provider × model) 组合。
interface SyncRow {
  readonly providerId: string
  readonly modelId: string
  readonly config: unknown
}

// 同一模型出现于多个 provider 时聚合为一组，模型名列 rowspan。
interface ModelGroup {
  readonly modelId: string
  readonly rows: readonly SyncRow[]
}

export function AgentModelInfoMatchDialog({
  open,
  onOpenChange,
  record,
  providers,
  modelInfoFields,
  onPreview,
}: AgentModelInfoMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setChecked({})
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
    return () => { cancelled = true }
  }, [open])

  // 聚合：模型名 → 多个 (provider, config)。
  const groups = useMemo<readonly ModelGroup[]>(() => {
    const byModel = new Map<string, SyncRow[]>()
    for (const p of providers) {
      for (const m of p.models) {
        const list = byModel.get(m.id) ?? []
        list.push({ providerId: p.provider_id, modelId: m.id, config: m.config })
        byModel.set(m.id, list)
      }
    }
    return [...byModel.entries()].map(([modelId, rows]) => ({ modelId, rows }))
  }, [providers])

  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)

  // 自动源：每模型取 models.dev 首个匹配行（不再手动选供应商）。
  const resolvedRow = (modelId: string): ModelsDevModel | null =>
    findModelsDevModel(snapshot ?? [], modelId)

  const sourceMapFor = (row: ModelsDevModel): Record<string, unknown> => {
    const types = [...new Set([...row.inputTypes, ...row.outputTypes])]
    return {
      max_context: row.contextLength > 0 ? row.contextLength : undefined,
      max_output_token: row.maxOutput > 0 ? row.maxOutput : undefined,
      input_types: types.length > 0 ? types : undefined,
      thinking_levels: row.reasoning ? ['high'] : [],
    }
  }

  const changesFor = (row: SyncRow): readonly FieldChange[] => {
    const source = resolvedRow(row.modelId)
    if (!source) return []
    const cfg = row.config
    if (!cfg || typeof cfg !== 'object') return []
    const sourceMap = sourceMapFor(source)
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

  const rowKey = (providerId: string, modelId: string): string => `${providerId}\u0000${modelId}`
  const checkedCount = groups.reduce(
    (n, g) => n + g.rows.filter((r) => !!checked[rowKey(r.providerId, r.modelId)]).length,
    0,
  )
  const allChecked = rowCount > 0 && checkedCount === rowCount

  const toggleAll = () => {
    const next = !allChecked
    const map: Record<string, boolean> = {}
    for (const g of groups) {
      for (const r of g.rows) map[rowKey(r.providerId, r.modelId)] = next
    }
    setChecked(map)
  }

  const handleSave = async () => {
    if (!record) return
    const targets = groups.flatMap((g) => g.rows)
      .filter((r) => {
        if (!checked[rowKey(r.providerId, r.modelId)]) return false
        return changesFor(r).length > 0
      })
      .map((r) => ({ providerId: r.providerId, modelId: r.modelId, changes: changesFor(r) }))
    if (targets.length === 0) {
      toast('没有勾选的模型存在可应用的字段差异')
      return
    }
    setApplying(true)
    try {
      let applied = 0
      // 每次 sync 返回的都是完整文件内容；最后一次快照已包含全部被同步
      // 的 provider×model，直接作为预览即可。
      let lastRaw = ''
      for (const { providerId, modelId, changes } of targets) {
        const fields: Record<string, unknown> = {}
        for (const c of changes) fields[c.path] = c.newValue
        const res = await dashboardApi.syncAgentConfigFileModelFields(record.id, {
          provider_id: providerId,
          model_id: modelId,
          fields,
        })
        applied += res.applied
        lastRaw = res.content
      }
      onPreview({ content: lastRaw, applied })
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
          <DialogTitle>同步模型基本信息</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && rowCount === 0 && (
            <Placeholder>该配置文件下没有可同步的模型</Placeholder>
          )}
          {!loading && !error && rowCount > 0 && (
            <>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full table-fixed text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="w-[30%] px-2 py-2 text-left font-medium">模型</th>
                      <th className="w-[30%] px-2 py-2 text-left font-medium">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={allChecked ? true : checkedCount > 0 ? 'indeterminate' : false}
                            onCheckedChange={toggleAll}
                            aria-label="全选"
                          />
                          所属供应商
                        </div>
                      </th>
                      <th className="w-[40%] px-2 py-2 text-left font-medium">将应用的修改</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groups.map((g) => {
                      const source = resolvedRow(g.modelId)
                      return g.rows.map((r, idx) => {
                        const changes = changesFor(r)
                        const isFirstRow = idx === 0
                        return (
                          <tr key={rowKey(r.providerId, r.modelId)} className="align-top hover:bg-muted">
                            {isFirstRow && (
                              <td rowSpan={g.rows.length} className="px-2 py-2 align-top">
                                <div className="break-words font-medium">{g.modelId}</div>
                              </td>
                            )}
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={!!checked[rowKey(r.providerId, r.modelId)]}
                                  onCheckedChange={(v) =>
                                    setChecked((prev) => ({
                                      ...prev,
                                      [rowKey(r.providerId, r.modelId)]: v === true,
                                    }))
                                  }
                                  aria-label={`选择 ${g.modelId} · ${r.providerId}`}
                                />
                                <span className="break-words font-mono">{r.providerId}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              {!source ? (
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
                      })
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-2">
                <Button
                  variant="default"
                  disabled={applying || loading || rowCount === 0 || checkedCount === 0}
                  onClick={() => void handleSave()}
                >
                  {applying ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '确认应用'}
                </Button>
              </div>
            </>
          )}
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