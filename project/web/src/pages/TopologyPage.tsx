import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Controls,
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
import { RequestModifyNode } from '@/nodes/RequestModifyNode'
import { ResponseModifyNode } from '@/nodes/ResponseModifyNode'
import { ConcurrencyNode } from '@/nodes/ConcurrencyNode'
import { AutoReplyNode } from '@/nodes/AutoReplyNode'
import { AutoSwitchNode } from '@/nodes/AutoSwitchNode'
import { LogOutputNode } from '@/nodes/LogOutputNode'
import { SlotNode } from '@/nodes/SlotNode'
import { NodeMenu } from '@/components/topology/NodeMenu'
import { dashboardApi } from '@/lib/dashboard-api'
import type { Provider } from '@/lib/dashboard-api'

const SLOT_ORDER = [
  'requestModify',
  'responseModify',
  'autoReply',
  'concurrency',
  'autoSwitch',
  'logOutput',
] as const

type SlotType = (typeof SLOT_ORDER)[number]

const SLOT_LABELS: Record<SlotType, string> = {
  requestModify: '请求改写',
  responseModify: '响应改写',
  autoReply: '心跳回复',
  concurrency: '并发控制',
  autoSwitch: '故障转移',
  logOutput: '日志输出',
}

const nodeTypes = {
  modelHub: ModelHubNode,
  channel: ChannelNode,
  autoReply: AutoReplyNode,
  requestModify: RequestModifyNode,
  responseModify: ResponseModifyNode,
  logOutput: LogOutputNode,
  autoSwitch: AutoSwitchNode,
  concurrency: ConcurrencyNode,
  slot: SlotNode,
}

const defaultEdgeOptions = {
  animated: true,
  style: { strokeWidth: 1.5 },
}

const NODE_W: Record<string, number> = {
  modelHub: 224,
  channel: 192,
  autoReply: 192,
  requestModify: 192,
  responseModify: 192,
  logOutput: 192,
  autoSwitch: 192,
  concurrency: 192,
  slot: 220,
}

const NODE_H: Record<string, number> = {
  modelHub: 200,
  channel: 100,
  autoReply: 120,
  requestModify: 120,
  responseModify: 120,
  logOutput: 220,
  autoSwitch: 140,
  concurrency: 100,
  slot: 180,
}

interface SlotNodeEntry {
  index: number
  ruleId: string
  ruleName: string
}

interface ProviderSlotState {
  providerId: string
  slots: Record<SlotType, SlotNodeEntry[]>
}

function loadSlotsFromStorage(providerId: string): ProviderSlotState['slots'] {
  if (typeof window === 'undefined') return emptySlots()
  try {
    const raw = window.localStorage.getItem(`hapiy-slots-${providerId}`)
    if (!raw) return emptySlots()
    const parsed = JSON.parse(raw) as ProviderSlotState['slots']
    return parsed
  } catch {
    return emptySlots()
  }
}

function emptySlots(): ProviderSlotState['slots'] {
  return {
    requestModify: [],
    responseModify: [],
    autoReply: [],
    concurrency: [],
    autoSwitch: [],
    logOutput: [],
  }
}

function saveSlotsToStorage(providerId: string, slots: ProviderSlotState['slots']): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`hapiy-slots-${providerId}`, JSON.stringify(slots))
  } catch {
    // storage may be full — silently skip
  }
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

function getLayoutedElements(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80, marginx: 20, marginy: 30 })

  for (const node of nodes) {
    g.setNode(node.id, {
      width: NODE_W[node.type as string] ?? 192,
      height: NODE_H[node.type as string] ?? 80,
    })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    const w = NODE_W[node.type as string] ?? 192
    const h = NODE_H[node.type as string] ?? 80
    return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } }
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
      position: layout[nodeId] ?? { x: 20, y: 20 + idx * 60 },
      data: { models: [{ id: modelName, label: modelName, disabled: false }], simplified: true },
    })
  })

  return nodes
}

function buildSlotNodes(
  providerId: string,
  slotStates: Record<string, ProviderSlotState['slots']>,
  layout: LayoutSnapshot,
  verticalOffset: number,
): Node[] {
  const slotsForThisProvider = slotStates[providerId] ?? emptySlots()
  const nodes: Node[] = []
  SLOT_ORDER.forEach((slotType, i) => {
    const slotEntries = slotsForThisProvider[slotType] ?? []
    const slotId = `slot-${providerId}-${slotType}`
    nodes.push({
      id: slotId,
      type: 'slot',
      position: layout[slotId] ?? { x: 700 + i * 220, y: 20 + verticalOffset * 60 },
      data: {
        slotType,
        providerId,
        title: SLOT_LABELS[slotType],
        nodes: slotEntries,
        onAddNode: () => handleAddSlotNode(
          providerId,
          slotType,
          `placeholder-${providerId}-${slotType}`,
          `${SLOT_LABELS[slotType]} #${slotEntries.length + 1}`,
        ),
        onDeleteNode: (idx: number) => handleDeleteSlotNode(providerId, slotType, idx),
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
        animated: true,
        style: { strokeWidth: 1.5 },
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
        animated: true,
        style: { strokeWidth: 1.5 },
      })
    }

    const firstSlotId = `slot-${provider.id}-${SLOT_ORDER[0]}`
    edges.push({
      id: `ch-${provider.id}→${firstSlotId}`,
      source: `ch-${provider.id}`,
      target: firstSlotId,
      animated: true,
      style: { strokeWidth: 1.5 },
    })
  }

  return edges
}

// slotsState container, kept in closure for the add/delete handlers
const slotsStateRef: { current: Map<string, ProviderSlotState['slots']>; setNodes: (updater: (n: Node[]) => Node[]) => void; getNodes: () => Node[]; providersRef: { current: readonly Provider[] } } = {
  current: new Map(),
  setNodes: () => {},
  getNodes: () => [],
  providersRef: { current: [] },
}

function handleAddSlotNode(providerId: string, slotType: SlotType, ruleId: string, ruleName: string): void {
  const slots = slotsStateRef.current.get(providerId) ?? emptySlots()
  const list = slots[slotType] ?? []
  const newEntry: SlotNodeEntry = {
    index: list.length + 1,
    ruleId,
    ruleName,
  }
  slots[slotType] = [...list, newEntry]
  slotsStateRef.current.set(providerId, slots)
  saveSlotsToStorage(providerId, slots)
  refreshTopologyNodes()
}

function handleDeleteSlotNode(providerId: string, slotType: SlotType, idx: number): void {
  const slots = slotsStateRef.current.get(providerId) ?? emptySlots()
  const list = slots[slotType] ?? []
  slots[slotType] = list
    .filter((n) => n.index !== idx)
    .map((n, i) => ({ ...n, index: i + 1 }))
  slotsStateRef.current.set(providerId, slots)
  saveSlotsToStorage(providerId, slots)
  refreshTopologyNodes()
}

function refreshTopologyNodes(): void {
  const providers = slotsStateRef.providersRef.current
  if (providers.length === 0) return
  slotsStateRef.setNodes((nodes) => [...nodes])
}

export function TopologyPage() {
  const [providers, setProviders] = useState<readonly Provider[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuState({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      open: true,
    })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const channels = await dashboardApi.listProviders()
      setProviders(channels)
      slotsStateRef.providersRef.current = channels
      const slotStatesObj: Record<string, ProviderSlotState['slots']> = {}
      for (const provider of channels) {
        slotStatesObj[provider.id] = loadSlotsFromStorage(provider.id)
        slotsStateRef.current.set(provider.id, slotStatesObj[provider.id])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

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
    const slotStatesObj: Record<string, ProviderSlotState['slots']> = {}
    for (const [providerId, slots] of slotsStateRef.current.entries()) {
      slotStatesObj[providerId] = slots
    }
    const modelNodes = buildModelNodes(providers, modelNodeIds, layoutSnapshot)
    const nodes: Node[] = [...modelNodes]
    providers.forEach((provider) => {
      const verticalOffset = nodes.length
      nodes.push({
        id: `ch-${provider.id}`,
        type: 'channel',
        position: layoutSnapshot[`ch-${provider.id}`] ?? { x: 450, y: 20 + verticalOffset * 60 },
        data: {
          label: provider.name,
          baseURLCount: provider.baseUrls.length,
          keyCount: provider.keys.length,
          modelCount: provider.models.length,
          models: provider.models.map((m) => m.model),
          active: provider.status,
          providerId: provider.id,
          onToggle: () => {
            const p = slotsStateRef.providersRef.current.find((x) => x.id === provider.id)
            if (!p) return
            if (!p.status) {
              const other = slotsStateRef.providersRef.current.find(
                (x) => x.id !== p.id && x.name === p.name && x.status,
              )
              if (other) {
                toast('当前已有一个同名渠道在启用，请先将另一个关闭', 'error')
                return
              }
            }
            dashboardApi.toggleProvider(p.id)
              .then((updated) => {
                slotsStateRef.providersRef.current = slotsStateRef.providersRef.current.map((x) =>
                  x.id === updated.id ? updated : x,
                )
                setProviders((prev) =>
                  prev?.map((x) => (x.id === updated.id ? updated : x)) ?? prev,
                )
              })
              .catch((err) => {
                toast(err instanceof Error ? err.message : '切换渠道状态失败', 'error')
              })
          },
        },
      })
      nodes.push(...buildSlotNodes(provider.id, slotStatesObj, layoutSnapshot, nodes.length))
    })
    return nodes
  }, [providers, modelNodeIds, layoutSnapshot])

  const baseEdges = useMemo(() => {
    if (!providers) return []
    return buildEdges(providers, modelNodeIds)
  }, [providers, modelNodeIds])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)

  useEffect(() => {
    setNodes(baseNodes)
  }, [baseNodes, setNodes])

  useEffect(() => {
    slotsStateRef.setNodes = (updater) => setNodes((prev) => updater(prev))
  }, [setNodes])

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
      <div className="relative flex-1" onDoubleClick={handleCanvasDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Controls className="topology-controls" position="bottom-right" />
          <Background color="var(--border)" gap={20} size={1} />
          <Panel className="topology-auto-layout" position="bottom-right">
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
