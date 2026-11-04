import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  Background,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { i18n } from '@/i18n/i18n'
import { AppIcon } from '@/components/wooh/AppIcon'
import { cn } from '@/lib/utils'

import { NodeModel } from '@/components/wooh/node/model'
import { NodeSlot } from '@/components/wooh/node/slot'
import { NodeSwitch } from '@/components/wooh/node/switch'
import { NodeExecutor } from '@/components/wooh/node/executor'
import {
  dashboardApi,
  type Provider,
  type FlatTopology,
} from '@/lib/dashboard-api'
import { topologyConfig } from '@/config/topology-config'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import {
  canvasFromFlat,
  canvasWireHandles,
  ALL_SLOT_TYPES,
} from '@/lib/flat-topology'
import { buildCanvasNodes } from '@/lib/canvas-nodes'
import { useSlotRules } from '@/components/wooh/node/executor/use-slot-rules'
import {
  measureNodeElement,
  type NodeSize,
  type NodeSizeMap,
} from '@/lib/use-reactflow-node-sizes'
import {
  VersionsModal,
  type VersionsModalList,
} from '@/components/wooh/dialog/versions-modal'

const nodeTypes = {
  modelHub: NodeModel,
  slot: NodeSlot,
  switch: NodeSwitch,
  requestEntry: NodeExecutor,
}

interface TopologyVersionsModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly providers: readonly Provider[]
  readonly currentTopology: FlatTopology | null
  readonly onBeforeRestore: () => Promise<void>
  readonly onRestored: () => void
}

function sameSizes(a: NodeSizeMap | undefined, b: NodeSizeMap): boolean {
  if (!a || a.size !== b.size) return false
  for (const [id, size] of b) {
    const prev = a.get(id)
    if (!prev || prev.width !== size.width || prev.height !== size.height) {
      return false
    }
  }
  return true
}

/** 只读的拓扑预览画布：与主画布共用节点构建与自动布局，保证形状一致。 */
function TopologyVersionPreview({
  topology,
  providers,
}: {
  readonly topology: FlatTopology
  readonly providers: readonly Provider[]
}) {
  const { rules } = useSlotRules()
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [measuredSizes, setMeasuredSizes] = useState<NodeSizeMap | undefined>(
    undefined
  )
  // 换一份版本就重新测量：不同版本的卡片高度不一样，沿用上一份会排得歪。
  const [sizedTopology, setSizedTopology] = useState(topology)
  if (topology !== sizedTopology) {
    setSizedTopology(topology)
    setMeasuredSizes(undefined)
  }
  const instanceRef = useRef<ReactFlowInstance | null>(null)

  const previewFlat = useMemo(
    () => canvasFromFlat(topology.nodes, topology.wires),
    [topology]
  )

  const previewNodes = useMemo<Node[]>(() => {
    if (!previewFlat) return []
    // Same builder as the live canvas; the preview omits handlers so every node
    // renders read-only with the exact shape (handles, labels) of the canvas.
    return buildCanvasNodes(previewFlat, { providers, slotRules: rules })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFlat, providers, rules, i18n.language])

  const previewEdges = useMemo<Edge[]>(() => {
    if (!previewFlat) return []
    // Handles must match the live canvas (switch yes/no, slot seg-i) or the
    // branch / multi-incoming wires render as disconnected.
    const handles = canvasWireHandles(
      previewFlat.canvasWires,
      previewFlat.topLevel
    )
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

  // 节点先按兜底尺寸渲染出来，量到真实宽高后再算一遍位置，避免长卡片互相压住。
  const layoutedPreviewNodes = useMemo(() => {
    if (!previewFlat || previewNodes.length === 0) return []
    const positions = layoutFlatCanvas(
      previewFlat,
      previewNodes,
      {
        nodeGap: topologyConfig.layout.nodeGap,
        rowGap: topologyConfig.layout.rowGap,
        modelHubGap: topologyConfig.layout.modelHubGap,
        groupGap: topologyConfig.layout.groupGap,
        marginX: topologyConfig.layout.marginX,
        marginY: topologyConfig.layout.marginY,
        freeSlotRowWidthFactor: ALL_SLOT_TYPES.length + 2,
        slotBaseWidth: topologyConfig.render.slot.shellMinWidth,
      },
      measuredSizes
    )
    return previewNodes.map((n) => {
      const pos = positions[n.id]
      return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
    })
  }, [previewFlat, previewNodes, measuredSizes])

  // 等 ReactFlow 把节点挂到 DOM 后测量真实尺寸；ReactFlow 是异步渲染的，
  // 所以按帧重试一小段时间。
  useEffect(() => {
    if (!containerEl || previewNodes.length === 0) return
    let frame = 0
    let attempts = 0
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const next = new Map<string, NodeSize>()
      const elements = containerEl.querySelectorAll<HTMLElement>(
        '.react-flow__node[data-id]'
      )
      for (const el of elements) {
        const id = el.dataset.id
        const size = measureNodeElement(el)
        if (id && size) next.set(id, size)
      }
      if (next.size >= previewNodes.length || attempts >= 30) {
        // 尺寸没变就不重排/重新居中，别让父级轮询打断正在看的预览。
        if (!sameSizes(measuredSizes, next)) setMeasuredSizes(next)
        return
      }
      attempts += 1
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [containerEl, previewNodes, measuredSizes])

  // 排好版后把整张图缩放到刚好铺满预览区并居中。
  useEffect(() => {
    if (!measuredSizes) return
    const frame = requestAnimationFrame(() => {
      instanceRef.current?.fitView({
        padding: 0.06,
        minZoom: 0.01,
        maxZoom: 64,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [measuredSizes])

  if (layoutedPreviewNodes.length === 0) return null

  return (
    <div className="relative h-full w-full">
      <div
        ref={setContainerEl}
        className={cn('h-full w-full', !measuredSizes && 'invisible')}
      >
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
          onInit={(instance) => {
            instanceRef.current = instance
          }}
        >
          <Background
            color={topologyConfig.grid.color}
            gap={topologyConfig.grid.gap}
            size={topologyConfig.grid.size}
          />
        </ReactFlow>
      </div>
      {!measuredSizes && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <AppIcon
            name="progress_activity"
            size={20}
            className="animate-spin"
          />
        </div>
      )}
    </div>
  )
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

  const toList = (
    data: Awaited<ReturnType<typeof dashboardApi.listTopologyVersions>>
  ): VersionsModalList => ({
    current: data.current
      ? {
          archived: data.current.archived,
          summary: t('versions.workflowSummary', {
            active: data.current.workflowActive,
            total: data.current.workflowTotal,
            nodes: data.current.nodeCount,
          }),
          updatedAt: data.current.updatedAt,
        }
      : null,
    versions: data.versions.map((version) => ({
      id: version.id,
      createdAt: version.createdAt,
      summary: t('versions.workflowSummary', {
        active: version.workflowActive,
        total: version.workflowTotal,
        nodes: version.nodeCount,
      }),
    })),
  })

  return (
    <VersionsModal<FlatTopology>
      open={open}
      onClose={onClose}
      messages={{
        title: t('versions.title'),
        current: t('versions.current'),
        archived: t('versions.archived'),
        archive: t('versions.archive'),
        restore: t('versions.restore'),
        empty: t('versions.empty'),
        loading: t('common:state.loading'),
        previewHint: t('versions.previewHint'),
        restoreTitle: t('versions.restoreDialogTitle'),
        restoreBody: t('versions.restoreDialogBody'),
        restoreConfirm: t('versions.restoreConfirm'),
        archivedToast: t('versions.archived'),
        restoredToast: t('versions.restored'),
        loadFailed: t('versions.loadFailed'),
        previewFailed: t('versions.previewFailed'),
        archiveFailed: t('versions.archiveFailed'),
        restoreFailed: t('versions.restoreFailed'),
      }}
      source={{
        list: async () => toList(await dashboardApi.listTopologyVersions()),
        currentPreview: async () => currentTopology,
        versionPreview: async (id) =>
          (await dashboardApi.getTopologyVersion(id)).document,
        archive: async () =>
          toList(await dashboardApi.archiveTopologyVersion()),
        restore: async (id) =>
          toList(await dashboardApi.restoreTopologyVersion(id)),
        beforeRestore: onBeforeRestore,
        onRestored,
      }}
      renderPreview={({ value }) => (
        <TopologyVersionPreview topology={value} providers={providers} />
      )}
    />
  )
}
