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
  type ReactFlowInstance,
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
import { NodeModel } from '@/components/node/model'
import { NodeSlot } from '@/components/node/slot'
import { NodeExecutor } from '@/components/node/executor'
import { FlatCanvasMenu } from '@/components/topology/FlatCanvasMenu'
import { FlowColorsPanel } from '@/components/topology/FlowColorsPanel'
import { TopologyVersionsModal } from '@/components/TopologyVersionsModal'
import { ExecutorDebug } from '@/components/node/executor-debug'
import { dashboardApi, type ActiveRequest, type FlatNode, type FlatTopology, type FlatWire, type LayoutSnapshot, type Provider, type ProviderStrategy } from '@/lib/dashboard-api'
import { FlowLightEdge } from '@/edges/FlowLightEdge'
import { getFlowHub, buildFlowSteps, type FlowHub, type FlowLayerOverlay, type FlowStep } from '@/modules/flow-hub'
import { requestStartedAfterBoundary } from '@/modules/flow-animation-isolation'
// import { flowDebug } from '@/modules/flow-debug' // FLOW-DEBUG: disabled — re-enable by uncommenting this import and the flowDebug.* call sites below
import { topologyConfig } from '@/config/topology-config'
import { useReactFlowNodeSizes } from '@/lib/use-reactflow-node-sizes'
import { layoutFlatCanvas } from '@/lib/topology-auto-layout'
import { SLOT_LABELS, type SlotEntry, type SlotType } from '@/components/node/slot/items'
import { useSlotRules } from '@/components/node/executor/use-slot-rules'
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
  modelHub: NodeModel,
  slot: NodeSlot,
  requestEntry: NodeExecutor,
}

const edgeTypes = {
  flowLight: FlowLightEdge,
}

// Flow-light animation timing (ms). Each run advances one step per
// FLOW_STEP_MS; a fresh run starts per poll for every active request and runs
// independently until its final step. FLOW_SYNC_INTERVAL_MS mirrors the
// activity page poll.
const FLOW_SYNC_INTERVAL_MS = 2000
const FLOW_COLORS_SETTING_KEY = 'flow_light_colors'
// Unified wire opacity: active wires render at 0.6, disabled wires at 0.2,
// regardless of wire kind (model→entry or entry/slot↔slot).
const WIRE_OPACITY_ACTIVE = 0.6
const WIRE_OPACITY_INACTIVE = 0.2

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
 * entries; other nodes have at most one outgoing edge). When `providerId` is
 * given, prefer the chain whose provider slot hosts that provider, matched by
 * the stable provider record ID only — never by name (names are mutable and
 * can repeat). Returns null when the model node is not wired into the current
 * canvas.
 */
function computeLightChain(
  model: string,
  providerId: string | null,
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

  if (providerId && canvas) {
    const provider = canvas.providers.find((p) => p.providerId === providerId)
    if (provider) {
      const slotId = canvas.providerSlotOf.get(provider.id)
      if (slotId) {
        const matched = chains.find((chain) => chain.includes(provider.id)) ?? chains.find((chain) => chain.includes(slotId))
        if (matched) return matched
      }
    }
  }
  return chains[0] ?? null
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
  const beginFlowIsolationRef = useRef<() => void>(() => {})
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
  const persistRetryRef = useRef<number | null>(null)
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
  selModeRef.current = selMode

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

  const providerById = useMemo(() => {
    const map = new Map<string, Provider>()
    for (const p of providers ?? []) map.set(p.id, p)
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
      beginFlowIsolationRef.current()
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
      beginFlowIsolationRef.current()
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

  const handleToggleSlotEnabled = useCallback(
    (slotId: string, enabled: boolean) => {
      updateTopologyNodes((list) =>
        list.map((n) =>
          n.id === slotId && n.kind === 'slot'
            ? { ...n, enabled, ...(enabled ? {} : { deadlineAt: null }) }
            : n,
        ),
      )
    },
    [updateTopologyNodes],
  )

  const handleStartSlotCapture = useCallback(
    (slotId: string, deadlineAt: number) => {
      updateTopologyNodes((list) =>
        list.map((n) =>
          n.id === slotId && n.kind === 'slot'
            ? { ...n, enabled: true, deadlineAt: deadlineAt }
            : n,
        ),
      )
    },
    [updateTopologyNodes],
  )

  const handleSetSlotDeadline = useCallback(
    (slotId: string, deadlineAt: number | null) => {
      updateTopologyNodes((list) =>
        list.map((n) => (n.id === slotId && n.kind === 'slot' ? { ...n, deadlineAt: deadlineAt } : n)),
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

  // Per-run overlay layers: nodeId -> stacked layers, edgeId -> stacked layers.
  // The FlowHub fires onStep per run; the page records each run's current
  // overlay and rebuilds these maps, so overlapping runs stack naturally
  // instead of restarting keyframe animations. Declared before topLevelNodes
  // because it feeds node data.
  const [selectedDebugIds, setSelectedDebugIds] = useState<string[]>([])
  const [selectedExecutor, setSelectedExecutor] = useState<{ slotId: string; token: string } | null>(null)
  const [litNodeLayers, setLitNodeLayers] = useState<ReadonlyMap<string, readonly FlowLayerOverlay[]>>(new Map())
  const [litEdgeLayers, setLitEdgeLayers] = useState<ReadonlyMap<string, readonly FlowLayerOverlay[]>>(new Map())
  const litNodeRef = useRef(new Map<string, FlowLayerOverlay[]>())
  const litEdgeRef = useRef(new Map<string, FlowLayerOverlay[]>())
  const runStepsRef = useRef(
    new Map<number, { color: string; step: FlowStep; requestId: string; loop: number; stepIndex: number; stepTotal: number }>(),
  )

  const rebuildLayers = useCallback(() => {
    setLitNodeLayers(new Map(litNodeRef.current))
    setLitEdgeLayers(new Map(litEdgeRef.current))
  }, [])

  const applyStepToLayers = useCallback(
    (runId: number, step: FlowStep, color: string, meta: { requestId: string; loop: number; stepIndex: number; stepTotal: number }) => {
      runStepsRef.current.set(runId, { color, step, requestId: meta.requestId, loop: meta.loop, stepIndex: meta.stepIndex, stepTotal: meta.stepTotal })
      // Clear this run's layers from every previously lit element so the run
      // lights exactly one element at a time — the chain relays step by step
      // instead of accumulating lit nodes/edges behind it.
      for (const [nodeId, layers] of [...litNodeRef.current]) {
        const kept = layers.filter((layer) => layer.runId !== runId)
        if (kept.length === 0) litNodeRef.current.delete(nodeId)
        else litNodeRef.current.set(nodeId, kept)
      }
      for (const [edgeId, layers] of [...litEdgeRef.current]) {
        const kept = layers.filter((layer) => layer.runId !== runId)
        if (kept.length === 0) litEdgeRef.current.delete(edgeId)
        else litEdgeRef.current.set(edgeId, kept)
      }
      if (step.kind === 'node') {
        const existing = litNodeRef.current.get(step.nodeId) ?? []
        existing.push({ runId, color, loop: meta.loop })
        litNodeRef.current.set(step.nodeId, existing)
      } else {
        const existing = litEdgeRef.current.get(step.edgeId) ?? []
        existing.push({ runId, color, loop: meta.loop })
        litEdgeRef.current.set(step.edgeId, existing)
      }
      rebuildLayers()
    },
    [rebuildLayers],
  )

  const removeRunLayers = useCallback((runId: number) => {
    const meta = runStepsRef.current.get(runId)
    if (meta && meta.requestId) {
      // FLOW-DEBUG: disabled
      // const rm = requestMetaRef.current.get(meta.requestId)
      // flowDebug.emit({
      //   requestId: meta.requestId,
      //   model: rm?.model ?? meta.requestId,
      //   provider: rm?.provider ?? null,
      //   runId,
      //   loop: meta.loop,
      //   stepIndex: meta.stepIndex,
      //   stepTotal: meta.stepTotal,
      //   action: 'end',
      // })
    }
    runStepsRef.current.delete(runId)
    for (const [nodeId, layers] of [...litNodeRef.current]) {
      const kept = layers.filter((layer) => layer.runId !== runId)
      if (kept.length === 0) litNodeRef.current.delete(nodeId)
      else litNodeRef.current.set(nodeId, kept)
    }
    for (const [edgeId, layers] of [...litEdgeRef.current]) {
      const kept = layers.filter((layer) => layer.runId !== runId)
      if (kept.length === 0) litEdgeRef.current.delete(edgeId)
      else litEdgeRef.current.set(edgeId, kept)
    }
    rebuildLayers()
  }, [rebuildLayers])

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
            const provider = p.providerId ? providerById.get(p.providerId) : p.name ? providerByName.get(p.name) : undefined
            return {
              id: p.id,
              label: provider?.name ?? p.name ?? '',
              baseURLCount: provider?.baseUrls.length ?? 0,
              keyCount: provider?.keys.length ?? 0,
              modelCount: provider?.models.length ?? 0,
              enabled: p.enabled,
              providerStatus: provider?.status ?? false,
              autoDisabled: provider?.autoDisabled ?? false,
            }
          })
        nodes.push({
          id: node.id,
          type: 'slot',
          position: layoutSnapshot[node.id] ?? { x: 560, y: 20 },
          data: {
            title: '供应商',
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
            strategy: node.strategy ?? 'sequential',
            onCycleStrategy: () => handleCycleProviderStrategy(node.id, node.strategy ?? 'sequential'),
            enabled: node.enabled,
            onToggleEnabled: (nextEnabled: boolean) => handleToggleSlotEnabled(node.id, nextEnabled),
            onSelectExecutor: (token: string | null) => setSelectedExecutor(token ? { slotId: node.id, token } : null),
            selectedExecutorToken: selectedExecutor?.slotId === node.id ? selectedExecutor.token : null,
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
            deadlineAt: node.deadlineAt ?? null,
            onToggleEnabled: (nextEnabled: boolean) => handleToggleSlotEnabled(node.id, nextEnabled),
            onSetDeadline: (deadlineAt: number | null) => handleSetSlotDeadline(node.id, deadlineAt),
            onStartCapture: (deadlineAt: number) => handleStartSlotCapture(node.id, deadlineAt),
            onSelectExecutor: (token: string | null) => setSelectedExecutor(token ? { slotId: node.id, token } : null),
            selectedExecutorToken: selectedExecutor?.slotId === node.id ? selectedExecutor.token : null,
            onAutoCloseEntry: () => {
              void persistTopology()
            },
          },
        })
      }
    }
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, layoutSnapshot, providerByName, slotRules, modelNodes, externallyDisabledSet, selectedExecutor])

  const baseNodes = useMemo(() => [...modelNodes.nodes, ...topLevelNodes], [modelNodes, topLevelNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)
  const setNodesRef = useRef(setNodes)
  setNodesRef.current = setNodes

  useEffect(() => {
    setNodes(baseNodes)
  }, [baseNodes, setNodes])

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        if (node.type === 'modelHub' || node.type === 'requestEntry' || node.type === 'slot') {
          const data = node.data as Record<string, unknown>
          const nextData = node.type === 'slot' && data.isProviderSlot
            ? { ...data, providerFlashLayers: litNodeLayers }
            : { ...data, flashLayers: litNodeLayers.get(node.id) }
          return { ...node, data: nextData }
        }
        return node
      }),
    )
  }, [litNodeLayers, setNodes])

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
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: WIRE_OPACITY_ACTIVE },
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
        style: {
          strokeWidth: topologyConfig.edge.strokeWidth,
          opacity: link.active ? WIRE_OPACITY_ACTIVE : WIRE_OPACITY_INACTIVE,
        },
      })
    }
    return edges
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, modelNodes])

  // Merge live edge layers into the base edges so FlowLightEdge can render the
  // stacked flow dots without touching the persisted edge document.
  const displayEdges = useMemo<Edge[]>(
    () =>
      baseEdges.map((edge) => {
        const layers = litEdgeLayers.get(edge.id)
        if (!layers || layers.length === 0) return edge
        return { ...edge, data: { ...edge.data, layers } }
      }),
    [baseEdges, litEdgeLayers],
  )

  const [edges, setEdges, onEdgesChange] = useEdgesState(displayEdges)
  const edgesRef = useRef(edges)
  edgesRef.current = edges

  useEffect(() => {
    setEdges(displayEdges)
  }, [displayEdges, setEdges])

  // ── Flow light (request_started SSE) ──
  // The backend emits `request_started` when a queued request begins executing
  // and `request_finished` when it ends. While at least one request for a model
  // is active, the primary-color beam loops down its workflow chain; when the
  // last request finishes the beam is removed.
  const canvasRef = useRef<FlatCanvas | null>(null)
  canvasRef.current = canvas
  const flowHubRef = useRef<FlowHub | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const requestMetaRef = useRef(new Map<string, { model: string; provider: string | null }>())
  const runInfoRef = useRef(new Map<number, { requestId: string; loop: number }>())
  const flowPollingPausedRef = useRef(false)
  const flowEditBoundaryMsRef = useRef<number | null>(null)
  const flowIsolationTimerRef = useRef<number | null>(null)
  const flowSyncGenerationRef = useRef(0)
  // FLOW-DEBUG: mount/unmount the animation tracer. Disabled — re-enable by
  // uncommenting this block and the flowDebug import + call sites.
  // useEffect(() => {
  //   flowDebug.mount()
  //   return () => flowDebug.unmount()
  // }, [])
  useEffect(() => {
    // Use the shared FlowHub singleton so StrictMode double-mounts / route
    // re-entries reuse one run pool and runId counter instead of scheduling
    // duplicate runs for the same active request.
    const hub = getFlowHub()
    flowHubRef.current = hub
    hub.setHandlers({
      onStep: (runId, step, color, meta) => {
        applyStepToLayers(runId, step, color, meta)
        runInfoRef.current.set(runId, { requestId: meta.requestId, loop: meta.loop })
        // FLOW-DEBUG: disabled
        // const rm = requestMetaRef.current.get(meta.requestId)
        // flowDebug.emit({
        //   requestId: meta.requestId,
        //   model: rm?.model ?? meta.requestId,
        //   provider: rm?.provider ?? null,
        //   runId,
        //   loop: meta.loop,
        //   stepIndex: meta.stepIndex,
        //   stepTotal: meta.stepTotal,
        //   step: step.kind === 'node' ? { kind: 'node', id: step.nodeId } : { kind: 'edge', id: step.edgeId },
        //   action: 'step',
        // })
      },
      onRunEnd: (runId) => removeRunLayers(runId),
    })
    return () => {
      hub.stopAll()
      hub.setHandlers({ onStep: () => {}, onRunEnd: () => {} })
      if (flowIsolationTimerRef.current !== null) window.clearTimeout(flowIsolationTimerRef.current)
      if (flowHubRef.current === hub) flowHubRef.current = null
    }
    // applyStepToLayers / removeRunLayers only capture stable setters and
    // state-update helpers, so binding them once on mount is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build the ordered node path a request traverses. Prefer the backend's
  // dispatch-time fact (request.pathNodeIds); fall back to the current
  // topology derivation when the fact is missing (affinity/standalone path).
  const resolveLayerPath = useCallback(
    (request: ActiveRequest): readonly string[] | null => {
      if (request.pathNodeIds.length > 0) {
        const modelId = `model-${request.model}`
        return [modelId, ...request.pathNodeIds]
      }
      const chain = computeLightChain(request.model, request.providerId || null, edgesRef.current, canvasRef.current)
      if (!chain || chain.length < 2) return null
      return chain
    },
    [],
  )

  // Poll the active-requests API and spawn one serial run per active request.
  // Each run starts at the model node and plays its steps in order; a fresh
  // run is started every poll cycle, so a request that stays active overlaps
  // its own runs naturally instead of waiting for the previous one to finish.
  const syncFlowLights = useCallback(async () => {
    if (flowPollingPausedRef.current) return
    const generation = flowSyncGenerationRef.current
    let requests: readonly ActiveRequest[]
    try {
      requests = await dashboardApi.getActiveRequests()
    } catch {
      return
    }
    if (flowPollingPausedRef.current || generation !== flowSyncGenerationRef.current) return
    const activeRequestIds = new Set<string>()
    for (const request of requests) {
      if (request.endTime !== null) continue
      if (!requestStartedAfterBoundary(request.startTime, flowEditBoundaryMsRef.current)) continue
      activeRequestIds.add(request.requestId)
      if ((flowHubRef.current?.activeRunCount(request.requestId) ?? 0) > 0) continue
      const path = resolveLayerPath(request)
      if (!path) continue
      const steps = buildFlowSteps(path, canvasRef.current, {
        providersById: providerById,
        providersByName: providerByName,
        externallyDisabledSlotIds: externallyDisabledSet,
      })
      if (steps.length === 0) continue
      const color = modelColorRef.current.get(request.model) ?? 'var(--primary)'
      requestMetaRef.current.set(request.requestId, { model: request.model, provider: request.provider ?? null })
      flowHubRef.current?.startRun({ requestId: request.requestId, color, steps })
      // FLOW-DEBUG: disabled
      // if (runId > 0) {
      //   flowDebug.emit({
      //     requestId: request.requestId,
      //     model: request.model,
      //     provider: request.provider ?? null,
      //     runId,
      //     loop: 0,
      //     stepIndex: 0,
      //     stepTotal: steps.length,
      //     action: 'start',
      //   })
      // }
    }
    // Requests that disappeared finish their current pass before being removed.
    const flagged = flowHubRef.current?.stopFinishedRequests(activeRequestIds) ?? []
    for (const runId of flagged) {
      const meta = runStepsRef.current.get(runId)
      if (!meta) continue
      // FLOW-DEBUG: disabled
      // const rm = requestMetaRef.current.get(meta.requestId)
      // flowDebug.emit({
      //   requestId: meta.requestId,
      //   model: rm?.model ?? meta.requestId,
      //   provider: rm?.provider ?? null,
      //   runId,
      //   loop: meta.loop,
      //   stepIndex: meta.stepIndex,
      //   stepTotal: meta.stepTotal,
      //   action: 'graceful',
      // })
    }
  }, [resolveLayerPath, providerById, providerByName, externallyDisabledSet])

  const syncFlowLightsRef = useRef(syncFlowLights)
  useEffect(() => {
    syncFlowLightsRef.current = syncFlowLights
  }, [syncFlowLights])

  const beginFlowIsolation = useCallback(() => {
    flowSyncGenerationRef.current += 1
    flowEditBoundaryMsRef.current = Date.now()
    flowPollingPausedRef.current = true
    if (flowIsolationTimerRef.current !== null) window.clearTimeout(flowIsolationTimerRef.current)
    flowHubRef.current?.stopAll()
    runStepsRef.current.clear()
    runInfoRef.current.clear()
    requestMetaRef.current.clear()
    litNodeRef.current.clear()
    litEdgeRef.current.clear()
    rebuildLayers()
    flowIsolationTimerRef.current = window.setTimeout(() => {
      flowIsolationTimerRef.current = null
      flowPollingPausedRef.current = false
      void syncFlowLightsRef.current()
    }, 2000)
  }, [rebuildLayers])

  beginFlowIsolationRef.current = beginFlowIsolation

  // baseEdges 重建后重放：清空 overlay 层，立即为仍活跃的请求启动新 run，
  // 让拓扑变化后（如 logOutput 开关）生效节点立即亮起。
  useEffect(() => {
    setEdges(baseEdges)
  }, [baseEdges, setEdges])

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
      if (tpRef.current !== cur) {
        // 保存期间又有改动：保持 dirty 并立即再存一次最新拓扑，避免把
        // 新改动误清掉。
        void persistTopology()
        return
      }
      dirtyRef.current = false
      setDirty(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '拓扑保存失败，稍后自动重试')
      // 失败后 1 秒自动重试，直到成功，避免改动静默丢失。
      if (persistRetryRef.current !== null) window.clearTimeout(persistRetryRef.current)
      persistRetryRef.current = window.setTimeout(() => {
        persistRetryRef.current = null
        void persistTopology()
      }, 1000)
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
    }, 400)
    return () => clearTimeout(timer)
  }, [dirty, persistTopology])

  useEffect(() => {
    return () => {
      if (persistRetryRef.current !== null) window.clearTimeout(persistRetryRef.current)
    }
  }, [])

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
        style: { strokeWidth: topologyConfig.edge.strokeWidth, opacity: WIRE_OPACITY_ACTIVE },
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
    setSelectedDebugIds(params.nodes.map((n) => n.id))
    if (params.nodes.length > 0) setSelectedExecutor(null)
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
      beginFlowIsolation()
      setTopology({ nodes, wires })
      setEdges(nextEdges)
      markDirty()
    },
    [setTopology, setEdges, markDirty, commitHistory, beginFlowIsolation],
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
      beginFlowIsolation()
      setTopology({ nodes, wires })
      setEdges(nextEdges)
      markDirty()
    },
    [setTopology, setEdges, markDirty, commitHistory, beginFlowIsolation],
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
    beginFlowIsolation()
    setTopology(before)
    syncHistory()
  }, [setTopology, syncHistory, beginFlowIsolation])

  const handleRedo = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const next = redoRef.current.pop()
    if (!next) return
    historyRef.current.push(cur)
    beginFlowIsolation()
    setTopology(next)
    syncHistory()
  }, [setTopology, syncHistory, beginFlowIsolation])

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
    beginFlowIsolation()
    setTopology({ nodes: [...cur.nodes, ...result.nodes], wires: [...cur.wires, ...result.wires] })
    markDirty()
  }, [commitHistory, setTopology, persistLayoutSnapshot, markDirty, beginFlowIsolation])

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

  // Fit every node into the visible canvas as large as possible without
  // overflowing: fitView scales the node bounding box to the viewport, so
  // padding 0 + an effectively unbounded maxZoom yields the largest layout
  // that still fits entirely inside the page.
  const handleFitAll = useCallback(() => {
    rfInstanceRef.current?.fitView({ padding: 0.05, minZoom: 0.01, maxZoom: 64, duration: 300 })
  }, [])

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
    beginFlowIsolation()
    setTopology(next)
    markDirty()
    placeNewNodes([{ id, width: topologyConfig.fallbackNodeSize.width }])
  }, [setTopology, markDirty, commitHistory, placeNewNodes, beginFlowIsolation])

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
        list.map((n) =>
          n.id === providerId ? { ...n, name, providerId: providerByName.get(name)?.id ?? n.providerId, enabled: n.enabled && defaultEnabled } : n,
        ),
      )
    },
    [updateTopologyNodes, providerByName],
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

  const handleCycleProviderStrategy = useCallback(
    (slotId: string, current: ProviderStrategy) => {
      const next: ProviderStrategy = current === 'sequential' ? 'random' : current === 'random' ? 'roundRobin' : 'sequential'
      updateTopologyNodes((list) => list.map((n) => (n.id === slotId ? { ...n, strategy: next } : n)))
    },
    [updateTopologyNodes],
  )

  const handleAddFullWorkflow = useCallback(() => {
    const cur = tpRef.current
    if (!cur) return
    const suffix = crypto.randomUUID().slice(0, 8)
    const entryId = `entry-${suffix}`
    const pslotId = `pslot-${suffix}`
    const slotIds: RewriteSlotType[] = ['autoSwitch', 'requestModify', 'responseModify', 'autoReply', 'concurrency', 'logOutput']
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
      { source: pslotId, target: nodeIds.get(slotIds[0])! },
    ]
    for (let i = 0; i < slotIds.length - 1; i++) {
      chain.push({ source: nodeIds.get(slotIds[i])!, target: nodeIds.get(slotIds[i + 1])! })
    }
    commitHistory(cur)
    beginFlowIsolation()
    setTopology({ nodes: newNodes, wires: [...cur.wires, ...chain] })
    markDirty()
    placeNewNodes([
      { id: entryId, width: topologyConfig.fallbackNodeSize.width },
      { id: pslotId, width: topologyConfig.render.slot.shellMinWidth },
      ...slotIds.map((st) => ({ id: nodeIds.get(st)!, width: topologyConfig.render.slot.shellMinWidth })),
    ])
  }, [setTopology, markDirty, commitHistory, placeNewNodes, beginFlowIsolation])

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
        <div className="flex flex-1 items-center justify-center gap-3">
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
            <p className="max-w-md text-sm">{error}</p>
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤销 (Ctrl/Cmd+Z)"
              aria-label="撤销"
              className="disabled:opacity-60"
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
              className="disabled:opacity-60"
            >
              <AppIcon name="redo" />
            </Button>
            <Button variant="outline" size="default" onClick={() => setVersionsOpen(true)}>
              <AppIcon name="history" data-icon="inline-start" />
              历史版本
            </Button>
          </div>
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
          onInit={(instance) => {
            rfInstanceRef.current = instance
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          nodesConnectable
          edgesReconnectable
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={0.01}
          maxZoom={64}
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
            <Button variant="outline" size="icon" onClick={handleFitAll} title="最大化显示全部节点">
              <AppIcon name="fullscreen" />
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
        <ExecutorDebug
          topology={tp}
          providers={providers}
          canvas={canvas}
          externallyDisabledSlotIds={externallyDisabledSet}
          target={
            selectedExecutor
              ? { kind: 'executor', slotId: selectedExecutor.slotId, token: selectedExecutor.token }
              : selectedDebugIds[0]
                ? { kind: 'node', nodeId: selectedDebugIds[0] }
                : null
          }
        />
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
