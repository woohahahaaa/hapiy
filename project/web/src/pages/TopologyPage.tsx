import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/PageHeader'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { FlatSlotNode } from '@/nodes/FlatSlotNode'
import { RequestEntryNode } from '@/nodes/RequestEntryNode'
import { FlatCanvasMenu } from '@/components/topology/FlatCanvasMenu'
import { FlowColorsPanel } from '@/components/topology/FlowColorsPanel'
import { TopologyVersionsModal } from '@/components/TopologyVersionsModal'
import { dashboardApi, type ActiveRequest, type FlatNode, type FlatTopology, type FlatWire, type LayoutSnapshot, type Provider } from '@/lib/dashboard-api'
import { FlowLightEdge, type FlowLightPayload } from '@/edges/FlowLightEdge'
import { topologyConfig } from '@/config/topology-config'
import { useReactFlowNodeSizes } from '@/lib/use-reactflow-node-sizes'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import { SLOT_LABELS, type SlotEntry, type SlotType } from '@/components/topology/slot-items'
import { useSlotRules } from '@/components/topology/slot-items/use-slot-rules'
import {
  buildCopySnapshot,
  pasteTopologySnapshot,
  sameFlatTopology,
  type TopologyClipboardSnapshot,
} from '@/lib/topology-clipboard'
import {
  canvasFromFlat,
  flatWiresFromCanvas,
  findDuplicateActivations,
  isProviderSlot,
  isRequestEntry,
  isProvider,
  PROVIDER_SLOT_TYPE,
  ALL_SLOT_TYPES,
  rerouteWiresAroundRemoved,
  type RewriteSlotType,
  type FlatCanvas,
} from '@/lib/flat-topology'

const nodeTypes = {
  modelHub: ModelHubNode,
  slot: FlatSlotNode,
  requestEntry: RequestEntryNode,
}

const edgeTypes = {
  flowLight: FlowLightEdge,
}

// Flow-light animation timing (ms): each chain edge sweeps FLOW_PER_EDGE_MS;
// one full chain cycle lasts edgeCount * FLOW_PER_EDGE_MS and loops while the
// request is active. FLOW_SYNC_INTERVAL_MS mirrors the activity page poll.
const FLOW_PER_EDGE_MS = 340
const FLOW_SYNC_INTERVAL_MS = 2000
const FLOW_COLORS_SETTING_KEY = 'flow_light_colors'

const defaultEdgeOptions = {
  animated: topologyConfig.edge.animated,
  style: { strokeWidth: topologyConfig.edge.strokeWidth },
}

function canvasWiresFromEdges(edges: readonly Edge[]): FlatWire[] {
  return edges
    .filter((e) => !e.source.startsWith('model-'))
    .map((e) => ({ source: e.source, target: e.target }))
}

function wiringEdgeId(source: string, target: string): string {
  return `${source}→${target}`
}

/**
 * Ordered node-id chain a request for `model` travels, starting at the
 * `model-{model}` hub node and ending at the workflow's last node. Every chain
 * the hub fans out to is collected by DFS (a model hub may wire to several
 * entries; other nodes have at most one outgoing edge). When `providerName` is
 * given, prefer the chain whose provider slot hosts that provider. Returns null
 * when the model node is not wired into the current canvas.
 */
function computeLightChain(
  model: string,
  providerName: string | null,
  edges: readonly Edge[],
  canvas: FlatCanvas | null,
): string[] | null {
  const modelId = `model-${model}`
  const outgoing = new Map<string, Set<string>>()
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? new Set<string>()
    targets.add(edge.target)
    outgoing.set(edge.source, targets)
  }
  if (!outgoing.has(modelId)) return null

  const chains: string[][] = []
  const path: string[] = [modelId]
  const visit = (node: string) => {
    const nexts = outgoing.get(node)
    if (!nexts || nexts.size === 0) {
      chains.push([...path])
      return
    }
    for (const next of nexts) {
      if (path.includes(next)) continue
      path.push(next)
      visit(next)
      path.pop()
    }
  }
  visit(modelId)

  if (providerName && canvas) {
    for (const provider of canvas.providers) {
      if (provider.name !== providerName) continue
      const slotId = canvas.providerSlotOf.get(provider.id)
      if (!slotId) continue
      const matched = chains.find((chain) => chain.includes(slotId))
      if (matched) return matched
    }
  }
  return chains[0] ?? null
}

/**
 * A provider child is unusable when its own canvas toggle is off or the
 * registered provider is disabled/auto-disabled/non-workflow/duplicated.
 */
function providerUnavailable(
  node: FlatNode,
  providerByName: Map<string, Provider>,
  duplicateProviderNames: Set<string>,
): boolean {
  if (node.enabled !== true) return true
  if (node.name && duplicateProviderNames.has(node.name)) return true
  const provider = node.name ? providerByName.get(node.name) : undefined
  if (!provider) return true
  if (provider.status === false || provider.workflowEnabled === false || provider.autoDisabled === true) return true
  return false
}

/**
 * Truncate a flow-light chain at the first internal break point so the light
 * stops instead of travelling past it. Rules: a closed request entry stops the
 * light right after the model hub; a provider slot whose inspected provider(s)
 * are all unusable stops it at the slot itself. Backend-side failures (upstream
 * errors, disconnects) are invisible here and never truncate.
 */
function applyInternalBreak(
  chain: string[],
  providerName: string | null,
  canvas: FlatCanvas | null,
  providerByName: Map<string, Provider>,
  duplicateProviderNames: Set<string>,
): string[] {
  if (!canvas || chain.length < 2) return chain

  const entry = canvas.topLevel.find((n) => n.id === chain[1] && isRequestEntry(n))
  if (entry && entry.enabled !== true) return chain.slice(0, 2)

  let slotId: string | null = null
  let namedProvider: FlatNode | null = null
  if (providerName) {
    for (const p of canvas.providers) {
      if (p.name !== providerName) continue
      const sid = canvas.providerSlotOf.get(p.id)
      if (sid && chain.includes(sid)) {
        slotId = sid
        namedProvider = p
        break
      }
    }
  }
  if (slotId === null) {
    slotId = chain.find((nodeId) => canvas.providers.some((p) => canvas.providerSlotOf.get(p.id) === nodeId)) ?? null
  }
  if (slotId === null) return chain
  const breakIndex = chain.indexOf(slotId)
  if (breakIndex < 0) return chain

  const children = canvas.providers.filter((p) => canvas.providerSlotOf.get(p.id) === slotId)
  const blocked = namedProvider
    ? providerUnavailable(namedProvider, providerByName, duplicateProviderNames)
    : children.length > 0 && children.every((p) => providerUnavailable(p, providerByName, duplicateProviderNames))
  return blocked ? chain.slice(0, breakIndex + 1) : chain
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

function slotLabel(slotType: string): string {
  return SLOT_LABELS[slotType as SlotType] ?? slotType ?? '插槽'
}

/**
 * Walk the chain that the prospective new wire (source→target) would join,
 * merging the new edge into the graph first so `target` is included. Starting at
 * the chain head (a node with no incoming wire) and following the single-output
 * wires, collect every slot node in the chain. Reject the connection when any
 * slot type appears more than once — a workflow cannot contain two nodes of the
 * same stage.
 */
function slotDuplicateReason(
  nodes: readonly FlatNode[],
  wires: readonly FlatWire[],
  source: string,
  target: string,
): string | null {
  const withNew = [...wires, { source, target }]
  const out = new Map<string, string>()
  for (const w of withNew) out.set(w.source, w.target)
  const hasIncoming = new Set(withNew.map((w) => w.target))

  let head = source
  const seenUp = new Set<string>()
  while (hasIncoming.has(head) && !seenUp.has(head)) {
    seenUp.add(head)
    const prev = withNew.find((w) => w.target === head)?.source
    if (prev === undefined) break
    head = prev
  }

  const slotTypeOf = new Map<string, string>()
  for (const n of nodes) if (n.kind === 'slot') slotTypeOf.set(n.id, n.slotType ?? '')

  const seenSlotTypes = new Map<string, string>()
  const visited = new Set<string>()
  let cur: string | undefined = head
  while (cur !== undefined && !visited.has(cur)) {
    visited.add(cur)
    const st = slotTypeOf.get(cur)
    if (st) {
      const prior = seenSlotTypes.get(st)
      if (prior !== undefined && prior !== cur) {
        return `一个工作流里面不能有多个${slotLabel(st)}`
      }
      seenSlotTypes.set(st, cur)
    }
    cur = out.get(cur)
  }
  return null
}

function invalidConnectionReason(
  nodes: readonly FlatNode[],
  wires: readonly FlatWire[],
  source: string,
  target: string,
): string | null {
  if (wires.some((w) => w.source === source)) return '每个节点最多一条出边'
  if (wouldCreateCycle(wires, source, target)) return '不能形成环路'
  return slotDuplicateReason(nodes, wires, source, target)
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

function externallyDisabledSlotIds(topology: FlatTopology): Set<string> {
  const disabled = new Set<string>()
  const enabledEntries = topology.nodes.filter((n) => isRequestEntry(n) && n.enabled === true)
  for (const node of topology.nodes) {
    if (node.kind !== 'slot') continue
    // logOutput slots own their start/stop switch and stay interactive
    // regardless of whether they are reachable from an enabled entry.
    if (node.slotType === 'logOutput') continue
    const reachable = enabledEntries.some((entry) => reaches(topology.wires, entry.id, node.id))
    if (!reachable) disabled.add(node.id)
  }
  return disabled
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
  const [flowColors, setFlowColors] = useState<readonly string[]>([])
  const flowColorsRef = useRef<readonly string[]>([])
  const modelColorRef = useRef<Map<string, string>>(new Map())
  const applyFlowColors = useCallback((next: readonly string[]) => {
    flowColorsRef.current = next
    setFlowColors(next)
  }, [])
  const handleFlowColorsChange = useCallback((next: string[]) => {
    applyFlowColors(next)
    void dashboardApi.updateSetting(FLOW_COLORS_SETTING_KEY, JSON.stringify(next)).catch(() => {
      // palette is kept in memory even if persistence fails
    })
  }, [applyFlowColors])
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setDirty(true)
  }, [])
  const [versionsOpen, setVersionsOpen] = useState(false)
  const lastKnownVersionRef = useRef<number | null>(null)
  const lastKnownLayoutVersionRef = useRef<number | null>(null)

  const MAX_HISTORY = 100
  const historyRef = useRef<FlatTopology[]>([])
  const redoRef = useRef<FlatTopology[]>([])
  const clipboardRef = useRef<TopologyClipboardSnapshot | null>(null)
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })
  const syncHistory = useCallback(() => {
    setHistoryState({ undo: historyRef.current.length, redo: redoRef.current.length })
  }, [])
  const commitHistory = useCallback(
    (before: FlatTopology) => {
      historyRef.current.push(before)
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift()
      redoRef.current = []
      syncHistory()
    },
    [syncHistory],
  )

  const [menuState, setMenuState] = useState<{ x: number; y: number; open: boolean; mode: 'corner' | 'cursor' }>({
    x: 0,
    y: 0,
    open: false,
    mode: 'cursor',
  })
  const addButtonRef = useRef<HTMLButtonElement>(null)

  // ── Selection mode toggle ──
  // Click the button in the bottom-right panel to enter selection mode. In this
  // mode every drag (mouse or touch) draws a selection box. After one selection
  // completes the mode auto-exits so normal panning resumes.
  const [selMode, setSelMode] = useState(false)
  const [selBox, setSelBox] = useState<{
    startX: number; startY: number; currentX: number; currentY: number
  } | null>(null)
  const selModeRef = useRef(false)

  const handleSelStart = useCallback((clientX: number, clientY: number) => {
    if (!selModeRef.current) return
    setSelBox({ startX: clientX, startY: clientY, currentX: clientX, currentY: clientY })
  }, [])
  const handleSelMove = useCallback((clientX: number, clientY: number) => {
    setSelBox((prev) => (prev ? { ...prev, currentX: clientX, currentY: clientY } : prev))
  }, [])
  const handleSelEnd = useCallback(() => {
    if (!selBox) return
    const x1 = Math.min(selBox.startX, selBox.currentX)
    const y1 = Math.min(selBox.startY, selBox.currentY)
    const x2 = Math.max(selBox.startX, selBox.currentX)
    const y2 = Math.max(selBox.startY, selBox.currentY)
    const nodeEls = document.querySelectorAll('.react-flow__node')
    const selectedIds = new Set<string>()
    nodeEls.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const intersects = rect.left < x2 && rect.right > x1 && rect.top < y2 && rect.bottom > y1
      const nodeId = el.getAttribute('data-id')
      if (nodeId && intersects) selectedIds.add(nodeId)
    })
    setNodesRef.current((nds) => nds.map((n) => ({ ...n, selected: selectedIds.has(n.id) })))
    setSelBox(null)
    setSelMode(false)
  }, [selBox])

  const selPointerDown = useCallback((e: React.PointerEvent) => {
    handleSelStart(e.clientX, e.clientY)
  }, [handleSelStart])
  const selPointerMove = useCallback((e: React.PointerEvent) => {
    handleSelMove(e.clientX, e.clientY)
  }, [handleSelMove])
  const selPointerUp = useCallback(() => {
    handleSelEnd()
  }, [handleSelEnd])

  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    const t = e.touches[0]
    handleSelStart(t.clientX, t.clientY)
  }, [handleSelStart])
  const handleTouchMove = useCallback((e: ReactTouchEvent) => {
    const t = e.touches[0]
    handleSelMove(t.clientX, t.clientY)
  }, [handleSelMove])
  const handleTouchEnd = useCallback(() => {
    handleSelEnd()
  }, [handleSelEnd])

  const selectionRef = useRef<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] })
  const [layoutSnapshot, setLayoutSnapshot] = useState<LayoutSnapshot>({})
  const layoutSnapshotRef = useRef(layoutSnapshot)
  layoutSnapshotRef.current = layoutSnapshot
  const [setContainerEl, sizesRef] = useReactFlowNodeSizes()

  const canvas: FlatCanvas | null = useMemo(() => (tp ? canvasFromFlat(tp.nodes, tp.wires) : null), [tp])

  const externallyDisabledSet = useMemo(() => (tp ? externallyDisabledSlotIds(tp) : new Set<string>()), [tp])

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
      // Rebuild wires from the persisted topology instead of the live ReactFlow
      // edges: edgesRef can lag behind state updates (or miss model edges),
      // which made every node-only change (adding an entry, adding a slot item,
      // reordering) drop wires. canvasFromFlat collapses the current wires, and
      // flatWiresFromCanvas re-expands them, so the round-trip is stable while
      // still picking up provider primary changes.
      const collapsed = canvasFromFlat(nodes, cur.wires)
      const wires = flatWiresFromCanvas({
        topLevel: collapsed.topLevel,
        providers: collapsed.providers,
        providerSlotOf: collapsed.providerSlotOf,
        canvasWires: collapsed.canvasWires,
      })
      const next: FlatTopology = { nodes, wires }
      if (sameFlatTopology(cur, next)) return
      commitHistory(cur)
      setTopology(next)
      markDirty()
    },
    [setTopology, markDirty, commitHistory],
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
      const next: FlatTopology = { nodes: cur.nodes, wires }
      if (sameFlatTopology(cur, next)) return
      commitHistory(cur)
      setTopology(next)
      markDirty()
    },
    [setTopology, markDirty, commitHistory],
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

  const handleToggleLog = useCallback(
    (slotId: string, enabled: boolean) => {
      updateTopologyNodes((list) =>
        list.map((n) =>
          n.id === slotId && n.kind === 'slot'
            ? { ...n, enabled, ...(enabled ? {} : { logDeadlineAt: null }) }
            : n,
        ),
      )
    },
    [updateTopologyNodes],
  )

  const handleStartLogCapture = useCallback(
    (slotId: string, deadlineAt: number) => {
      updateTopologyNodes((list) =>
        list.map((n) =>
          n.id === slotId && n.kind === 'slot'
            ? { ...n, enabled: true, logDeadlineAt: deadlineAt }
            : n,
        ),
      )
    },
    [updateTopologyNodes],
  )

  const handleSetLogDeadline = useCallback(
    (slotId: string, deadlineAt: number | null) => {
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === slotId && n.kind === 'slot' ? { ...n, logDeadlineAt: deadlineAt } : n)),
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

  const duplicateProviderNames = useMemo(() => {
    if (!tp) return new Set<string>()
    return new Set(findDuplicateActivations(tp.nodes, tp.wires))
  }, [tp])

  const reachableProvidersForEntry = useCallback(
    (entryId: string): Array<{ provider: Provider; active: boolean }> => {
      if (!canvas) return []
      const entryEnabled = canvas.topLevel.find((n) => n.id === entryId && isRequestEntry(n))?.enabled ?? false
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
              result.push({
                provider,
                active:
                  entryEnabled &&
                  p.enabled &&
                  provider.status &&
                  !provider.autoDisabled &&
                  provider.workflowEnabled &&
                  !duplicateProviderNames.has(provider.name),
              })
            }
          }
        }
        cur = out.get(cur)
      }
      return result
    },
    [canvas, providerByName, duplicateProviderNames],
  )

  const modelNodes = useMemo(() => {
    const empty = {
      nodes: [] as Node[],
      entryModels: new Map<string, Array<{ id: string; label: string; active: boolean }>>(),
      modelLinks: [] as Array<{ nodeId: string; entryId: string; modelName: string; active: boolean }>,
    }
    if (!canvas) return empty

    // 全局去重：每个模型名只生成一个节点，所有入口共享。
    // 同时记录每个入口的可达模型列表（用于 handlebar 和连线）。
    const globalModelActive = new Map<string, boolean>()
    const entryModelInfo = new Map<string, Map<string, boolean>>()
    for (const entry of canvas.topLevel) {
      if (!isRequestEntry(entry)) continue
      const reachable = reachableProvidersForEntry(entry.id)
      const perEntry = new Map<string, boolean>()
      for (const { provider, active } of reachable) {
        for (const m of provider.models) {
          const prev = perEntry.get(m.model)
          if (prev === undefined) perEntry.set(m.model, active)
          else if (active) perEntry.set(m.model, true)
          const gPrev = globalModelActive.get(m.model)
          if (gPrev === undefined) globalModelActive.set(m.model, active)
          else if (active) globalModelActive.set(m.model, true)
        }
      }
      entryModelInfo.set(entry.id, perEntry)
    }

    const nodes: Node[] = []
    const modelLinks: Array<{ nodeId: string; entryId: string; modelName: string; active: boolean }> = []
    const entryModels = new Map<string, Array<{ id: string; label: string; active: boolean }>>()

    const sortedModelNames = Array.from(globalModelActive.keys()).sort((a, b) => a.localeCompare(b))
    const palette = flowColors.length > 0 ? flowColors : null
    const colorMap = new Map<string, string>()
    for (const [i, m] of sortedModelNames.entries()) {
      const nodeId = `model-${m}`
      const active = globalModelActive.get(m) ?? false
      const color = palette ? palette[i % palette.length] : 'var(--primary)'
      colorMap.set(m, color)
      nodes.push({
        id: nodeId,
        type: 'modelHub',
        position: layoutSnapshot[nodeId] ?? { x: 20, y: 20 },
        data: { models: [{ id: m, label: m, color, disabled: !active }], simplified: true },
      })
    }
    modelColorRef.current = colorMap

    for (const entry of canvas.topLevel) {
      if (!isRequestEntry(entry)) continue
      const perEntry = entryModelInfo.get(entry.id) ?? new Map()
      const modelNames = Array.from(perEntry.keys()).sort((a, b) => a.localeCompare(b))
      entryModels.set(
        entry.id,
        modelNames.map((m) => ({ id: m, label: m, active: perEntry.get(m) ?? false })),
      )
      for (const m of modelNames) {
        const nodeId = `model-${m}`
        const active = perEntry.get(m) ?? false
        modelLinks.push({ nodeId, entryId: entry.id, modelName: m, active })
      }
    }

    return { nodes, entryModels, modelLinks }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, reachableProvidersForEntry, layoutSnapshot, flowColors])

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
            models: modelNodes.entryModels.get(node.id) ?? [],
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
              baseURLCount: provider?.baseUrls.length ?? 0,
              keyCount: provider?.keys.length ?? 0,
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
            externallyDisabled: externallyDisabledSet.has(node.id),
            children,
            providers: (providers ?? []).map((p) => p.name),
            onAddProvider: () => handleAddProvider(node.id),
            onSelectProvider: (providerId: string, name: string) => handleSelectProvider(providerId, name),
            onToggleProvider: (providerId: string, enabled: boolean) =>
              updateTopologyNodes((list) => list.map((n) => (n.id === providerId ? { ...n, enabled } : n))),
            onDeleteProvider: (providerId: string) => handleDeleteNode(providerId),
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
            enabled: node.enabled,
            isProviderSlot: false,
            externallyDisabled: externallyDisabledSet.has(node.id),
            entries: [...(node.entries ?? [])],
            rules: slotRules,
            onChangeEntry: (next: SlotEntry) => handleChangeSlotEntry(node.id, slotType, next),
            onDeleteEntry: (index: number) => handleDeleteSlotEntry(node.id, slotType, index),
            onReorderEntries: (from: number, to: number) => handleReorderSlotEntries(node.id, slotType, from, to),
            onAutoCloseEntry: () => {
              void persistTopology()
            },
            ...(slotType === 'logOutput'
              ? {
                  logDeadlineAt: node.logDeadlineAt ?? null,
                  onToggleLog: (nextEnabled: boolean) => handleToggleLog(node.id, nextEnabled),
                  onSetLogDeadline: (deadlineAt: number | null) => handleSetLogDeadline(node.id, deadlineAt),
                  onStartCapture: (deadlineAt: number) => handleStartLogCapture(node.id, deadlineAt),
                }
              : {}),
          },
        })
      }
    }
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, layoutSnapshot, providerByName, slotRules, modelNodes, externallyDisabledSet])

  const baseNodes = useMemo(() => [...modelNodes.nodes, ...topLevelNodes], [modelNodes, topLevelNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)
  const setNodesRef = useRef(setNodes)
  setNodesRef.current = setNodes

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
        type: 'flowLight',
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: 1 },
      })
    }
    for (const link of modelNodes.modelLinks) {
      edges.push({
        id: wiringEdgeId(link.nodeId, link.entryId),
        source: link.nodeId,
        target: link.entryId,
        type: 'flowLight',
        sourceHandle: link.modelName,
        targetHandle: link.modelName,
        animated: topologyConfig.edge.animated,
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: link.active ? 0.5 : 0.3 },
      })
    }
    return edges
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, modelNodes])

  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges)
  const edgesRef = useRef(edges)
  edgesRef.current = edges

  useEffect(() => {
    setEdges(baseEdges)
  }, [baseEdges, setEdges])

  // ── Flow light (request_started SSE) ──
  // The backend emits `request_started` when a queued request begins executing
  // and `request_finished` when it ends. While at least one request for a model
  // is active, the primary-color beam loops down its workflow chain; when the
  // last request finishes the beam is removed.
  const canvasRef = useRef<FlatCanvas | null>(null)
  canvasRef.current = canvas
  const flowRunIdRef = useRef(0)
  const modelRunRef = useRef<Map<string, number>>(new Map())

  const clearLightForModel = useCallback(
    (model: string) => {
      const runId = modelRunRef.current.get(model)
      if (runId === undefined) return
      modelRunRef.current.delete(model)
      setEdges((prev) =>
        prev.map((edge) => {
          const light = edge.data?.light as FlowLightPayload | undefined
          if (!light || light.runId !== runId) return edge
          const rest: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(edge.data ?? {})) {
            if (key !== 'light') rest[key] = value
          }
          return { ...edge, data: Object.keys(rest).length > 0 ? rest : undefined }
        }),
      )
    },
    [setEdges],
  )

  const applyLightToChain = useCallback(
    (model: string, chain: string[]) => {
      const runId = (flowRunIdRef.current += 1)
      modelRunRef.current.set(model, runId)
      const edgeCount = chain.length - 1
      const cycleMs = edgeCount * FLOW_PER_EDGE_MS
      const color = modelColorRef.current.get(model) ?? 'var(--primary)'
      const lights = new Map<string, FlowLightPayload>()
      for (let i = 0; i < edgeCount; i++) {
        lights.set(wiringEdgeId(chain[i], chain[i + 1]), {
          runId,
          cycleMs,
          phaseMs: i * FLOW_PER_EDGE_MS,
          durMs: FLOW_PER_EDGE_MS,
          color,
        })
      }
      setEdges((prev) =>
        prev.map((edge) => {
          const light = lights.get(edge.id)
          if (!light) return edge
          return { ...edge, data: { ...edge.data, light } }
        }),
      )
    },
    [setEdges],
  )

  // Same monitoring source as the activity page: poll the active-requests API
  // and mirror it with flow lights. A model with at least one in-flight
  // request (endTime null) gets a looping beam down its workflow chain; once
  // no request for it remains, the beam is removed. Polling (not SSE events)
  // keeps the topology in sync with the activity page even across page
  // switches or dropped connections.
  const syncFlowLights = useCallback(async () => {
    let requests: readonly ActiveRequest[]
    try {
      requests = await dashboardApi.getActiveRequests()
    } catch {
      return
    }
    const activeModels = new Map<string, string | null>()
    for (const req of requests) {
      if (req.endTime === null) activeModels.set(req.model, req.provider ?? null)
    }
    for (const [model, provider] of activeModels) {
      if (modelRunRef.current.has(model)) continue
      const chain = computeLightChain(model, provider, edgesRef.current, canvasRef.current)
      if (!chain || chain.length < 2) continue
      const chainWithBreak = applyInternalBreak(chain, provider, canvasRef.current, providerByName, duplicateProviderNames)
      if (chainWithBreak.length < 2) continue
      applyLightToChain(model, chainWithBreak)
    }
    for (const model of [...modelRunRef.current.keys()]) {
      if (!activeModels.has(model)) clearLightForModel(model)
    }
  }, [providerByName, duplicateProviderNames, applyLightToChain, clearLightForModel])

  useEffect(() => {
    void syncFlowLights()
    const timer = window.setInterval(() => void syncFlowLights(), FLOW_SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [syncFlowLights])
  const loadLayoutBestEffort = useCallback(async () => {
    try {
      const layout = await dashboardApi.getLayout()
      setLayoutSnapshot(layout.layout)
      lastKnownLayoutVersionRef.current = layout.version
    } catch {
      setLayoutSnapshot({})
      lastKnownLayoutVersionRef.current = null
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [providers, flat, settings] = await Promise.all([
        dashboardApi.listProviders({ limit: 1000, offset: 0 }),
        dashboardApi.getFlatTopology(),
        dashboardApi.getSettings(),
      ])
      setProviders(providers.providers)
      historyRef.current = []
      redoRef.current = []
      syncHistory()
      setTopology(flat)
      lastKnownVersionRef.current = flat.version ?? null
      dirtyRef.current = false
      setDirty(false)
      const stored = settings.find((s) => s.key === FLOW_COLORS_SETTING_KEY)
      if (stored) {
        try {
          const parsed = JSON.parse(stored.value)
          if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
            applyFlowColors(parsed)
          }
        } catch {
          // malformed stored palette: fall back to theme colour
        }
      }
      await loadLayoutBestEffort()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [setTopology, syncHistory, loadLayoutBestEffort, applyFlowColors])

  useEffect(() => {
    loadData()
  }, [loadData])

  const persistTopology = useCallback(async () => {
    const cur = tpRef.current
    if (!cur) return
    try {
      const saved = await dashboardApi.saveFlatTopology(cur)
      lastKnownVersionRef.current = saved.version ?? null
      dirtyRef.current = false
      setDirty(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '拓扑保存失败')
    }
  }, [])

  const persistLayoutSnapshot = useCallback((snapshot: LayoutSnapshot) => {
    setLayoutSnapshot(snapshot)
    void dashboardApi.saveLayout(snapshot)
      .then(({ version }) => {
        lastKnownLayoutVersionRef.current = version
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : '布局保存失败')
      })
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

  // Poll the backend topology version every 5s. If another tab saved, the
  // backend version diverges from the version we loaded/saved last — surface a
  // refresh prompt. Polling never overwrites the local topology.
  useEffect(() => {
    const check = async () => {
      const cur = tpRef.current
      if (!cur) return
      try {
        const flat = await dashboardApi.getFlatTopology()
        const known = lastKnownVersionRef.current
        if (known === null || flat.version === undefined) return
        if (flat.version === known) return
        toast.error('拓扑已在其他页面被修改，请刷新以加载最新数据')
        lastKnownVersionRef.current = flat.version
      } catch {
        // transient network error — the next tick retries silently
      }
    }
    const timer = window.setInterval(() => {
      void check()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  // Poll the backend layout version every 5s. If another tab saved a layout,
  // the backend version diverges from the version we loaded/saved last —
  // surface a refresh prompt. Polling never overwrites the local layout.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const known = lastKnownLayoutVersionRef.current
      if (known === null) return
      try {
        const { version } = await dashboardApi.getLayout()
        if (version > known) {
          toast.error('布局已在其他页面被修改，请刷新以加载最新布局')
          lastKnownLayoutVersionRef.current = version
        }
      } catch {
        // transient error, next tick retries
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  // One-shot retry after 5s if the initial layout GET failed — give the
  // backend one more chance before settling on default positions. If it still
  // fails, toast once and leave the ref null; the poll above then skips.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (lastKnownLayoutVersionRef.current !== null) return
      try {
        const { layout, version } = await dashboardApi.getLayout()
        setLayoutSnapshot(layout)
        lastKnownLayoutVersionRef.current = version
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '布局加载失败，使用默认位置')
      }
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [])

  const handlePaneClick = useCallback(() => {
  }, [])

  const handlePaneContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.react-flow__node')) return
    setMenuState({ x: event.clientX, y: event.clientY, open: true, mode: 'cursor' })
  }, [])

  const handleNodeClick = useCallback((_event: ReactMouseEvent) => {
  }, [])

  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, _node: Node) => {
    event.preventDefault()
  }, [])

  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection
      if (!source || !target) return
      const wiring = canvasWiresFromEdges(edgesRef.current)
      const reason = invalidConnectionReason(tpRef.current?.nodes ?? [], wiring, source, target)
      if (reason) {
        toast.error(reason)
        return
      }
      const newEdge: Edge = {
        id: wiringEdgeId(source, target),
        source,
        target,
        type: 'flowLight',
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
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
      const reason = invalidConnectionReason(tpRef.current?.nodes ?? [], canvasWiresFromEdges(rest), source, target)
      if (reason) {
        toast.error(reason)
        return
      }
      const reconnected: Edge = {
        ...oldEdge,
        id: wiringEdgeId(source, target),
        source,
        target,
        type: 'flowLight',
        sourceHandle: newConnection.sourceHandle,
        targetHandle: newConnection.targetHandle,
      }
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
      const collapsed = canvasFromFlat(cur.nodes, cur.wires)
      const removedIds = [nodeId]
      for (const p of collapsed.providers) {
        if (collapsed.providerSlotOf.get(p.id) === nodeId) removedIds.push(p.id)
      }
      const removed = new Set(removedIds)
      const nodes = cur.nodes.filter((n) => !removed.has(n.id))
      const nextEdges = edgesRef.current.filter((e) => !removed.has(e.source) && !removed.has(e.target))
      const wires = rerouteWiresAroundRemoved(cur.wires, removedIds)
      commitHistory(cur)
      setTopology({ nodes, wires })
      setEdges(nextEdges)
      markDirty()
    },
    [setTopology, setEdges, markDirty, commitHistory],
  )

  const handleDeleteNodes = useCallback(
    (nodeIds: readonly string[]) => {
      const cur = tpRef.current
      if (!cur) return
      const collapsed = canvasFromFlat(cur.nodes, cur.wires)
      const idSet = new Set(nodeIds)
      const removedIds = [...nodeIds]
      for (const p of collapsed.providers) {
        const parent = collapsed.providerSlotOf.get(p.id)
        if (parent && idSet.has(parent)) removedIds.push(p.id)
      }
      const removed = new Set(removedIds)
      const nodes = cur.nodes.filter((n) => !removed.has(n.id))
      const nextEdges = edgesRef.current.filter((e) => !removed.has(e.source) && !removed.has(e.target))
      const wires = rerouteWiresAroundRemoved(cur.wires, removedIds)
      commitHistory(cur)
      setTopology({ nodes, wires })
      setEdges(nextEdges)
      markDirty()
    },
    [setTopology, setEdges, markDirty, commitHistory],
  )

  const [confirmDelete, setConfirmDelete] = useState<{ nodeCount: number; edgeCount: number } | null>(null)

  const executeDeleteSelected = useCallback(() => {
    const topLevelIds = selectionRef.current.nodes
      .filter((n) => n.type === 'requestEntry' || n.type === 'slot')
      .map((n) => n.id)
    if (topLevelIds.length > 0) {
      handleDeleteNodes(topLevelIds)
    } else if (selectionRef.current.edges.some((e) => !e.source.startsWith('model-'))) {
      handleDeleteSelectedEdges()
    }
  }, [handleDeleteNodes, handleDeleteSelectedEdges])

  const requestDeleteSelected = useCallback(() => {
    const topLevelIds = selectionRef.current.nodes.filter(
      (n) => n.type === 'requestEntry' || n.type === 'slot',
    )
    const edgeCount = selectionRef.current.edges.filter((e) => !e.source.startsWith('model-')).length
    if (topLevelIds.length === 0 && edgeCount === 0) return
    setConfirmDelete({ nodeCount: topLevelIds.length, edgeCount })
  }, [])

  const handleUndo = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const before = historyRef.current.pop()
    if (!before) return
    redoRef.current.push(cur)
    setTopology(before)
    syncHistory()
  }, [setTopology, syncHistory])

  const handleRedo = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const next = redoRef.current.pop()
    if (!next) return
    historyRef.current.push(cur)
    setTopology(next)
    syncHistory()
  }, [setTopology, syncHistory])

  const handleCopy = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const selectedIds = new Set(selectionRef.current.nodes.map((n) => n.id))
    const snapshot = buildCopySnapshot(cur.nodes, cur.wires, selectedIds)
    if (!snapshot) {
      toast.info('没有可复制的选中节点')
      return
    }
    clipboardRef.current = snapshot
  }, [])

  const handlePaste = useCallback(() => {
    const snapshot = clipboardRef.current
    const cur = tpRef.current
    if (!snapshot || !cur) return
    const result = pasteTopologySnapshot(snapshot, new Set(cur.nodes.map((n) => n.id)))
    if (!result) return
    commitHistory(cur)
    const layout = { ...layoutSnapshotRef.current }
    const fallbackPos = { x: topologyConfig.initialPositions.slot.x, y: topologyConfig.initialPositions.slot.y }
    for (const original of snapshot.nodes) {
      const fresh = result.idMap.get(original.id)
      if (!fresh) continue
      const pos = layout[original.id] ?? fallbackPos
      layout[fresh] = { x: pos.x + 40, y: pos.y + 40 }
    }
    persistLayoutSnapshot(layout)
    setTopology({ nodes: [...cur.nodes, ...result.nodes], wires: [...cur.wires, ...result.wires] })
    markDirty()
  }, [commitHistory, setTopology, persistLayoutSnapshot, markDirty])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null
      const inEditable = !!el && !!el.closest('input, textarea, select, [contenteditable="true"]')
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (mod && key === 'z') {
        if (inEditable) return
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (mod && key === 'y') {
        if (inEditable) return
        event.preventDefault()
        handleRedo()
        return
      }
      if (mod && key === 'c') {
        if (inEditable) return
        event.preventDefault()
        handleCopy()
        return
      }
      if (mod && key === 'v') {
        if (inEditable) return
        event.preventDefault()
        handlePaste()
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (inEditable) return
      const topLevelIds = selectionRef.current.nodes.filter(
        (n) => n.type === 'requestEntry' || n.type === 'slot',
      )
      const hasEdges = selectionRef.current.edges.some((e) => !e.source.startsWith('model-'))
      if (topLevelIds.length === 0 && !hasEdges) return
      event.preventDefault()
      requestDeleteSelected()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [requestDeleteSelected, handleUndo, handleRedo, handleCopy, handlePaste])

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes)
      let snapshot: LayoutSnapshot | null = null
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          if (snapshot === null) snapshot = { ...layoutSnapshotRef.current }
          snapshot[change.id] = change.position
        }
      }
      if (snapshot !== null) persistLayoutSnapshot(snapshot)
    },
    [onNodesChange, persistLayoutSnapshot],
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
      freeSlotRowWidthFactor: ALL_SLOT_TYPES.length + 2,
      slotBaseWidth: topologyConfig.render.slot.shellMinWidth,
    }, sizesRef.current)
    const next: LayoutSnapshot = {}
    for (const [id, pos] of Object.entries(positions)) {
      const node = baseNodes.find((n) => n.id === id)
      if (node) next[id] = pos
    }
    persistLayoutSnapshot(next)
    setNodes(baseNodes.map((n) => (next[n.id] ? { ...n, position: next[n.id] } : n)))
  }, [canvas, sizesRef, baseNodes, setNodes, persistLayoutSnapshot])

  // New nodes have no layout-snapshot record, so without an explicit position
  // they all fall back to the same hardcoded default and stack on top of each
  // other. Place each fresh node in a new row below every existing node,
  // left-aligned to the workflow area, so the addition is immediately visible.
  const placeNewNodes = useCallback(
    (placements: ReadonlyArray<{ id: string; width: number }>) => {
      const layout = layoutSnapshotRef.current
      let maxBottom = 0
      let hasLayout = false
      for (const pos of Object.values(layout)) {
        hasLayout = true
        const bottom = pos.y + topologyConfig.fallbackNodeSize.height
        if (bottom > maxBottom) maxBottom = bottom
      }
      const baseY = hasLayout ? maxBottom + topologyConfig.layout.rowGap : topologyConfig.initialPositions.slot.y

      let startX = topologyConfig.initialPositions.provider.x
      for (const [id, pos] of Object.entries(layout)) {
        if (!id.startsWith('model-') && pos.x < startX) startX = pos.x
      }

      const next = { ...layout }
      let cursorX = startX
      for (const p of placements) {
        if (next[p.id]) continue
        next[p.id] = { x: cursorX, y: baseY }
        cursorX += p.width + topologyConfig.layout.nodeGap
      }
      persistLayoutSnapshot(next)
    },
    [persistLayoutSnapshot],
  )

  const handleAddEntry = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const id = `entry-${crypto.randomUUID().slice(0, 8)}`
    const node: FlatNode = { id, kind: 'requestEntry', name: '请求入口', enabled: true, weight: 1 }
    const next: FlatTopology = { nodes: [...cur.nodes, node], wires: cur.wires }
    if (sameFlatTopology(cur, next)) return
    commitHistory(cur)
    setTopology(next)
    markDirty()
    placeNewNodes([{ id, width: topologyConfig.fallbackNodeSize.width }])
  }, [setTopology, markDirty, commitHistory, placeNewNodes])

  const handleAddProviderSlot = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const id = `pslot-${crypto.randomUUID().slice(0, 8)}`
    const node: FlatNode = { id, kind: 'slot', slotType: PROVIDER_SLOT_TYPE, enabled: true }
    updateTopologyNodes(() => [...cur.nodes, node])
    placeNewNodes([{ id, width: topologyConfig.render.slot.shellMinWidth }])
  }, [updateTopologyNodes, placeNewNodes])

  const handleAddSlot = useCallback(
    (slotType: RewriteSlotType) => {
      const cur = tpRef.current
      if (!cur) return
      const id = `${slotType}-${crypto.randomUUID().slice(0, 8)}`
      const node: FlatNode = {
        id,
        kind: 'slot',
        slotType,
        enabled: slotType !== 'logOutput',
      }
      updateTopologyNodes(() => [...cur.nodes, node])
      placeNewNodes([{ id, width: topologyConfig.render.slot.shellMinWidth }])
    },
    [updateTopologyNodes, placeNewNodes],
  )

  const handleAddProvider = useCallback(
    (slotId: string) => {
      const cur = tpRef.current
      if (!cur) return
      const id = `prov-${crypto.randomUUID().slice(0, 8)}`
      // 添加一个"空" provider 卡片，name 留空；由用户在下拉框中自行选择具体供应商。
      const providerNode: FlatNode = { id, kind: 'provider', name: undefined, enabled: true }
      const slotIndex = cur.nodes.findIndex((n) => n.id === slotId)
      if (slotIndex < 0) {
        updateTopologyNodes(() => [...cur.nodes, providerNode])
        return
      }
      // 找到该 slot 的最后一个 provider 子节点，插入其后
      let insertAt = slotIndex + 1
      while (insertAt < cur.nodes.length && cur.nodes[insertAt].kind === 'provider') insertAt++
      const nextNodes = [...cur.nodes.slice(0, insertAt), providerNode, ...cur.nodes.slice(insertAt)]
      updateTopologyNodes(() => nextNodes)
    },
    [updateTopologyNodes],
  )

  const handleSelectProvider = useCallback(
    (providerId: string, name: string) => {
      const cur = tpRef.current
      if (!cur) return
      const collapsed = canvasFromFlat(cur.nodes, cur.wires)
      const slotId = collapsed.providerSlotOf.get(providerId)
      let defaultEnabled = true
      if (slotId) {
        const slotInEnabledEntry = cur.nodes.some(
          (n) => n.kind === 'requestEntry' && n.enabled && reaches(cur.wires, n.id, slotId),
        )
        const alreadyActive = findDuplicateActivations(cur.nodes, cur.wires).includes(name)
        defaultEnabled = !(slotInEnabledEntry && alreadyActive)
        if (!defaultEnabled) {
          toast.error(`同一个 Provider（${name}）不能在多个激活工作流中被启用`)
        }
      }
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === providerId ? { ...n, name, enabled: n.enabled && defaultEnabled } : n)),
      )
    },
    [updateTopologyNodes],
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
      ...slotIds.map((st) => ({
        id: nodeIds.get(st)!,
        kind: 'slot' as const,
        slotType: st,
        enabled: st !== 'logOutput',
      })),
    ]
    const chain: FlatWire[] = [
      { source: entryId, target: pslotId },
      { source: pslotId, target: nodeIds.get('requestModify')! },
    ]
    for (let i = 0; i < slotIds.length - 1; i++) {
      chain.push({ source: nodeIds.get(slotIds[i])!, target: nodeIds.get(slotIds[i + 1])! })
    }
    commitHistory(cur)
    setTopology({ nodes: newNodes, wires: [...cur.wires, ...chain] })
    markDirty()
    placeNewNodes([
      { id: entryId, width: topologyConfig.fallbackNodeSize.width },
      { id: pslotId, width: topologyConfig.render.slot.shellMinWidth },
      ...slotIds.map((st) => ({ id: nodeIds.get(st)!, width: topologyConfig.render.slot.shellMinWidth })),
    ])
  }, [setTopology, markDirty, commitHistory, placeNewNodes])

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
  const canUndo = historyState.undo > 0
  const canRedo = historyState.redo > 0

  if (loading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" description="可视化编辑请求转发的拓扑结构" />
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
        <PageHeader title="转发拓扑" description="可视化编辑请求转发的拓扑结构" />
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
        description="可视化编辑请求转发的拓扑结构"
        status={`请求入口：${activeEntries}/${totalEntries} · ${nodes.filter((n) => n.type !== 'modelHub').length} 节点`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
            <AppIcon name="history" data-icon="inline-start" />
            历史版本
          </Button>
        }
      />
      <div
        ref={setContainerEl}
        className="relative flex-1 overflow-hidden"
        onContextMenu={(e) => {
          if ('ontouchstart' in window) e.preventDefault()
        }}
      >
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
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesConnectable
          edgesReconnectable
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView
          zoomOnDoubleClick={false}
          panOnDrag={true}
          selectionOnDrag={false}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Background color={topologyConfig.grid.color} gap={topologyConfig.grid.gap} size={topologyConfig.grid.size} />
          <Panel className="topology-actions-left" position="bottom-left">
            <Button
              variant="outline"
              size="icon"
              onClick={requestDeleteSelected}
              title="删除选中节点 (Delete)"
              aria-label="删除选中节点"
            >
              <AppIcon name="delete" />
            </Button>
          </Panel>
          <Panel className="topology-actions" position="bottom-right">
            <Button
              variant={selMode ? 'default' : 'outline'}
              size="icon"
              onClick={() => setSelMode((v) => !v)}
              title={selMode ? '框选模式已开启，点击拖拽框选节点' : '框选模式'}
              aria-label="框选模式"
            >
              <AppIcon name="rect_select" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤销 (Ctrl/Cmd+Z)"
              aria-label="撤销"
            >
              <AppIcon name="undo" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRedo}
              disabled={!canRedo}
              title="重做 (Ctrl/Cmd+Shift+Z)"
              aria-label="重做"
            >
              <AppIcon name="redo" />
            </Button>
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
            <FlowColorsPanel colors={flowColors} onChange={handleFlowColorsChange} />
          </Panel>
        </ReactFlow>
        {selMode && (
          <div
            className="absolute inset-0 z-20"
            style={{ background: 'transparent', pointerEvents: 'auto', touchAction: 'none' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              selPointerDown(e)
            }}
            onPointerMove={(e) => {
              e.stopPropagation()
              selPointerMove(e)
            }}
            onPointerUp={(e) => {
              e.stopPropagation()
              selPointerUp()
            }}
          />
        )}
        {selBox && (
          <div
            className="pointer-events-none fixed z-50 rounded-sm border-2 border-primary/60 bg-primary/10"
            style={{
              left: Math.min(selBox.startX, selBox.currentX),
              top: Math.min(selBox.startY, selBox.currentY),
              width: Math.abs(selBox.currentX - selBox.startX),
              height: Math.abs(selBox.currentY - selBox.startY),
            }}
          />
        )}
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
        <TopologyVersionsModal
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          providers={providers ?? []}
          currentTopology={tp}
          onBeforeRestore={async () => {
            const cur = tpRef.current
            if (cur) await dashboardApi.saveFlatTopology(cur)
          }}
          onRestored={() => {
            setVersionsOpen(false)
            void loadData()
          }}
        />
        <Dialog
          open={confirmDelete !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null)
          }}
        >
          <DialogContent width="sm">
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
              <DialogDescription>
                {confirmDelete?.nodeCount && confirmDelete.nodeCount > 0
                  ? `将删除 ${confirmDelete.nodeCount} 个节点${confirmDelete.edgeCount > 0 ? `和 ${confirmDelete.edgeCount} 条连线` : ''},删除后可通过撤销恢复。`
                  : `将删除 ${confirmDelete?.edgeCount ?? 0} 条连线,删除后可通过撤销恢复。`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  executeDeleteSelected()
                  setConfirmDelete(null)
                }}
              >
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
