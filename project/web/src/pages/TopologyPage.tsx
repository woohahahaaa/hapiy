import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ReactFlow,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { AlertTriangle, Loader2, RefreshCw, Wand2, Plus } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { ChannelNode } from '@/nodes/ChannelNode'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { SlotNode } from '@/nodes/SlotNode'
import { NodeMenu } from '@/components/topology/NodeMenu'
import { dashboardApi } from '@/lib/dashboard-api'
import type { Provider } from '@/lib/dashboard-api'
import { getTopologyNodeDimension, topologyConfig } from '@/config/topology-config'
import {
  SLOT_ORDER,
  SLOT_LABELS,
  emptySlotEntryMap,
  useSlotRules,
  type SlotEntry,
  type SlotEntryMap,
  type SlotRuleMap,
  type SlotType,
} from '@/components/topology/slot-items'

const SLOT_KEYS: readonly SlotType[] = SLOT_ORDER

const nodeTypes = {
  modelHub: ModelHubNode,
  channel: ChannelNode,
  slot: SlotNode,
}

const defaultEdgeOptions = {
  animated: topologyConfig.edge.animated,
  style: { strokeWidth: topologyConfig.edge.strokeWidth },
}

type LayoutSnapshot = Record<string, { x: number; y: number }>

function loadLayoutFromStorage(): LayoutSnapshot {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('hapiy-layout')
    if (!raw) return {}
    return JSON.parse(raw) as LayoutSnapshot
  } catch {
    return {}
  }
}

function saveLayoutToStorage(layout: LayoutSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem('hapiy-layout', JSON.stringify(layout))
  } catch {
    // storage may be full — silently skip
  }
}

function loadSlotsFromStorage(providerId: string): SlotEntryMap {
  if (typeof window === 'undefined') return emptySlotEntryMap()
  try {
    const raw = window.localStorage.getItem(`hapiy-slots-${providerId}`)
    if (!raw) return emptySlotEntryMap()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return emptySlotEntryMap()
    return migrateSlotEntryMap(parsed as Partial<SlotEntryMap>)
  } catch {
    return emptySlotEntryMap()
  }
}

// Older schema stored flat `{ index, ruleId, ruleName }` rows. Coerce those into
// the new typed entries so existing browser localStorage keeps working.
function migrateSlotEntryMap(parsed: Partial<SlotEntryMap>): SlotEntryMap {
  const empty = emptySlotEntryMap()
  for (const key of SLOT_KEYS) {
    const list = parsed[key]
    if (!Array.isArray(list)) continue
    const migrated = list.map((raw: unknown, i: number): SlotEntry => {
      const idx = i + 1
      const ruleId = typeof (raw as { ruleId?: unknown }).ruleId === 'string'
        ? (raw as { ruleId: string }).ruleId
        : null
      if (key === 'logOutput') {
        return {
          slotType: 'logOutput',
          index: idx,
          enabled: true,
          logTarget: 'file',
          logLevel: 'info',
          logPath: '',
          recordRequestBefore: true,
          recordRequestAfter: true,
          recordResponseBefore: true,
          recordResponseAfter: true,
        }
      }
      return { slotType: key, index: idx, ruleId, enabled: true }
    })
    setSlotList(empty, key, migrated as SlotEntryMap[typeof key])
  }
  return empty
}

function saveSlotsToStorage(providerId: string, slots: SlotEntryMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`hapiy-slots-${providerId}`, JSON.stringify(slots))
  } catch {
    // storage may be full — silently skip
  }
}

function getLayoutedElements(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: topologyConfig.dagre.direction,
    nodesep: topologyConfig.dagre.nodeSeparation,
    ranksep: topologyConfig.dagre.rankSeparation,
    marginx: topologyConfig.dagre.margin.x,
    marginy: topologyConfig.dagre.margin.y,
  })

  for (const node of nodes) {
    const dimension = getTopologyNodeDimension(node.type)
    g.setNode(node.id, {
      width: dimension.width,
      height: dimension.height,
    })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    const dimension = getTopologyNodeDimension(node.type)
    return { ...node, position: { x: pos.x - dimension.width / 2, y: pos.y - dimension.height / 2 } }
  })
}

function buildModelNodes(
  providers: readonly Provider[],
  modelNodeIds: Record<string, string>,
  layout: LayoutSnapshot,
): Node[] {
  const nodes: Node[] = []
  const uniqueModels = new Set<string>()
  for (const provider of providers) {
    for (const model of provider.models) uniqueModels.add(model.model)
  }
  const sortedModels = Array.from(uniqueModels).sort((a, b) => a.localeCompare(b))

  sortedModels.forEach((modelName, idx) => {
    const nodeId = modelNodeIds[modelName] ?? `model-${modelName}`
    nodes.push({
      id: nodeId,
      type: 'modelHub',
      position: layout[nodeId] ?? {
        x: topologyConfig.initialPositions.modelHub.x,
        y: topologyConfig.initialPositions.modelHub.y + idx * topologyConfig.initialPositions.modelHub.verticalOffset,
      },
      data: { models: [{ id: modelName, label: modelName, disabled: false }], simplified: true },
    })
  })

  return nodes
}

function buildSlotNodes(
  providerId: string,
  slots: SlotEntryMap,
  rules: SlotRuleMap,
  layout: LayoutSnapshot,
  verticalOffset: number,
  onChangeEntry: (providerId: string, slotType: SlotType, next: SlotEntry) => void,
  onDeleteEntry: (providerId: string, slotType: SlotType, index: number) => void,
): Node[] {
  const nodes: Node[] = []
  SLOT_ORDER.forEach((slotType, i) => {
    const entries = slots[slotType] ?? []
    const slotId = `slot-${providerId}-${slotType}`
    nodes.push({
      id: slotId,
      type: 'slot',
      position: layout[slotId] ?? {
        x: topologyConfig.initialPositions.slot.x + i * topologyConfig.initialPositions.slot.horizontalOffset,
        y: topologyConfig.initialPositions.slot.y + verticalOffset * topologyConfig.initialPositions.slot.verticalOffset,
      },
      data: {
        slotType,
        providerId,
        title: SLOT_LABELS[slotType],
        entries,
        rules,
        onChangeEntry: (next: SlotEntry) => onChangeEntry(providerId, slotType, next),
        onDeleteEntry: (index: number) => onDeleteEntry(providerId, slotType, index),
      },
    })
  })
  return nodes
}

function buildEdges(providers: readonly Provider[], modelNodeIds: Record<string, string>): Edge[] {
  const edges: Edge[] = []

  for (const provider of providers) {
    for (const model of provider.models) {
      const modelNodeId = modelNodeIds[model.model]
      if (!modelNodeId) continue
      edges.push({
        id: `${modelNodeId}→ch-${provider.id}-${model.model}`,
        source: modelNodeId,
        sourceHandle: model.model,
        target: `ch-${provider.id}`,
        targetHandle: model.model,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth },
      })
    }
    for (let i = 0; i < SLOT_ORDER.length - 1; i++) {
      const fromType = SLOT_ORDER[i]
      const toType = SLOT_ORDER[i + 1]
      const fromId = `slot-${provider.id}-${fromType}`
      const toId = `slot-${provider.id}-${toType}`
      edges.push({
        id: `${fromId}→${toId}`,
        source: fromId,
        target: toId,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth },
      })
    }

    const firstSlotId = `slot-${provider.id}-${SLOT_ORDER[0]}`
    edges.push({
      id: `ch-${provider.id}→${firstSlotId}`,
      source: `ch-${provider.id}`,
      target: firstSlotId,
      animated: topologyConfig.edge.animated,
      style: { strokeWidth: topologyConfig.edge.strokeWidth },
    })
  }

  return edges
}

export function TopologyPage() {
  const [providers, setProviders] = useState<readonly Provider[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })
  const { rules } = useSlotRules()

  // Slots live in a ref so ReactFlow can mutate freely without re-rendering
  // the whole tree on every add/delete/change.
  const slotsStateRef = useRef<Map<string, SlotEntryMap>>(new Map())
  // Bumped on each write so the ReactFlow nodes tree re-derives.
  const [slotsVersion, setSlotsVersion] = useState(0)
  const bumpSlots = useCallback(() => setSlotsVersion((v) => v + 1), [])

  const handlePaneDoubleClick = useCallback((event: ReactMouseEvent) => {
    if (!(event.target instanceof Element)) return
    if (!event.target.closest('.react-flow__pane')) return
    if (event.target.closest('.react-flow__node')) return
    setMenuState({
      x: event.clientX,
      y: event.clientY,
      open: true,
    })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const channels = await dashboardApi.listProviders()
      setProviders(channels)
      const next = new Map<string, SlotEntryMap>()
      for (const provider of channels) {
        next.set(provider.id, loadSlotsFromStorage(provider.id))
      }
      slotsStateRef.current = next
      bumpSlots()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [bumpSlots])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleChangeEntry = useCallback(
    (providerId: string, slotType: SlotType, next: SlotEntry) => {
      const current = slotsStateRef.current.get(providerId) ?? emptySlotEntryMap()
      const list = current[slotType] ?? []
      const idx = list.findIndex((e) => e.index === next.index)
      const nextList =
        idx >= 0
          ? list.map((e) => (e.index === next.index ? next : e))
          : [...list, next].map((e, i) => reindexSlotItem(e, i + 1, slotType))
      setSlotList(current, slotType, nextList as SlotEntryMap[typeof slotType])
      slotsStateRef.current.set(providerId, current)
      saveSlotsToStorage(providerId, current)
      bumpSlots()
    },
    [bumpSlots],
  )

  const handleDeleteEntry = useCallback(
    (providerId: string, slotType: SlotType, index: number) => {
      const current = slotsStateRef.current.get(providerId) ?? emptySlotEntryMap()
      const list = current[slotType] ?? []
      const nextList = list
        .filter((e) => e.index !== index)
        .map((e, i) => reindexSlotItem(e, i + 1, slotType))
      setSlotList(current, slotType, nextList as SlotEntryMap[typeof slotType])
      slotsStateRef.current.set(providerId, current)
      saveSlotsToStorage(providerId, current)
      bumpSlots()
    },
    [bumpSlots],
  )

  const layoutSnapshot = useMemo(() => loadLayoutFromStorage(), [])

  const modelNodeIds = useMemo(() => {
    const ids: Record<string, string> = {}
    if (!providers) return ids
    const unique = new Set<string>()
    for (const provider of providers) for (const model of provider.models) unique.add(model.model)
    Array.from(unique).sort((a, b) => a.localeCompare(b)).forEach((name) => {
      ids[name] = `model-${name}`
    })
    return ids
  }, [providers])

  const baseNodes = useMemo(() => {
    if (!providers) return []
    const modelNodes = buildModelNodes(providers, modelNodeIds, layoutSnapshot)
    const nodes: Node[] = [...modelNodes]
    providers.forEach((provider) => {
      const verticalOffset = nodes.length
      const slots = slotsStateRef.current.get(provider.id) ?? emptySlotEntryMap()
      nodes.push({
        id: `ch-${provider.id}`,
        type: 'channel',
        position: layoutSnapshot[`ch-${provider.id}`] ?? {
          x: topologyConfig.initialPositions.channel.x,
          y: topologyConfig.initialPositions.channel.y + verticalOffset * topologyConfig.initialPositions.channel.verticalOffset,
        },
        data: {
          label: provider.name,
          baseURLCount: provider.baseUrls.length,
          keyCount: provider.keys.length,
          modelCount: provider.models.length,
          models: provider.models.map((m) => m.model),
          active: provider.status,
          providerId: provider.id,
          onToggle: () => {
            const p = providers.find((x) => x.id === provider.id)
            if (!p) return
            if (!p.status) {
              const other = providers.find(
                (x) => x.id !== p.id && x.name === p.name && x.status,
              )
              if (other) {
                toast.add({ title: '当前已有一个同名渠道在启用，请先将另一个关闭', type: 'error' })
                return
              }
            }
            dashboardApi.toggleProvider(p.id)
              .then((updated) => {
                setProviders((prev) =>
                  prev?.map((x) => (x.id === updated.id ? updated : x)) ?? prev,
                )
              })
              .catch((err) => {
                toast.add({ title: err instanceof Error ? err.message : '切换渠道状态失败', type: 'error' })
              })
          },
        },
      })
      nodes.push(
        ...buildSlotNodes(
          provider.id,
          slots,
          rules,
          layoutSnapshot,
          nodes.length,
          handleChangeEntry,
          handleDeleteEntry,
        ),
      )
    })
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, modelNodeIds, layoutSnapshot, slotsVersion, rules])

  const baseEdges = useMemo(() => {
    if (!providers) return []
    return buildEdges(providers, modelNodeIds)
  }, [providers, modelNodeIds])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)

  useEffect(() => {
    setNodes(baseNodes)
  }, [baseNodes, setNodes])

  const [edges, _setEdges, onEdgesChange] = useEdgesState(baseEdges)

  useEffect(() => {
    _setEdges(baseEdges)
  }, [baseEdges, _setEdges])

  const edgesRef = useRef(edges)
  edgesRef.current = edges

  const handleAutoLayout = useCallback(() => {
    setNodes((nds) => {
      const layouted = getLayoutedElements(nds, edgesRef.current)
      const next: LayoutSnapshot = {}
      for (const node of layouted) next[node.id] = node.position
      saveLayoutToStorage(next)
      return layouted
    })
  }, [setNodes])

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes)
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.dragging) {
        const snapshot = loadLayoutFromStorage()
        snapshot[change.id] = change.position
        saveLayoutToStorage(snapshot)
      }
    }
  }, [onNodesChange])

  const handleAddProvider = useCallback(() => {
    window.location.href = '/provider'
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" subtitle="API routing workspace" />
        <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">加载拓扑数据…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" subtitle="API routing workspace" />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="size-10 text-destructive" />
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={loadData}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!providers || providers.length === 0) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" subtitle="API routing workspace" />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">
              暂无渠道配置。请先在「渠道管理」中添加至少一个模型供应商。
            </p>
            <Button onClick={handleAddProvider}>
              <Plus data-icon="inline-start" />
              添加渠道
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="转发拓扑"
        subtitle="API routing workspace"
        status={`${providers.length} 渠道 · ${nodes.length} 节点`}
      />
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onDoubleClick={handlePaneDoubleClick}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView
          zoomOnDoubleClick={false}
        >
          <Background color={topologyConfig.grid.color} gap={topologyConfig.grid.gap} size={topologyConfig.grid.size} />
          <Panel className="topology-actions" position="bottom-right">
            <Button
              variant="outline"
              size="icon"
              onClick={handleAddProvider}
              title="添加 Provider"
              aria-label="添加 Provider"
            >
              <Plus />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleAutoLayout}
              title="自动布局"
            >
              <Wand2 />
            </Button>
          </Panel>
        </ReactFlow>
        {menuState.open && (
          <NodeMenu
            x={menuState.x}
            y={menuState.y}
            onSelect={handleAddProvider}
            onClose={() => setMenuState((s) => ({ ...s, open: false }))}
          />
        )}
      </div>
    </div>
  )
}

// When the order of items changes (insert/delete), every surviving entry
// must be renumbered to keep the slot's badges contiguous.
function reindexSlotItem(entry: SlotEntry, newIndex: number, slotType: SlotType): SlotEntry {
  if (entry.slotType !== slotType) return entry
  return { ...entry, index: newIndex } as SlotEntry
}

// Typed writer — works around TS's inability to narrow `Map[K] = V` when V is
// a union that varies per key.
function setSlotList<K extends SlotType>(
  map: SlotEntryMap,
  key: K,
  list: SlotEntryMap[K],
): void {
  map[key] = list
}