import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ReactFlow,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AppIcon } from '@/components/AppIcon'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { FlatSlotNode } from '@/nodes/FlatSlotNode'
import { RequestEntryNode } from '@/nodes/RequestEntryNode'
import { FlatCanvasMenu } from '@/components/topology/FlatCanvasMenu'
import { ContextMenu } from '@/components/topology/ContextMenu'
import { dashboardApi, type FlatNode, type FlatTopology, type FlatWire, type Provider } from '@/lib/dashboard-api'
import { topologyConfig } from '@/config/topology-config'
import { useReactFlowNodeSizes } from '@/lib/use-reactflow-node-sizes'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import { SLOT_LABELS, type SlotEntry, type SlotType } from '@/components/topology/slot-items'
import { useSlotRules } from '@/components/topology/slot-items/use-slot-rules'
import {
  canvasFromFlat,
  flatWiresFromCanvas,
  findDuplicateActivations,
  isProviderSlot,
  isRequestEntry,
  isProvider,
  PROVIDER_SLOT_TYPE,
  type RewriteSlotType,
  type FlatCanvas,
} from '@/lib/flat-topology'

const nodeTypes = {
  modelHub: ModelHubNode,
  slot: FlatSlotNode,
  requestEntry: RequestEntryNode,
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

function canvasWiresFromEdges(edges: readonly Edge[]): FlatWire[] {
  return edges
    .filter((e) => !e.source.startsWith('model-'))
    .map((e) => ({ source: e.source, target: e.target }))
}

function wiringEdgeId(source: string, target: string): string {
  return `${source}→${target}`
}

function wouldCreateCycle(wires: readonly FlatWire[], source: string, target: string): boolean {
  if (source === target) return true
  const out = new Map<string, string>()
  for (const w of wires) out.set(w.source, w.target)
  let current = target
  const seen = new Set<string>()
  while (out.has(current)) {
    if (seen.has(current)) return true
    seen.add(current)
    current = out.get(current)!
    if (current === source) return true
  }
  return false
}

function invalidConnectionReason(wires: readonly FlatWire[], source: string, target: string): string | null {
  if (wires.some((w) => w.source === source)) return '每个节点最多一条出边'
  if (wouldCreateCycle(wires, source, target)) return '不能形成环路'
  return null
}

function reaches(wires: readonly FlatWire[], from: string, to: string): boolean {
  const out = new Map<string, string>()
  for (const w of wires) out.set(w.source, w.target)
  let cur: string | undefined = from
  const seen = new Set<string>()
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === to) return true
    seen.add(cur)
    cur = out.get(cur)
  }
  return cur === to
}

export function TopologyPage() {
  const { rules: slotRules } = useSlotRules()
  const [providers, setProviders] = useState<readonly Provider[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tp, setTp] = useState<FlatTopology | null>(null)
  const tpRef = useRef<FlatTopology | null>(null)
  const setTopology = useCallback((next: FlatTopology) => {
    tpRef.current = next
    setTp(next)
  }, [])
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setDirty(true)
  }, [])

  const [menuState, setMenuState] = useState<{ x: number; y: number; open: boolean; mode: 'corner' | 'cursor' }>({
    x: 0,
    y: 0,
    open: false,
    mode: 'cursor',
  })
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const selectionRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const [layoutSnapshot, setLayoutSnapshot] = useState<LayoutSnapshot>(() => loadLayoutFromStorage())
  const layoutSnapshotRef = useRef(layoutSnapshot)
  layoutSnapshotRef.current = layoutSnapshot
  const [setContainerEl, sizesRef] = useReactFlowNodeSizes()

  const canvas: FlatCanvas | null = useMemo(() => (tp ? canvasFromFlat(tp.nodes, tp.wires) : null), [tp])

  const providerByName = useMemo(() => {
    const map = new Map<string, Provider>()
    for (const p of providers ?? []) map.set(p.name, p)
    return map
  }, [providers])

  const updateTopologyNodes = useCallback(
    (updater: (nodes: readonly FlatNode[]) => readonly FlatNode[]) => {
      const cur = tpRef.current
      if (!cur) return
      const nodes = updater(cur.nodes)
      const collapsed = canvasFromFlat(nodes, cur.wires)
      const wires = flatWiresFromCanvas({
        topLevel: collapsed.topLevel,
        providers: collapsed.providers,
        providerSlotOf: collapsed.providerSlotOf,
        canvasWires: canvasWiresFromEdges(edgesRef.current),
      })
      setTopology({ nodes, wires })
      markDirty()
    },
    [setTopology, markDirty],
  )

  const commitCanvasWires = useCallback(
    (nextWires: readonly FlatWire[]) => {
      const cur = tpRef.current
      if (!cur) return
      const collapsed = canvasFromFlat(cur.nodes, cur.wires)
      const wires = flatWiresFromCanvas({
        topLevel: collapsed.topLevel,
        providers: collapsed.providers,
        providerSlotOf: collapsed.providerSlotOf,
        canvasWires: nextWires,
      })
      setTopology({ nodes: cur.nodes, wires })
      markDirty()
    },
    [setTopology, markDirty],
  )

  const handleChangeSlotEntry = useCallback(
    (slotId: string, slotType: SlotType, next: SlotEntry) => {
      const cur = tpRef.current
      if (!cur) return
      const node = cur.nodes.find((n) => n.id === slotId && n.kind === 'slot')
      if (!node) return
      const current = node.entries ?? []
      const idx = current.findIndex((e) => e.index === next.index)
      const raw = idx >= 0 ? current.map((e) => (e.index === next.index ? next : e)) : [...current, next]
      const entries = raw.map((e, i) => reindexSlotItem(e, i + 1, slotType))
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === slotId && n.kind === 'slot' ? { ...n, entries } : n)),
      )
    },
    [updateTopologyNodes],
  )

  const handleDeleteSlotEntry = useCallback(
    (slotId: string, slotType: SlotType, index: number) => {
      const cur = tpRef.current
      if (!cur) return
      const node = cur.nodes.find((n) => n.id === slotId && n.kind === 'slot')
      if (!node) return
      const current = node.entries ?? []
      const surviving = current.filter((e) => e.index !== index)
      if (surviving.length === current.length) return
      const entries = surviving.map((e, i) => reindexSlotItem(e, i + 1, slotType))
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === slotId && n.kind === 'slot' ? { ...n, entries } : n)),
      )
    },
    [updateTopologyNodes],
  )

  const handleReorderSlotEntries = useCallback(
    (slotId: string, slotType: SlotType, fromIndex: number, toIndex: number) => {
      const cur = tpRef.current
      if (!cur) return
      const node = cur.nodes.find((n) => n.id === slotId && n.kind === 'slot')
      if (!node) return
      const sorted = [...(node.entries ?? [])].sort((a, b) => a.index - b.index)
      const from = sorted.findIndex((e) => e.index === fromIndex)
      const to = sorted.findIndex((e) => e.index === toIndex)
      if (from < 0 || to < 0 || from === to) return
      const [moved] = sorted.splice(from, 1)
      sorted.splice(to, 0, moved)
      const entries = sorted.map((e, i) => reindexSlotItem(e, i + 1, slotType))
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === slotId && n.kind === 'slot' ? { ...n, entries } : n)),
      )
    },
    [updateTopologyNodes],
  )

  const reachableProvidersForEntry = useCallback(
    (entryId: string): Array<{ provider: Provider; active: boolean }> => {
      if (!canvas) return []
      const out = new Map<string, string>()
      for (const w of canvas.canvasWires) out.set(w.source, w.target)
      const result: Array<{ provider: Provider; active: boolean }> = []
      const seen = new Set<string>([entryId])
      let cur = out.get(entryId)
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const node = canvas.topLevel.find((n) => n.id === cur)
        if (node && isProviderSlot(node)) {
          for (const p of canvas.providers) {
            if (canvas.providerSlotOf.get(p.id) !== cur || !p.name) continue
            const provider = providerByName.get(p.name)
            if (provider && !result.some((r) => r.provider.name === provider.name)) {
              result.push({ provider, active: p.enabled && provider.status })
            }
          }
        }
        cur = out.get(cur)
      }
      return result
    },
    [canvas, providerByName],
  )

  const modelHubNodes = useMemo(() => {
    if (!canvas) return [] as Node[]
    const nodes: Node[] = []
    for (const entry of canvas.topLevel) {
      if (!isRequestEntry(entry)) continue
      const reachable = reachableProvidersForEntry(entry.id)
      const modelSet = new Map<string, boolean>()
      for (const { provider, active } of reachable) {
        for (const m of provider.models) {
          const prev = modelSet.get(m.model)
          if (prev === undefined) modelSet.set(m.model, active)
          else if (active) modelSet.set(m.model, true)
        }
      }
      const hubId = `hub-${entry.id}`
      const models = Array.from(modelSet.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((model) => ({ id: model, label: model, disabled: !modelSet.get(model) }))
      nodes.push({
        id: hubId,
        type: 'modelHub',
        position: layoutSnapshot[hubId] ?? { x: 20, y: 20 },
        data: { models, simplified: true },
      })
    }
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, reachableProvidersForEntry])

  const topLevelNodes = useMemo(() => {
    if (!canvas) return [] as Node[]
    const nodes: Node[] = []
    for (const node of canvas.topLevel) {
      if (isRequestEntry(node)) {
        nodes.push({
          id: node.id,
          type: 'requestEntry',
          position: layoutSnapshot[node.id] ?? { x: 300, y: 20 },
          data: {
            label: node.name ?? '请求入口',
            enabled: node.enabled,
            weight: node.weight ?? 1,
            onChangeEnabled: (enabled: boolean) => {
              updateTopologyNodes((list) => {
                const next = list.map((n) => (n.id === node.id ? { ...n, enabled } : n))
                if (!enabled) return next
                const nextCollapsed = canvasFromFlat(next, tpRef.current?.wires ?? [])
                const entryReaches = new Set<string>()
                let cur = nextCollapsed.canvasWires.find((w) => w.source === node.id)?.target
                const guard = new Set<string>([node.id])
                while (cur && !guard.has(cur)) {
                  guard.add(cur)
                  entryReaches.add(cur)
                  cur = nextCollapsed.canvasWires.find((w) => w.source === cur)?.target
                }
                const dup = new Set(findDuplicateActivations(next, tpRef.current?.wires ?? []))
                return next.map((n) => {
                  if (n.kind === 'provider' && entryReaches.has(n.id) && dup.has(n.name ?? '')) {
                    return { ...n, enabled: false }
                  }
                  return n
                })
              })
            },
            onChangeWeight: (weight: number) => {
              updateTopologyNodes((list) => list.map((n) => (n.id === node.id ? { ...n, weight } : n)))
            },
          },
        })
      } else if (isProviderSlot(node)) {
        const children = canvas.providers
          .filter((p) => canvas.providerSlotOf.get(p.id) === node.id)
          .map((p) => {
            const provider = p.name ? providerByName.get(p.name) : undefined
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
          position: layoutSnapshot[node.id] ?? { x: 560, y: 20 },
          data: {
            title: 'provider',
            slotType: PROVIDER_SLOT_TYPE,
            isProviderSlot: true,
            children,
            onAddProvider: () => handleAddProvider(node.id),
            onToggleProvider: (providerId: string, enabled: boolean) =>
              updateTopologyNodes((list) => list.map((n) => (n.id === providerId ? { ...n, enabled } : n))),
            onReorderProvider: (from: number, to: number) => handleReorderProvider(node.id, from, to),
          },
        })
      } else {
        const slotType = node.slotType as SlotType
        nodes.push({
          id: node.id,
          type: 'slot',
          position: layoutSnapshot[node.id] ?? { x: 560, y: 20 },
          data: {
            title: SLOT_LABELS[slotType] ?? node.slotType ?? '插槽',
            slotType: node.slotType ?? '',
            isProviderSlot: false,
            entries: [...(node.entries ?? [])],
            rules: slotRules,
            onChangeEntry: (next: SlotEntry) => handleChangeSlotEntry(node.id, slotType, next),
            onDeleteEntry: (index: number) => handleDeleteSlotEntry(node.id, slotType, index),
            onReorderEntries: (from: number, to: number) => handleReorderSlotEntries(node.id, slotType, from, to),
          },
        })
      }
    }
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, layoutSnapshot, providerByName, slotRules])

  const baseNodes = useMemo(() => [...modelHubNodes, ...topLevelNodes], [modelHubNodes, topLevelNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)

  useEffect(() => {
    setNodes(baseNodes)
  }, [baseNodes, setNodes])

  const baseEdges = useMemo<Edge[]>(() => {
    if (!canvas) return []
    const edges: Edge[] = []
    for (const w of canvas.canvasWires) {
      edges.push({
        id: wiringEdgeId(w.source, w.target),
        source: w.source,
        target: w.target,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: 1 },
      })
    }
    const entryIds = new Set(canvas.topLevel.filter(isRequestEntry).map((n) => n.id))
    for (const e of entryIds) {
      const hubId = `hub-${e}`
      const hub = modelHubNodes.find((n) => n.id === hubId)
      const hubData = hub?.data as { models?: Array<{ id: string }> } | undefined
      const modelCount = hubData?.models?.length ?? 0
      if (modelCount === 0) continue
      edges.push({
        id: wiringEdgeId(hubId, e),
        source: hubId,
        target: e,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: 1 },
      })
    }
    return edges
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, modelHubNodes])

  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges)
  const edgesRef = useRef(edges)
  edgesRef.current = edges

  useEffect(() => {
    setEdges(baseEdges)
  }, [baseEdges, setEdges])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [providers, flat] = await Promise.all([
        dashboardApi.listProviders(),
        dashboardApi.getFlatTopology(),
      ])
      setProviders(providers)
      setTopology(flat)
      dirtyRef.current = false
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [setTopology])

  useEffect(() => {
    loadData()
  }, [loadData])

  const persistTopology = useCallback(async () => {
    const cur = tpRef.current
    if (!cur) return
    try {
      await dashboardApi.saveFlatTopology(cur)
      dirtyRef.current = false
      setDirty(false)
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : '拓扑保存失败', type: 'error' })
    }
  }, [])

  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => {
      void persistTopology()
    }, 800)
    return () => clearTimeout(timer)
  }, [dirty, persistTopology])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const handlePaneClick = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handlePaneContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.react-flow__node')) return
    setContextMenu(null)
    setMenuState({ x: event.clientX, y: event.clientY, open: true, mode: 'cursor' })
  }, [])

  const handleNodeClick = useCallback((_event: ReactMouseEvent) => {
    setContextMenu(null)
  }, [])

  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node) => {
    event.preventDefault()
    if (node.type === 'modelHub') return
    setMenuState((s) => ({ ...s, open: false }))
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection
      if (!source || !target) return
      const wiring = canvasWiresFromEdges(edgesRef.current)
      const reason = invalidConnectionReason(wiring, source, target)
      if (reason) {
        toast.add({ title: reason, type: 'error' })
        return
      }
      const newEdge: Edge = {
        id: wiringEdgeId(source, target),
        source,
        target,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: 1 },
      }
      const next = [...edgesRef.current.filter((e) => e.source !== source), newEdge]
      setEdges(next)
      commitCanvasWires(canvasWiresFromEdges(next))
    },
    [setEdges, commitCanvasWires],
  )

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const { source, target } = newConnection
      if (!source || !target) return
      const rest = edgesRef.current.filter((e) => e.id !== oldEdge.id)
      const reason = invalidConnectionReason(canvasWiresFromEdges(rest), source, target)
      if (reason) {
        toast.add({ title: reason, type: 'error' })
        return
      }
      const reconnected: Edge = { ...oldEdge, id: wiringEdgeId(source, target), source, target }
      const next = [...rest, reconnected]
      setEdges(next)
      commitCanvasWires(canvasWiresFromEdges(next))
    },
    [setEdges, commitCanvasWires],
  )

  const handleSelectionChange = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
    selectionRef.current = { nodes: params.nodes, edges: params.edges }
  }, [])

  const handleDeleteSelectedEdges = useCallback(() => {
    const wiringIds = new Set(selectionRef.current.edges.filter((e) => !e.source.startsWith('model-')).map((e) => e.id))
    if (wiringIds.size === 0) return
    const next = edgesRef.current.filter((e) => !wiringIds.has(e.id))
    setEdges(next)
    commitCanvasWires(canvasWiresFromEdges(next))
  }, [setEdges, commitCanvasWires])

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const cur = tpRef.current
      if (!cur) return
      const isSlot = cur.nodes.some((n) => n.id === nodeId && n.kind === 'slot')
      const nodes = cur.nodes.filter((n) => {
        if (n.id === nodeId) return false
        if (isSlot) {
          const collapsed = canvasFromFlat(cur.nodes, cur.wires)
          if (collapsed.providerSlotOf.get(n.id) === nodeId) return false
        }
        return true
      })
      const nextEdges = edgesRef.current.filter((e) => e.source !== nodeId && e.target !== nodeId)
      const collapsed = canvasFromFlat(nodes, cur.wires)
      const wires = flatWiresFromCanvas({
        topLevel: collapsed.topLevel,
        providers: collapsed.providers,
        providerSlotOf: collapsed.providerSlotOf,
        canvasWires: canvasWiresFromEdges(nextEdges),
      })
      setTopology({ nodes, wires })
      setEdges(nextEdges)
      setContextMenu(null)
      markDirty()
    },
    [setTopology, setEdges, markDirty],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const el = event.target as HTMLElement | null
      if (el && el.closest('input, textarea, select, [contenteditable="true"]')) return
      const topLevelIds = selectionRef.current.nodes
        .filter((n) => n.type === 'requestEntry' || n.type === 'slot')
        .map((n) => n.id)
      if (topLevelIds.length > 0) {
        event.preventDefault()
        for (const id of topLevelIds) handleDeleteNode(id)
      } else if (selectionRef.current.edges.some((e) => !e.source.startsWith('model-'))) {
        event.preventDefault()
        handleDeleteSelectedEdges()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleDeleteNode, handleDeleteSelectedEdges])

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes)
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          const snapshot = loadLayoutFromStorage()
          snapshot[change.id] = change.position
          saveLayoutToStorage(snapshot)
          setLayoutSnapshot(snapshot)
        }
      }
    },
    [onNodesChange],
  )

  const handleAutoLayout = useCallback(() => {
    if (!canvas) return
    const positions = layoutFlatCanvas(canvas, baseNodes, {
      nodeGap: topologyConfig.layout.nodeGap,
      rowGap: topologyConfig.layout.rowGap,
      modelHubGap: topologyConfig.layout.modelHubGap,
      groupGap: topologyConfig.layout.groupGap,
      marginX: topologyConfig.layout.marginX,
      marginY: topologyConfig.layout.marginY,
      freeSlotRowWidthFactor: topologyConfig.layout.freeSlotRowWidthFactor,
      slotBaseWidth: topologyConfig.render.slot.shellMinWidth,
    }, sizesRef.current)
    const next: LayoutSnapshot = {}
    for (const [id, pos] of Object.entries(positions)) {
      const node = baseNodes.find((n) => n.id === id)
      if (node) next[id] = pos
    }
    saveLayoutToStorage(next)
    setLayoutSnapshot(next)
    setNodes(baseNodes.map((n) => (next[n.id] ? { ...n, position: next[n.id] } : n)))
  }, [canvas, sizesRef, baseNodes, setNodes])

  const handleAddEntry = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const id = `entry-${crypto.randomUUID().slice(0, 8)}`
    const node: FlatNode = { id, kind: 'requestEntry', name: '请求入口', enabled: true, weight: 1 }
    updateTopologyNodes(() => [...cur.nodes, node])
  }, [updateTopologyNodes])

  const handleAddProviderSlot = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const id = `pslot-${crypto.randomUUID().slice(0, 8)}`
    const node: FlatNode = { id, kind: 'slot', slotType: PROVIDER_SLOT_TYPE, enabled: true }
    updateTopologyNodes(() => [...cur.nodes, node])
  }, [updateTopologyNodes])

  const handleAddSlot = useCallback(
    (slotType: RewriteSlotType) => {
      const cur = tpRef.current
      if (!cur) return
      const id = `${slotType}-${crypto.randomUUID().slice(0, 8)}`
      const node: FlatNode = { id, kind: 'slot', slotType, enabled: true }
      updateTopologyNodes(() => [...cur.nodes, node])
    },
    [updateTopologyNodes],
  )

  const handleAddProvider = useCallback(
    (slotId: string) => {
      const cur = tpRef.current
      if (!cur) return
      const collapsed = canvasFromFlat(cur.nodes, cur.wires)
      const available = (providers ?? []).filter((p) => !collapsed.providers.some((n) => n.name === p.name))
      const provider = available[0]
      if (!provider) {
        toast.add({ title: '没有可添加到该插槽的供应商', type: 'info' })
        return
      }
      const id = `prov-${crypto.randomUUID().slice(0, 8)}`
      const slotInEnabledEntry = cur.nodes.some(
        (n) => n.kind === 'requestEntry' && n.enabled && reaches(cur.wires, n.id, slotId),
      )
      const alreadyActive = findDuplicateActivations(cur.nodes, cur.wires).includes(provider.name)
      const defaultEnabled = !(slotInEnabledEntry && alreadyActive)
      if (!defaultEnabled) {
        toast.add({ title: `同一个 Provider（${provider.name}）不能在多个激活工作流中被启用`, type: 'error' })
      }
      const providerNode: FlatNode = { id, kind: 'provider', name: provider.name, enabled: defaultEnabled }
      const slotIndex = cur.nodes.findIndex((n) => n.id === slotId)
      const insertAt = slotIndex >= 0 ? slotIndex + 1 : cur.nodes.length
      const nextNodes = [...cur.nodes.slice(0, insertAt), providerNode, ...cur.nodes.slice(insertAt)]
      updateTopologyNodes(() => nextNodes)
    },
    [providers, updateTopologyNodes],
  )

  const handleReorderProvider = useCallback(
    (slotId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      updateTopologyNodes((list) => {
        const groupStart = list.findIndex((n) => n.id === slotId)
        if (groupStart < 0) return list
        let groupEnd = groupStart
        while (groupEnd + 1 < list.length && isProvider(list[groupEnd + 1])) groupEnd++
        const children = [...list.slice(groupStart + 1, groupEnd + 1)]
        if (fromIndex < 0 || fromIndex >= children.length || toIndex < 0 || toIndex >= children.length) return list
        const [moved] = children.splice(fromIndex, 1)
        children.splice(toIndex, 0, moved)
        return [...list.slice(0, groupStart + 1), ...children, ...list.slice(groupEnd + 1)]
      })
    },
    [updateTopologyNodes],
  )

  const handleAddFullWorkflow = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const suffix = crypto.randomUUID().slice(0, 8)
    const entryId = `entry-${suffix}`
    const pslotId = `pslot-${suffix}`
    const slotIds: RewriteSlotType[] = ['requestModify', 'responseModify', 'autoReply', 'concurrency', 'autoSwitch', 'logOutput']
    const nodeIds = new Map<RewriteSlotType, string>()
    for (const st of slotIds) nodeIds.set(st, `${st}-${suffix}`)

    const newNodes: FlatNode[] = [
      ...cur.nodes,
      { id: entryId, kind: 'requestEntry', name: '请求入口', enabled: true, weight: 1 },
      { id: pslotId, kind: 'slot', slotType: PROVIDER_SLOT_TYPE, enabled: true },
      ...slotIds.map((st) => ({ id: nodeIds.get(st)!, kind: 'slot' as const, slotType: st, enabled: true })),
    ]
    const chain: FlatWire[] = [
      { source: entryId, target: pslotId },
      { source: pslotId, target: nodeIds.get('requestModify')! },
    ]
    for (let i = 0; i < slotIds.length - 1; i++) {
      chain.push({ source: nodeIds.get(slotIds[i])!, target: nodeIds.get(slotIds[i + 1])! })
    }
    const collapsed = canvasFromFlat(newNodes, [])
    const wires = flatWiresFromCanvas({
      topLevel: collapsed.topLevel,
      providers: collapsed.providers,
      providerSlotOf: collapsed.providerSlotOf,
      canvasWires: chain,
    })
    setTopology({ nodes: newNodes, wires })
    markDirty()
  }, [setTopology, markDirty])

  const handleAddButtonClick = useCallback(() => {
    const btn = addButtonRef.current
    if (!btn) {
      setMenuState({
        x: Math.round(window.innerWidth / 2 + 128),
        y: Math.round(window.innerHeight / 2 + 120),
        open: true,
        mode: 'corner',
      })
      return
    }
    const rect = btn.getBoundingClientRect()
    const gap = 12
    const right = window.innerWidth - rect.left + gap
    const bottom = window.innerHeight - rect.bottom
    setMenuState({ x: right, y: bottom, open: true, mode: 'corner' })
  }, [])

  const activeEntries = useMemo(() => {
    if (!tp) return 0
    return tp.nodes.filter((n) => isRequestEntry(n) && n.enabled && (n.weight ?? 1) > 0).length
  }, [tp])
  const totalEntries = useMemo(() => (tp ? tp.nodes.filter((n) => isRequestEntry(n)).length : 0), [tp])

  if (loading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" />
        <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
          <AppIcon name="progress_activity" size={20} className="animate-spin" />
          <span className="text-sm">加载拓扑数据…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <AppIcon name="warning" size={40} className="text-destructive" />
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={loadData}>
              <AppIcon name="refresh" data-icon="inline-start" />
              重试
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
        status={`请求入口：${activeEntries}/${totalEntries} · ${nodes.filter((n) => n.type !== 'modelHub').length} 节点`}
      />
      <div ref={setContainerEl} className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onPaneClick={handlePaneClick}
          onContextMenu={handlePaneContextMenu}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
          onConnect={handleConnect}
          onReconnect={handleReconnect}
          onSelectionChange={handleSelectionChange}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesConnectable
          edgesReconnectable
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
              onClick={handleAddButtonClick}
              title="添加节点"
              aria-label="添加节点"
              ref={addButtonRef}
            >
              <AppIcon name="add" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleAutoLayout} title="自动布局">
              <AppIcon name="auto_fix_high" />
            </Button>
          </Panel>
        </ReactFlow>
        {menuState.open && (
          <FlatCanvasMenu
            x={menuState.x}
            y={menuState.y}
            mode={menuState.mode}
            onAddFullWorkflow={handleAddFullWorkflow}
            onAddEntry={handleAddEntry}
            onAddProviderSlot={handleAddProviderSlot}
            onAddSlot={handleAddSlot}
            onClose={() => setMenuState((s) => ({ ...s, open: false }))}
          />
        )}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onDelete={() => handleDeleteNode(contextMenu.nodeId)}
            onClose={() => setContextMenu(null)}
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
