import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi } from '@/lib/dashboard-api'
import type { AgentConfigFile, PriceConfig } from '@/lib/dashboard-api'

interface AgentModelInfoMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  providerId: string | null
  modelId: string | null
  onPreview: (input: { readonly content: string; readonly applied: number }) => void
}

// Field mapping for each supported agent_type. The dialog looks up the
// entry that matches the takeover record's agent_type and uses it to
// turn one PriceConfig row into a {path: value} map. Reads from the
// 模型信息 (PriceConfig) table we keep locally — NOT models.dev.
const AGENT_FIELD_MAP: Record<
  string,
  Array<{ readonly key: keyof PriceConfig; readonly path: string; readonly transform?: (v: unknown) => unknown }>
> = {
  opencode: [
    { key: 'contextLength', path: 'limit.context' },
    { key: 'maxToken', path: 'limit.output' },
    { key: 'supportedTypes', path: 'modalities.input' },
    {
      key: 'thinkingLevels',
      path: 'thinking',
      transform: (v) => (Array.isArray(v) && v.length > 0 ? { type: 'enabled' } : undefined),
    },
  ],
}

export function AgentModelInfoMatchDialog({
  open,
  onOpenChange,
  record,
  providerId,
  modelId,
  onPreview,
}: AgentModelInfoMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allModels, setAllModels] = useState<readonly PriceConfig[]>([])
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    dashboardApi
      .listPrices({ limit: 1000, offset: 0 })
      .then((res) => setAllModels(res.prices))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [open])

  const matches = useMemo<readonly PriceConfig[]>(() => {
    if (!modelId) return []
    const needle = modelId.toLowerCase()
    return allModels.filter((m) => {
      const id = m.model.toLowerCase()
      const aliasMatch = m.aliases.some((a) => a.toLowerCase().includes(needle))
      return id === needle || id.includes(needle) || aliasMatch
    })
  }, [allModels, modelId])

  const mapping = useMemo(() => {
    const key = record?.agent_type ?? ''
    return AGENT_FIELD_MAP[key] ?? []
  }, [record])

  const resolveFields = (m: ModelsDevModel): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const entry of mapping) {
      const raw = m[entry.key]
      if (raw === undefined || raw === null) continue
      if (entry.transform) {
        const v = entry.transform(raw)
        if (v === undefined) continue
        out[entry.path] = v
      } else if (Array.isArray(raw)) {
        if (raw.length === 0) continue
        out[entry.path] = raw
      } else if (typeof raw === 'number') {
        if (raw === 0) continue
        out[entry.path] = raw
      } else if (typeof raw === 'boolean') {
        if (!raw) continue
        out[entry.path] = raw
      }
    }
    return out
  }

  const handleApply = async (m: ModelsDevModel) => {
    if (!record || !providerId || !modelId) return
    const fields = resolveFields(m)
    if (Object.keys(fields).length === 0) {
      toast('该模型没有可同步的字段')
      return
    }
    setApplying(true)
    try {
      // Preview only — backend computes and returns the new content
      // without writing. Parent AgentModelsDialog stashes it in
      // pendingContent and shows the save/cancel preview banner.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogHeader>
          <DialogTitle>从模型信息同步 · {modelId ?? ''}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            从我们维护的「模型信息」表格里挑选与「{modelId}」匹配（按名称或别名包含）的模型记录，点击应用把字段写回当前模型配置
          </p>
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && mapping.length === 0 && (
            <Placeholder>该 agent_type 暂未配置字段映射，请联系开发者补全</Placeholder>
          )}
          {!loading && !error && mapping.length > 0 && matches.length === 0 && (
            <Placeholder>未找到匹配「{modelId}」的模型信息记录</Placeholder>
          )}
          {matches.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="w-[20%] px-3 py-2 text-left font-medium">模型名称</th>
                    <th className="w-[18%] px-3 py-2 text-left font-medium">上游供应商</th>
                    <th className="px-3 py-2 text-left font-medium">具体更新字段</th>
                    <th className="w-[80px] px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {matches.map((m) => {
                    const fields = resolveFields(m)
                    const fieldCount = Object.keys(fields).length
                    return (
<tr key={m.id} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{m.model}</div>
                        {m.aliases.length > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            别名：{m.aliases.join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono">{m.providerId ?? '—'}</div>
                      </td>
                        <td className="px-3 py-2">
                          {fieldCount === 0 ? (
                            <span className="text-muted-foreground">无可同步字段</span>
                          ) : (
                            <ul className="space-y-0.5 font-mono text-[11px]">
                              {Object.entries(fields).map(([path, val]) => (
                                <li key={path}>
                                  <span className="text-foreground">{path}</span>
                                  <span className="text-muted-foreground"> = </span>
                                  <span className="text-primary">{JSON.stringify(val)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={applying || fieldCount === 0}
                            onClick={() => void handleApply(m)}
                          >
                            {applying ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : '应用'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
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