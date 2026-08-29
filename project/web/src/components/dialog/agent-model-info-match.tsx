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
import { loadModelsDevModels, type ModelsDevModel } from '@/lib/models-dev'
import { dashboardApi } from '@/lib/dashboard-api'
import type { AgentConfigFile } from '@/lib/dashboard-api'

interface AgentModelInfoMatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  providerId: string | null
  modelId: string | null
  onApplied: () => void
}

// Field mapping for each supported agent_type. The dialog looks up the
// entry that matches the takeover record's agent_type and uses it to
// turn one ModelsDevModel into a {path: value} map.
const AGENT_FIELD_MAP: Record<
  string,
  Array<{ readonly key: keyof ModelsDevModel; readonly path: string; readonly transform?: (v: unknown) => unknown }>
> = {
  opencode: [
    { key: 'contextLength', path: 'limits.context' },
    { key: 'maxOutput', path: 'limits.output' },
    { key: 'inputTypes', path: 'modalities.input' },
    { key: 'outputTypes', path: 'modalities.output' },
    {
      key: 'reasoning',
      path: 'thinking',
      transform: (v) => (v === true ? { type: 'enabled' } : undefined),
    },
  ],
}

export function AgentModelInfoMatchDialog({
  open,
  onOpenChange,
  record,
  providerId,
  modelId,
  onApplied,
}: AgentModelInfoMatchDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allModels, setAllModels] = useState<readonly ModelsDevModel[]>([])
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    loadModelsDevModels()
      .then((models) => setAllModels(models))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [open])

  const matches = useMemo<readonly ModelsDevModel[]>(() => {
    if (!modelId) return []
    const needle = modelId.toLowerCase()
    return allModels.filter((m) => {
      const id = m.id.toLowerCase()
      const name = m.name.toLowerCase()
      return id === needle || id.includes(needle) || name.includes(needle)
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
      const res = await dashboardApi.syncAgentConfigFileModelFields(record.id, {
        provider_id: providerId,
        model_id: modelId,
        fields,
      })
      toast(`已写入 ${res.applied} 个字段`)
      onApplied()
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
            从 models.dev 里挑选与「{modelId}」名称匹配（同 id / id 包含 / name 包含）的模型记录，点击应用把字段写回当前模型配置
          </p>
          {loading && <Placeholder>加载中…</Placeholder>}
          {error && <Placeholder tone="error">{error}</Placeholder>}
          {!loading && !error && mapping.length === 0 && (
            <Placeholder>该 agent_type 暂未配置字段映射，请联系开发者补全</Placeholder>
          )}
          {!loading && !error && mapping.length > 0 && matches.length === 0 && (
            <Placeholder>未找到匹配「{modelId}」的 models.dev 模型</Placeholder>
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
                      <tr key={`${m.providerId}:${m.id}`} className="align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{m.name || m.id}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{m.id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{m.providerName || m.providerId}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{m.providerId}</div>
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