import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AppIcon } from '@/components/AppIcon'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ProviderNode } from '@/nodes/ProviderNode'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { SlotNode } from '@/nodes/SlotNode'
import { dashboardApi, type Provider } from '@/lib/dashboard-api'
import { topologyConfig } from '@/config/topology-config'
import { getLayoutedElements } from '@/lib/topology-auto-layout'
import { slotMapsFromWorkflows, type Workflow } from '@/lib/topology-document'
import { buildModelNodes, buildProviderNode, buildSlotNodes, buildEdges } from '@/lib/topology-builders'
import { useSlotRules } from '@/components/topology/slot-items'
import { cn } from '@/lib/utils'

const nodeTypes = {
  modelHub: ModelHubNode,
  provider: ProviderNode,
  slot: SlotNode,
}

type PreviewTarget = { kind: 'current' } | { kind: 'version'; id: string }

interface TopologyVersionsModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly providers: readonly Provider[]
  readonly currentWorkflows: readonly Workflow[]
  readonly onBeforeRestore: () => Promise<void>
  readonly onRestored: () => void
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function TopologyVersionsModal({
  open,
  onClose,
  providers,
  currentWorkflows,
  onBeforeRestore,
  onRestored,
}: TopologyVersionsModalProps) {
  const { rules } = useSlotRules()
  const [list, setList] = useState<Awaited<ReturnType<typeof dashboardApi.listTopologyVersions>> | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [previewDocument, setPreviewDocument] = useState<readonly Workflow[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState<'archive' | 'restore' | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setList(null)
    setListError(null)
    setPreview(null)
    setPreviewDocument(null)
    setPreviewLoading(false)
    setActionBusy(null)
    setConfirmRestoreId(null)
    async function load() {
      try {
        const data = await dashboardApi.listTopologyVersions()
        if (cancelled) return
        setList(data)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载历史版本失败'
        setListError(message)
        toast.add({ title: message, type: 'error' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open])

  const handleArchive = async (): Promise<void> => {
    setActionBusy('archive')
    try {
      const data = await dashboardApi.archiveTopologyVersion()
      setList(data)
      toast.add({ title: '已存档', type: 'success' })
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : '存档失败', type: 'error' })
    } finally {
      setActionBusy(null)
    }
  }

  const handlePreviewCurrent = (): void => {
    setPreview({ kind: 'current' })
    setPreviewDocument(currentWorkflows)
  }

  const handlePreviewVersion = async (id: string): Promise<void> => {
    setPreview({ kind: 'version', id })
    setPreviewDocument(null)
    setPreviewLoading(true)
    try {
      const { document } = await dashboardApi.getTopologyVersion(id)
      setPreviewDocument(document)
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : '加载版本失败', type: 'error' })
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    if (!confirmRestoreId) return
    setActionBusy('restore')
    try {
      await onBeforeRestore()
      const data = await dashboardApi.restoreTopologyVersion(confirmRestoreId)
      setList(data)
      setConfirmRestoreId(null)
      toast.add({ title: '已恢复到该版本', type: 'success' })
      onRestored()
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : '恢复失败', type: 'error' })
    } finally {
      setActionBusy(null)
    }
  }

  const previewData = useMemo(() => {
    if (!previewDocument) return null
    const maps = slotMapsFromWorkflows(previewDocument)
    const ids = new Set<string>()
    for (const entry of maps.values()) ids.add(entry.providerId)
    const filteredProviders = providers.filter((p) => ids.has(p.id))
    const modelNodeIds: Record<string, string> = {}
    for (const provider of filteredProviders) for (const model of provider.models) {
      if (!(model.model in modelNodeIds)) modelNodeIds[model.model] = `model-${model.model}`
    }
    return { maps, filteredProviders, modelNodeIds }
  }, [previewDocument, providers])

  const previewNodes = useMemo(() => {
    if (!previewData) return []
    const { maps, filteredProviders, modelNodeIds } = previewData
    const modelNodes = buildModelNodes(filteredProviders, modelNodeIds, {})
    const nodes: Node[] = [...modelNodes]
    for (const [workflowKey, entry] of maps) {
      const provider = providers.find((p) => p.id === entry.providerId)
      if (!provider) continue
      const verticalOffset = nodes.length
      nodes.push(buildProviderNode(workflowKey, entry, provider, {}, topologyConfig.initialPositions.provider.x, verticalOffset, null, () => {}))
      nodes.push(
        ...buildSlotNodes(
          workflowKey,
          entry.slots,
          rules,
          {},
          topologyConfig.initialPositions.slot.x,
          verticalOffset,
          entry.enabled,
          () => {},
          () => {},
          () => {},
        ),
      )
    }
    return nodes
  }, [previewData, providers, rules])

  const previewEdges = useMemo(() => {
    if (!previewData) return []
    return buildEdges(previewData.filteredProviders, previewData.maps, previewData.modelNodeIds)
  }, [previewData])

  const layoutedPreviewNodes = useMemo(() => {
    if (previewNodes.length === 0) return []
    return getLayoutedElements(previewNodes, previewEdges, {
      nodeGap: topologyConfig.layout.nodeGap,
      rowGap: topologyConfig.layout.rowGap,
      modelHubGap: topologyConfig.layout.modelHubGap,
      groupGap: topologyConfig.layout.groupGap,
      marginX: topologyConfig.layout.marginX,
      marginY: topologyConfig.layout.marginY,
    }, undefined)
  }, [previewNodes, previewEdges])

  const hasVersions = list !== null && (list.current !== null || list.versions.length > 0)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-4xl lg:max-w-5xl h-[min(70vh,680px)] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>历史版本</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 gap-4">
          <div className="w-72 shrink-0 overflow-y-auto pr-2">
            {list === null && !listError && (
              <div className="flex items-center gap-2 p-4 text-muted-foreground">
                <AppIcon name="progress_activity" size={16} className="animate-spin" />
                <span className="text-sm">加载中…</span>
              </div>
            )}
            {listError && (
              <div className="p-4 text-sm text-destructive">{listError}</div>
            )}
            {list && list.current && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => handlePreviewCurrent()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handlePreviewCurrent()
                  }
                }}
                className={cn(
                  'mb-1 cursor-pointer rounded-md border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                  preview?.kind === 'current' ? 'border-primary bg-primary/5' : 'border-border/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">当前版本</span>
                  {list.current.archived ? (
                    <span className="text-sm text-muted-foreground">已存档</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleArchive()
                      }}
                      disabled={actionBusy !== null}
                    >
                      {actionBusy === 'archive' ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : '存档'}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  工作流 {list.current.workflowActive}/{list.current.workflowTotal} · {list.current.nodeCount} 节点
                </p>
                {list.current.archived && (
                  <p className="mt-1 text-xs text-muted-foreground">{formatTime(list.current.updatedAt)}</p>
                )}
              </div>
            )}
            {list?.versions.map((version) => (
              <div
                key={version.id}
                role="button"
                tabIndex={0}
                onClick={() => void handlePreviewVersion(version.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void handlePreviewVersion(version.id)
                  }
                }}
                className={cn(
                  'mb-1 cursor-pointer rounded-md border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                  preview?.kind === 'version' && preview.id === version.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{formatTime(version.createdAt)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      setConfirmRestoreId(version.id)
                    }}
                    disabled={actionBusy !== null}
                  >
                    恢复
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  工作流 {version.workflowActive}/{version.workflowTotal} · {version.nodeCount} 节点
                </p>
              </div>
            ))}
            {list !== null && !hasVersions && (
              <div className="p-4 text-sm text-muted-foreground">暂无历史版本</div>
            )}
          </div>
          <div className="relative min-w-0 flex-1" onContextMenu={(e) => e.preventDefault()}>
            {previewLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <AppIcon name="progress_activity" size={20} className="animate-spin" />
              </div>
            ) : layoutedPreviewNodes.length > 0 ? (
              <ReactFlow
                nodes={layoutedPreviewNodes}
                edges={previewEdges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesReconnectable={false}
                elementsSelectable={false}
                deleteKeyCode={null}
                fitView
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background color={topologyConfig.grid.color} gap={topologyConfig.grid.gap} size={topologyConfig.grid.size} />
              </ReactFlow>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                选择左侧条目以预览
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <Dialog open={confirmRestoreId !== null} onOpenChange={(next) => { if (!next) setConfirmRestoreId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复版本</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">恢复前会自动存档当前版本，确定恢复到该版本吗？</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRestoreId(null)} disabled={actionBusy !== null}>
              取消
            </Button>
            <Button onClick={() => void handleRestore()} disabled={actionBusy !== null}>
              {actionBusy === 'restore' && <AppIcon name="progress_activity" size={16} className="animate-spin" data-icon="inline-start" />}
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}