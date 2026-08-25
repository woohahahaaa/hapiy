import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AppIcon } from '@/components/AppIcon'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { NodeModel } from '@/components/node/model'
import { NodeSlot } from '@/components/node/slot'
import { NodeExecutor } from '@/components/node/executor'
import { dashboardApi, type Provider, type FlatTopology } from '@/lib/dashboard-api'
import { topologyConfig } from '@/config/topology-config'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import { canvasFromFlat, isProviderSlot, isRequestEntry, PROVIDER_SLOT_TYPE, ALL_SLOT_TYPES } from '@/lib/flat-topology'
import { SLOT_LABELS } from '@/components/node/slot/items'
import { useSlotRules } from '@/components/node/executor/use-slot-rules'
import { cn } from '@/lib/utils'

const nodeTypes = {
  modelHub: NodeModel,
  slot: NodeSlot,
  requestEntry: NodeExecutor,
}

type PreviewTarget = { kind: 'current' } | { kind: 'version'; id: string }

interface TopologyVersionsModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly providers: readonly Provider[]
  readonly currentTopology: FlatTopology | null
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
  currentTopology,
  onBeforeRestore,
  onRestored,
}: TopologyVersionsModalProps) {
  const { rules } = useSlotRules()
  const [list, setList] = useState<Awaited<ReturnType<typeof dashboardApi.listTopologyVersions>> | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [previewDocument, setPreviewDocument] = useState<FlatTopology | null>(null)
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
        toast.error(message)
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
      toast.success('已存档')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '存档失败')
    } finally {
      setActionBusy(null)
    }
  }

  const handlePreviewCurrent = (): void => {
    setPreview({ kind: 'current' })
    setPreviewDocument(currentTopology)
  }

  const handlePreviewVersion = async (id: string): Promise<void> => {
    setPreview({ kind: 'version', id })
    setPreviewDocument(null)
    setPreviewLoading(true)
    try {
      const { document } = await dashboardApi.getTopologyVersion(id)
      setPreviewDocument(document)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载版本失败')
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
      toast.success('已恢复到该版本')
      onRestored()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setActionBusy(null)
    }
  }

  const previewTopology = useMemo<FlatTopology | null>(() => {
    if (preview?.kind === 'current') return currentTopology
    if (preview?.kind === 'version') return previewDocument
    return null
  }, [preview, currentTopology, previewDocument])

  const previewFlat = useMemo(() => {
    if (!previewTopology) return null
    return canvasFromFlat(previewTopology.nodes, previewTopology.wires)
  }, [previewTopology])

  const previewNodes = useMemo<Node[]>(() => {
    if (!previewFlat) return []
    const canvas = previewFlat
    const nodes: Node[] = []
    for (const node of canvas.topLevel) {
      if (isRequestEntry(node)) {
        nodes.push({
          id: node.id,
          type: 'requestEntry',
          position: { x: 300, y: 20 },
          data: {
            label: node.name ?? '请求入口',
            enabled: node.enabled,
            weight: node.weight ?? 1,
            models: [],
            onChangeEnabled: () => {},
            onChangeWeight: () => {},
          },
        })
      } else if (isProviderSlot(node)) {
        const children = canvas.providers
          .filter((p) => canvas.providerSlotOf.get(p.id) === node.id)
          .map((p) => {
            const provider = providers.find((x) => x.name === p.name)
            return {
              id: p.id,
              label: p.name,
              modelCount: provider?.models.length ?? 0,
              enabled: p.enabled,
              providerStatus: provider?.status ?? false,
            }
          })
        nodes.push({
          id: node.id,
          type: 'slot',
          position: { x: 560, y: 20 },
          data: {
            title: 'provider',
            slotType: PROVIDER_SLOT_TYPE,
            isProviderSlot: true,
            children,
            onAddProvider: () => {},
            onToggleProvider: () => {},
            onReorderProvider: () => {},
          },
        })
      } else {
        const slotType = node.slotType ?? ''
        nodes.push({
          id: node.id,
          type: 'slot',
          position: { x: 560, y: 20 },
          data: {
            title: SLOT_LABELS[slotType as keyof typeof SLOT_LABELS] ?? slotType ?? '插槽',
            slotType,
            isProviderSlot: false,
            entries: [...(node.entries ?? [])],
            rules,
            onChangeEntry: () => {},
            onDeleteEntry: () => {},
            onReorderEntries: () => {},
          },
        })
      }
    }
    return nodes
  }, [previewFlat, providers, rules])

  const previewEdges = useMemo(() => {
    if (!previewFlat) return []
    return previewFlat.canvasWires.map((w) => ({
      id: `${w.source}→${w.target}`,
      source: w.source,
      target: w.target,
      animated: topologyConfig.edge.animated,
      style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: 1 },
    }))
  }, [previewFlat])

  const layoutedPreviewNodes = useMemo(() => {
    if (!previewFlat || previewNodes.length === 0) return []
    const positions = layoutFlatCanvas(previewFlat, previewNodes, {
      nodeGap: topologyConfig.layout.nodeGap,
      rowGap: topologyConfig.layout.rowGap,
      modelHubGap: topologyConfig.layout.modelHubGap,
      groupGap: topologyConfig.layout.groupGap,
      marginX: topologyConfig.layout.marginX,
      marginY: topologyConfig.layout.marginY,
      freeSlotRowWidthFactor: ALL_SLOT_TYPES.length + 2,
      slotBaseWidth: topologyConfig.render.slot.shellMinWidth,
    }, undefined)
    return previewNodes.map((n) => {
      const pos = positions[n.id]
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    })
  }, [previewFlat, previewNodes])

  const hasVersions = list !== null && (list.current !== null || list.versions.length > 0)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent width="md" height="auto" className="grid-rows-[auto_minmax(0,1fr)] min-h-[640px]">
        <DialogHeader>
          <DialogTitle>历史版本</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 gap-4">
          <div className="w-72 shrink-0 overflow-y-auto rounded-md border border-border/60 bg-muted p-2">
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
          <div className="relative min-w-0 flex-1 overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
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