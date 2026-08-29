import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { JsonHighlight } from '@/components/JsonHighlight'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import type {
  AgentConfigFile,
  AgentModelProvider,
  AgentModelSummary,
} from '@/lib/dashboard-api'

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

  useEffect(() => {
    if (!open || !record) return
    setSummary(null)
    setError(null)
    setSelectedProviderId(null)
    setSelectedModelId(null)
    setLoading(true)
    fetchModels(record.id)
      .then((res) => {
        setSummary(res)
        if (res.providers.length > 0) {
          const first = res.providers[0]
          setSelectedProviderId(first.provider_id)
          if (first.models.length > 0) {
            setSelectedModelId(first.models[0].id)
          }
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, record, fetchModels])

  const selectedProvider = useMemo<AgentModelProvider | null>(() => {
    if (!summary || !selectedProviderId) return null
    return summary.providers.find((p) => p.provider_id === selectedProviderId) ?? null
  }, [summary, selectedProviderId])

  const selectedModel = useMemo(() => {
    if (!selectedProvider) return null
    if (!selectedModelId) return null
    return selectedProvider.models.find((m) => m.id === selectedModelId) ?? null
  }, [selectedProvider, selectedModelId])

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
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}>
            <AppIcon name="close" size={16} />
          </Button>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(320px,1fr)_minmax(360px,1.4fr)] divide-x divide-border">
          {/* Left: providers */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader>Provider</ColumnHeader>
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
              {selectedProvider ? `其他字段 · ${selectedProvider.provider_id}` : '其他字段'}
            </ColumnHeader>
            <div className="max-h-[40%] overflow-auto border-b border-border p-2">
              {selectedProvider ? (
                <JsonHighlight
                  value={selectedProvider.other_fields}
                  className="rounded-none border-0 bg-transparent p-0"
                />
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
                <JsonHighlight value={selectedModel.config} className="rounded-none border-0 bg-transparent p-0" />
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