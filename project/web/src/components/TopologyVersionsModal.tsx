import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactFlow, Background, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { i18n } from '@/i18n/i18n'
import { AppIcon } from '@/components/AppIcon'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

import { Dialog, DialogContent, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { NodeModel } from '@/components/node/model'
import { NodeSlot } from '@/components/node/slot'
import { NodeSwitch } from '@/components/node/switch'
import { NodeExecutor } from '@/components/node/executor'
import { dashboardApi, type Provider, type FlatTopology } from '@/lib/dashboard-api'
import { topologyConfig } from '@/config/topology-config'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import { canvasFromFlat, canvasWireHandles, ALL_SLOT_TYPES } from '@/lib/flat-topology'
import { buildCanvasNodes } from '@/lib/canvas-nodes'
import { useSlotRules } from '@/components/node/executor/use-slot-rules'
import { cn } from '@/lib/utils'

const nodeTypes = {
  modelHub: NodeModel,
  slot: NodeSlot,
  switch: NodeSwitch,
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
  const { t } = useTranslation('topology')
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
        const message = err instanceof Error ? err.message : t('versions.loadFailed')
        setListError(message)
        toast.error(message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, t])

  const handleArchive = async (): Promise<void> => {
    setActionBusy('archive')
    try {
      const data = await dashboardApi.archiveTopologyVersion()
      setList(data)
      toast.success(t('versions.archived'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.archiveFailed'))
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
      toast.error(err instanceof Error ? err.message : t('versions.previewFailed'))
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
      toast.success(t('versions.restored'))
      onRestored()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('versions.restoreFailed'))
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
    // Same builder as the live canvas; the preview omits handlers so every node
    // renders read-only with the exact shape (handles, labels) of the canvas.
    return buildCanvasNodes(previewFlat, { providers, slotRules: rules })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFlat, providers, rules, i18n.language])

  const previewEdges = useMemo(() => {
    if (!previewFlat) return []
    // Handles must match the live canvas (switch yes/no, slot seg-i) or the
    // branch / multi-incoming wires render as disconnected.
    const handles = canvasWireHandles(previewFlat.canvasWires, previewFlat.topLevel)
    return previewFlat.canvasWires.map((w, i) => ({
      id: `${w.source}→${w.target}`,
      source: w.source,
      target: w.target,
      sourceHandle: handles[i].sourceHandle,
      targetHandle: handles[i].targetHandle,
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
      <DialogContent width="md" height="auto" minHeight="640px" className="grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>{t('versions.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 gap-4">
          <div className="w-72 shrink-0 overflow-y-auto rounded-xs border border-border-subtle bg-muted p-2">
            {list === null && !listError && (
              <div className="flex items-center gap-2 p-4 text-muted-foreground">
                <AppIcon name="progress_activity" size={16} className="animate-spin" />
                <span className="text-sm">{t('common:state.loading')}</span>
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
                  'mb-1 cursor-pointer rounded-xs border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                  preview?.kind === 'current' ? 'border-primary bg-primary/5' : 'border-border-subtle',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t('versions.current')}</span>
                  {list.current.archived ? (
                    <span className="text-sm text-muted-foreground">{t('versions.archived')}</span>
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
                      {actionBusy === 'archive' ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : t('versions.archive')}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('versions.workflowSummary', { active: list.current.workflowActive, total: list.current.workflowTotal, nodes: list.current.nodeCount })}
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
                  'mb-1 cursor-pointer rounded-xs border p-3 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring/50',
                  preview?.kind === 'version' && preview.id === version.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border-subtle',
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
                    {t('versions.restore')}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('versions.workflowSummary', { active: version.workflowActive, total: version.workflowTotal, nodes: version.nodeCount })}
                </p>
              </div>
            ))}
            {list !== null && !hasVersions && (
              <div className="p-4 text-sm text-muted-foreground">{t('versions.empty')}</div>
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
                {t('versions.previewHint')}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <Dialog open={confirmRestoreId !== null} onOpenChange={(next) => { if (!next) setConfirmRestoreId(null) }}>
        <DialogContent scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('versions.restoreDialogTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button onClick={() => void handleRestore()} disabled={actionBusy !== null}>
                {actionBusy === 'restore' && <AppIcon name="progress_activity" size={16} className="animate-spin" data-icon="inline-start" />}
                {t('versions.restoreConfirm')}
              </Button>
            </>
          }>
            <p className="text-sm text-muted-foreground">{t('versions.restoreDialogBody')}</p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
