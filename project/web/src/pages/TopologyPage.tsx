import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, Loader2, RefreshCw, Wand2, Plus, Code, History } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ProviderNode } from '@/nodes/ProviderNode'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { SlotNode } from '@/nodes/SlotNode'
import { NodeMenu } from '@/components/topology/NodeMenu'
import { ContextMenu } from '@/components/topology/ContextMenu'
import { dashboardApi } from '@/lib/dashboard-api'
import { DashboardApiError, type Provider } from '@/lib/dashboard-api'
import { topologyConfig, fallbackNodeSize } from '@/config/topology-config'
import { getLayoutedElements } from '@/lib/topology-auto-layout'
import { useReactFlowNodeSizes } from '@/lib/use-reactflow-node-sizes'
import { TopologyJsonEditModal } from '@/components/TopologyJsonEditModal'
import { TopologyVersionsModal } from '@/components/TopologyVersionsModal'
import { slotMapsFromWorkflows, workflowsFromSlotMaps, preserveNullRuleDrafts, providerIdFromKey, makeWorkflowKey, type Workflow, type WorkflowEntry } from '@/lib/topology-document'
import { TopologySaveQueue } from '@/lib/topology-save-queue'
import { buildModelNodes, buildProviderNode, buildSlotNodes, buildEdges, computeWorkflowPlacements, type LayoutSnapshot } from '@/lib/topology-builders'
import {
  emptySlotEntryMap,
  useSlotRules,
  type SlotEntry,
  type SlotEntryMap,
  type SlotRuleMap,
  type SlotType,
} from '@/components/topology/slot-items'

const nodeTypes = {
  modelHub: ModelHubNode,
  provider: ProviderNode,
  slot: SlotNode,
}

const defaultEdgeOptions = {
  animated: topologyConfig.edge.animated,
  style: { strokeWidth: topologyConfig.edge.strokeWidth },
}

const SLOT_BASE_OFFSET = topologyConfig.initialPositions.slot.x - topologyConfig.initialPositions.provider.x

function providerIdFromSlotId(slotId: string): string | null {
  if (!slotId.startsWith('slot-')) return null
  const rest = slotId.slice(5)
  const lastDash = rest.lastIndexOf('-')
  return lastDash >= 0 ? rest.slice(0, lastDash) : rest
}

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

export function TopologyPage() {
  const navigate = useNavigate()
  const [providers, setProviders] = useState<readonly Provider[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<{ x: number; y: number; open: boolean; mode: 'corner' | 'cursor' }>({ x: 0, y: 0, open: false, mode: 'cursor' })
  const { rules } = useSlotRules()

  const slotsStateRef = useRef<Map<string, WorkflowEntry>>(new Map())
  const workflowsRef = useRef<Workflow[] | null>(null)
  const saveQueueRef = useRef<TopologySaveQueue | null>(null)
  const [slotsVersion, setSlotsVersion] = useState(0)
  const slotsVersionRef = useRef(0)
  const bumpSlots = useCallback(() => {
    slotsVersionRef.current += 1
    setSlotsVersion((v) => v + 1)
  }, [])
  const nextWorkflowIdRef = useRef(0)
  const addProviderBtnRef = useRef<HTMLButtonElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [navGuardNext, setNavGuardNext] = useState<string | null>(null)

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setContextMenu(null)
  }, [])

  const handlePaneContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.react-flow__node')) return
    setSelectedNodeId(null)
    setContextMenu(null)
    setMenuState({ x: event.clientX, y: event.clientY, open: true, mode: 'cursor' })
  }, [])

  const handleNodeClick = useCallback((_event: ReactMouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
    setContextMenu(null)
  }, [])

  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node) => {
    event.preventDefault()
    if (!node.id.startsWith('pv-')) return
    setSelectedNodeId(node.id)
    setMenuState((s) => ({ ...s, open: false }))
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [providers, workflows] = await Promise.all([
        dashboardApi.listProviders(),
        dashboardApi.getTopology(),
      ])
      setProviders(providers)
      workflowsRef.current = workflows
      slotsStateRef.current = slotMapsFromWorkflows(workflows)
      saveQueueRef.current = new TopologySaveQueue(dashboardApi.saveTopology, (conflict) => {
        toast.add({ title: `拓扑版本冲突（当前版本 ${conflict.currentRevision ?? '未知'}），请刷新后重试`, type: 'error' })
      })
      bumpSlots()
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [bumpSlots])

  useEffect(() => {
    loadData()
  }, [loadData])

  const persistTopology = useCallback(async () => {
    const queue = saveQueueRef.current
    if (!providers || !queue) return
    const versionAtStart = slotsVersionRef.current
    const providerNames = new Map(providers.map((p) => [p.id, p.name]))
    const ruleNames = new Map<string, string>()
    for (const slotType of Object.keys(rules) as (keyof SlotRuleMap)[]) {
      for (const rule of rules[slotType]) {
        ruleNames.set(`${slotType}:${rule.id}`, rule.name)
      }
    }
    const workflows = workflowsFromSlotMaps(slotsStateRef.current, providerNames, ruleNames)
    try {
      const saved = await queue.enqueue(workflows)
      if (versionAtStart !== slotsVersionRef.current) {
        // A new edit landed while this save was in flight. Re-save with the
        // latest state instead of overwriting the newer edits with the older
        // snapshot that just returned.
        void persistTopology()
        return
      }
      workflowsRef.current = saved
      slotsStateRef.current = preserveNullRuleDrafts(
        slotMapsFromWorkflows(saved),
        slotsStateRef.current,
      )
      setDirty(false)
    } catch (err) {
      if (err instanceof DashboardApiError && err.status === 409) return
      toast.add({ title: err instanceof Error ? err.message : '拓扑节点保存失败', type: 'error' })
    }
  }, [providers, rules])

  // Auto-save: any content edit marks the topology dirty; after a quiet
  // 800ms window the latest state is persisted without a manual save button.
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

  // The nested <Routes> under <BrowserRouter> in App.tsx never provides a
  // DataRouterContext, so useBlocker would throw; we fall back to capturing
  // clicks on rendered <a> elements (which is what <Link> emits) at the
  // capture phase before React Router handles them. Browser back/forward is
  // intentionally not intercepted here.
  useEffect(() => {
    if (!dirty) return
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const start = event.target
      if (!(start instanceof Node)) return
      let node: Element | null = (start as Element)
      let anchor: HTMLAnchorElement | null = null
      while (node) {
        if (node instanceof HTMLAnchorElement) {
          anchor = node
          break
        }
        node = node.parentElement
      }
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      const current = window.location
      if (url.pathname === current.pathname && url.search === current.search && url.hash === current.hash) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setNavGuardNext(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [dirty])

  const handleChangeEntry = useCallback(
    (workflowKey: string, slotType: SlotType, next: SlotEntry) => {
      const entry = slotsStateRef.current.get(workflowKey)
      if (!entry) return
      const current = entry.slots
      const list = current[slotType] ?? []
      const idx = list.findIndex((e) => e.index === next.index)
      const nextList =
        idx >= 0
          ? list.map((e) => (e.index === next.index ? next : e))
          : [...list, next].map((e, i) => reindexSlotItem(e, i + 1, slotType))
      setSlotList(current, slotType, nextList as SlotEntryMap[typeof slotType])
      bumpSlots()
      setDirty(true)
    },
    [bumpSlots],
  )

  const handleDeleteEntry = useCallback(
    (workflowKey: string, slotType: SlotType, index: number) => {
      const entry = slotsStateRef.current.get(workflowKey)
      if (!entry) return
      const current = entry.slots
      const list = current[slotType] ?? []
      const nextList = list
        .filter((e) => e.index !== index)
        .map((e, i) => reindexSlotItem(e, i + 1, slotType))
      setSlotList(current, slotType, nextList as SlotEntryMap[typeof slotType])
      bumpSlots()
      setDirty(true)
    },
    [bumpSlots],
  )

  const handleReorderEntries = useCallback(
    (workflowKey: string, slotType: SlotType, fromIndex: number, toIndex: number) => {
      const entry = slotsStateRef.current.get(workflowKey)
      if (!entry) return
      const current = entry.slots
      const list = current[slotType] ?? []
      const sorted = [...list].sort((a, b) => a.index - b.index)
      const from = sorted.findIndex((e) => e.index === fromIndex)
      const to = sorted.findIndex((e) => e.index === toIndex)
      if (from < 0 || to < 0 || from === to) return
      const [moved] = sorted.splice(from, 1)
      sorted.splice(to, 0, moved)
      const nextList = sorted.map((e, i) => reindexSlotItem(e, i + 1, slotType))
      setSlotList(current, slotType, nextList as SlotEntryMap[typeof slotType])
      bumpSlots()
      setDirty(true)
    },
    [bumpSlots],
  )

  const [jsonWorkflows, setJsonWorkflows] = useState<Workflow[] | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const handleOpenJson = useCallback(() => {
    const queue = saveQueueRef.current
    if (!queue || !providers) return
    const providerNames = new Map(providers.map((p) => [p.id, p.name]))
    const ruleNames = new Map<string, string>()
    for (const slotType of Object.keys(rules) as (keyof SlotRuleMap)[]) {
      for (const rule of rules[slotType]) {
        ruleNames.set(`${slotType}:${rule.id}`, rule.name)
      }
    }
    setJsonWorkflows(workflowsFromSlotMaps(slotsStateRef.current, providerNames, ruleNames))
  }, [providers, rules])
  const handleJsonSave = useCallback(
    async (workflows: Workflow[]) => {
      const queue = saveQueueRef.current
      if (!queue) throw new Error('拓扑尚未加载完成')
      const saved = await queue.saveNow(workflows)
      workflowsRef.current = saved
      slotsStateRef.current = preserveNullRuleDrafts(
        slotMapsFromWorkflows(saved),
        slotsStateRef.current,
      )
      setDirty(false)
      bumpSlots()
    },
    [bumpSlots],
  )

  const [layoutSnapshot, setLayoutSnapshot] = useState<LayoutSnapshot>(() => loadLayoutFromStorage())
  const layoutSnapshotRef = useRef(layoutSnapshot)
  layoutSnapshotRef.current = layoutSnapshot
  const prevSlotSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map())
  const didInitialMeasure = useRef(false)
  const [setContainerEl, sizesRef] = useReactFlowNodeSizes()

  const topologyProviders = useMemo(() => {
    if (!providers) return [] as Provider[]
    const ids = new Set<string>()
    for (const entry of slotsStateRef.current.values()) ids.add(entry.providerId)
    return providers.filter((p) => ids.has(p.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, slotsVersion])

  const modelNodeIds = useMemo(() => {
    const ids: Record<string, string> = {}
    for (const provider of topologyProviders) for (const model of provider.models) {
      if (!(model.model in ids)) ids[model.model] = `model-${model.model}`
    }
    return ids
  }, [topologyProviders])

  const baseNodes = useMemo(() => {
    if (!providers) return []
    const modelNodes = buildModelNodes(topologyProviders, modelNodeIds, layoutSnapshot)
    const nodes: Node[] = [...modelNodes]

    let rowHeight = fallbackNodeSize.height
    for (const size of sizesRef.current.values()) {
      if (size.height > rowHeight) rowHeight = size.height
    }
    const placements = computeWorkflowPlacements([...slotsStateRef.current.keys()], layoutSnapshot, rowHeight)

    for (const [workflowKey, entry] of slotsStateRef.current) {
      const provider = providers.find((p) => p.id === entry.providerId)
      if (!provider) continue
      const placement = placements.get(workflowKey)
      if (!placement) continue
      nodes.push(buildProviderNode(workflowKey, entry, provider, layoutSnapshot, placement.baseX, placement.baseY, selectedNodeId, () => {
        handleToggleWorkflow(workflowKey)
      }))
      nodes.push(
        ...buildSlotNodes(
          workflowKey,
          entry.slots,
          rules,
          layoutSnapshot,
          placement.baseX + SLOT_BASE_OFFSET,
          placement.baseY,
          entry.enabled,
          handleChangeEntry,
          handleDeleteEntry,
          handleReorderEntries,
        ),
      )
    }
    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, modelNodeIds, layoutSnapshot, slotsVersion, rules, selectedNodeId, handleChangeEntry, handleDeleteEntry])

  const baseEdges = useMemo(() => {
    if (!providers) return []
    return buildEdges(providers, slotsStateRef.current, modelNodeIds)
  }, [providers, modelNodeIds, slotsVersion])

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
    const layouted = getLayoutedElements(nodes, edgesRef.current, {
      nodeGap: topologyConfig.layout.nodeGap,
      rowGap: topologyConfig.layout.rowGap,
      modelHubGap: topologyConfig.layout.modelHubGap,
      groupGap: topologyConfig.layout.groupGap,
      marginX: topologyConfig.layout.marginX,
      marginY: topologyConfig.layout.marginY,
    }, sizesRef.current)
    const next: LayoutSnapshot = {}
    for (const node of layouted) next[node.id] = node.position
    saveLayoutToStorage(next)
    setLayoutSnapshot(next)
    setNodes(layouted)
  }, [nodes, setNodes, sizesRef])

  // Incremental position adjustment: when a slot's size changes (add/delete
  // entry), push surrounding nodes instead of re-running auto-layout.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const slotEls = document.querySelectorAll('.react-flow__node[data-id^="slot-"]')
      const currentSizes = new Map<string, { width: number; height: number }>()
      for (const el of Array.from(slotEls)) {
        const sid = el.getAttribute('data-id')
        if (!sid) continue
        currentSizes.set(sid, {
          width: (el as HTMLElement).offsetWidth,
          height: (el as HTMLElement).offsetHeight,
        })
      }

      if (!didInitialMeasure.current) {
        prevSlotSizesRef.current = currentSizes
        didInitialMeasure.current = true
        return
      }

      const snapshot: LayoutSnapshot = {}
      Object.assign(snapshot, layoutSnapshotRef.current)
      let changed = false

      for (const [id, size] of currentSizes) {
        const prev = prevSlotSizesRef.current.get(id)
        if (!prev) continue

        const deltaH = size.height - prev.height
        const deltaW = size.width - prev.width
        if (deltaH === 0 && deltaW === 0) continue

        const providerId = providerIdFromSlotId(id)
        if (!providerId) continue
        const pvId = `pv-${providerId}`
        const pvPos = snapshot[pvId]
        const slotPos = snapshot[id]
        if (!pvPos || !slotPos) continue

        if (deltaH !== 0) {
          for (const [nodeId, pos] of Object.entries(snapshot)) {
            if (nodeId.startsWith('model-')) continue
            if (nodeId === id || nodeId === pvId) continue
            const nodePvId = nodeId.startsWith('pv-')
              ? nodeId
              : (() => { const pid = providerIdFromSlotId(nodeId); return pid ? `pv-${pid}` : null })()
            if (!nodePvId || nodePvId === pvId) continue
            const nodePvPos = snapshot[nodePvId]
            if (!nodePvPos) continue
            if (nodePvPos.y > pvPos.y) {
              snapshot[nodeId] = { ...pos, y: pos.y + deltaH }
              changed = true
            }
          }
        }

        if (deltaW !== 0) {
          for (const [nodeId, pos] of Object.entries(snapshot)) {
            if (!nodeId.startsWith('slot-') || nodeId === id) continue
            const nodePid = providerIdFromSlotId(nodeId)
            if (nodePid !== providerId) continue
            if (pos.x > slotPos.x) {
              snapshot[nodeId] = { ...pos, x: pos.x + deltaW }
              changed = true
            }
          }
        }
      }

      if (changed) {
        saveLayoutToStorage(snapshot)
        setLayoutSnapshot(snapshot)
      }
      prevSlotSizesRef.current = currentSizes
    })
    return () => cancelAnimationFrame(raf)
  }, [slotsVersion])

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes)
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.dragging) {
        const snapshot = loadLayoutFromStorage()
        snapshot[change.id] = change.position
        saveLayoutToStorage(snapshot)
        setLayoutSnapshot(snapshot)
      }
    }
  }, [onNodesChange])

  const handleAddProviderToWorkflow = useCallback((providerId: string) => {
    const provider = providers?.find((p) => p.id === providerId)
    let initialEnabled = true
    if (provider) {
      for (const other of slotsStateRef.current.values()) {
        if (other.enabled) {
          const otherProvider = providers?.find((p) => p.id === other.providerId)
          if (otherProvider?.name === provider.name) {
            initialEnabled = false
            toast.add({ title: '同名供应商已有工作流在启用，新添加的工作流默认禁用', type: 'info' })
            break
          }
        }
      }
    }
    const key = makeWorkflowKey([...slotsStateRef.current.values()], providerId)
    slotsStateRef.current.set(key, { providerId, enabled: initialEnabled, slots: emptySlotEntryMap() })
    bumpSlots()
    setDirty(true)
    setMenuState((s) => ({ ...s, open: false }))
  }, [bumpSlots, providers])

  const handleDeleteWorkflow = useCallback((workflowKey: string) => {
    slotsStateRef.current.delete(workflowKey)
    setContextMenu(null)
    setSelectedNodeId(null)
    bumpSlots()
    setDirty(true)
  }, [bumpSlots])

  const handleToggleWorkflow = useCallback((workflowKey: string) => {
    const entry = slotsStateRef.current.get(workflowKey)
    if (!entry) return
    const nextEnabled = !entry.enabled
    if (nextEnabled) {
      const sameName = providers?.find((p) => p.id === entry.providerId)?.name
      if (sameName) {
        for (const [otherKey, other] of slotsStateRef.current) {
          if (otherKey !== workflowKey && other.enabled) {
            const otherProvider = providers?.find((p) => p.id === other.providerId)
            if (otherProvider?.name === sameName) {
              slotsStateRef.current.set(otherKey, { ...other, enabled: false })
              toast.add({ title: '同名供应商已有工作流启用，已自动关闭其他实例', type: 'info' })
            }
          }
        }
      }
    }
    slotsStateRef.current.set(workflowKey, { ...entry, enabled: nextEnabled })
    bumpSlots()
    setDirty(true)
  }, [bumpSlots, providers])

  const handleAddProviderClick = useCallback(() => {
    const btn = addProviderBtnRef.current
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

  const availableProviders = useMemo(() => {
    if (!providers) return []
    return providers.map((p) => ({ id: p.id, name: p.name }))
  }, [providers])

  const workflowStats = useMemo(() => {
    let total = 0
    let active = 0
    for (const entry of slotsStateRef.current.values()) {
      total += 1
      if (entry.enabled) active += 1
    }
    return { active, total }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsVersion])

  const currentWorkflows = useMemo<Workflow[]>(() => {
    const providerNames = new Map(providers?.map((p) => [p.id, p.name]) ?? [])
    const ruleNames = new Map<string, string>()
    for (const slotType of Object.keys(rules) as (keyof SlotRuleMap)[]) {
      for (const rule of rules[slotType]) {
        ruleNames.set(`${slotType}:${rule.id}`, rule.name)
      }
    }
    return workflowsFromSlotMaps(slotsStateRef.current, providerNames, ruleNames)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, rules, slotsVersion])

  if (loading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" />
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
        <PageHeader title="转发拓扑" />
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
        <PageHeader title="转发拓扑" />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            暂无供应商配置。          请先在「供应商管理」中添加至少一个模型供应商。
          </p>
          <Button onClick={() => { window.location.href = '/provider' }}>
            <Plus data-icon="inline-start" />
            添加供应商
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
        status={`工作流：${workflowStats.active}/${workflowStats.total} · ${nodes.filter((n) => n.type !== 'modelHub').length} 节点`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
            <History data-icon="inline-start" />
            历史版本
          </Button>
        }
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
              onClick={handleAddProviderClick}
              title="添加供应商到工作流"
              aria-label="添加供应商到工作流"
              ref={addProviderBtnRef}
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
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenJson}
              title="编辑 JSON"
              aria-label="编辑 JSON"
            >
              <Code />
            </Button>
          </Panel>
        </ReactFlow>
        {menuState.open && (
          <NodeMenu
            x={menuState.x}
            y={menuState.y}
            mode={menuState.mode}
            providers={availableProviders}
            onSelect={handleAddProviderToWorkflow}
            onClose={() => setMenuState((s) => ({ ...s, open: false }))}
          />
        )}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onDelete={() => {
              const workflowKey = contextMenu.nodeId.startsWith('pv-')
                ? contextMenu.nodeId.slice(3)
                : contextMenu.nodeId
              handleDeleteWorkflow(workflowKey)
            }}
            onClose={() => setContextMenu(null)}
          />
        )}
        {jsonWorkflows && (
          <TopologyJsonEditModal
            workflows={jsonWorkflows}
            onSave={handleJsonSave}
            onClose={() => setJsonWorkflows(null)}
          />
        )}
        <Dialog
          open={navGuardNext !== null}
          onOpenChange={(open) => {
            if (!open) setNavGuardNext(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>内容未保存</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              你还有内容未保存，是否确认离开？未保存的修改将会丢失。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNavGuardNext(null)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  const target = navGuardNext
                  setNavGuardNext(null)
                  if (target) navigate(target)
                }}
              >
                确认离开
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <TopologyVersionsModal
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          providers={providers ?? []}
          currentWorkflows={currentWorkflows}
          onBeforeRestore={persistTopology}
          onRestored={() => { setVersionsOpen(false); void loadData() }}
        />
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
