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
import { AlertTriangle, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { ChannelNode } from '@/nodes/ChannelNode'
import { ModelHubNode } from '@/nodes/ModelHubNode'
import { AutoSwitchNode } from '@/nodes/AutoSwitchNode'
import { AutoReplyNode } from '@/nodes/AutoReplyNode'
import { RequestModifyNode } from '@/nodes/RequestModifyNode'
import { ConcurrencyNode } from '@/nodes/ConcurrencyNode'
import {
  dashboardApi,
  type Provider,
  type HeartbeatRule,
  type RewriteRule,
  type ConcurrencyRule,
  type FailoverRule,
} from '@/lib/dashboard-api'

const nodeTypes = {
  modelHub: ModelHubNode,
  channel: ChannelNode,
  autoReply: AutoReplyNode,
  requestModify: RequestModifyNode,
  autoSwitch: AutoSwitchNode,
  concurrency: ConcurrencyNode,
}

const defaultEdgeOptions = {
  animated: true,
  style: { strokeWidth: 1.5 },
}

const NODE_W = {
  modelHub: 224,
  channel: 192,
  autoReply: 192,
  requestModify: 192,
  autoSwitch: 192,
  concurrency: 192,
}

const NODE_H = {
  modelHub: 200,
  channel: 100,
  autoReply: 120,
  requestModify: 120,
  autoSwitch: 140,
  concurrency: 100,
}

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80, marginx: 20, marginy: 30 })

  for (const node of nodes) {
    g.setNode(node.id, {
      width: NODE_W[node.type as keyof typeof NODE_W] || 192,
      height: NODE_H[node.type as keyof typeof NODE_H] || 80,
    })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const { x, y } = g.node(node.id)
    const w = NODE_W[node.type as keyof typeof NODE_W] || 192
    const h = NODE_H[node.type as keyof typeof NODE_H] || 80
    return { ...node, position: { x: x - w / 2, y: y - h / 2 } }
  })
}

// ── Topology derivation helpers ──

interface RulesData {
  readonly heartbeat: readonly HeartbeatRule[]
  readonly rewrite: readonly RewriteRule[]
  readonly concurrency: readonly ConcurrencyRule[]
  readonly failover: readonly FailoverRule[]
}

function activeRules<T extends { readonly status: boolean }>(items: readonly T[]): readonly T[] {
  return items.filter((r) => r.status)
}

function firstScriptLine(script: string): string {
  if (!script) return ''
  const line = script.trim().split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))
  return line ? line.trim() : ''
}

function buildNodes(providers: readonly Provider[], rules: RulesData): Node[] {
  const hb = activeRules(rules.heartbeat)
  const rw = activeRules(rules.rewrite)
  const cc = activeRules(rules.concurrency)
  const fo = activeRules(rules.failover)

  const activeProviders = providers.filter((p) => p.status)

  // Channel nodes
  const chNodes = providers.map((p, i) => ({
    id: `ch-${p.id}`,
    type: 'channel' as const,
    position: { x: 350, y: 30 + i * 120 },
    data: {
      label: p.name,
      baseURLCount: p.baseUrls.length,
      keyCount: p.keys.length,
      modelCount: p.models.length,
      models: p.models.map((m) => m.model),
      active: p.status,
    },
  }))

  const chIds = chNodes.map((n) => n.id)

  // ModelHub node — always present
  const nodes: Node[] = [
    {
      id: 'hub',
      type: 'modelHub',
      position: { x: 20, y: 30 },
      data: {
        models: activeProviders.flatMap((p) =>
          p.models.map((m) => ({ id: m.model, label: m.model, disabled: false })),
        ),
      },
    },
    ...chNodes,
  ]

  // Processing nodes in pipeline order — only active rules
  if (hb.length > 0) {
    nodes.push({
      id: 'heartbeat',
      type: 'autoReply',
      position: { x: 650, y: 20 },
      data: {
        label: '心跳回复',
        rules: hb.map((r) => ({ name: r.name, window: r.timeout, minTokens: 0 })),
        count: hb.length,
        channelIds: chIds,
      },
    })
  }

  if (cc.length > 0) {
    nodes.push({
      id: 'concurrency',
      type: 'concurrency',
      position: { x: 900, y: 20 },
      data: {
        label: '并发控制',
        ruleItems: cc.map((r) => ({ name: r.name, scope: r.scope, max: r.maxConcurrent })),
        count: cc.length,
        sourceIds: hb.length > 0 ? ['heartbeat'] : chIds,
      },
    })
  }

  if (rw.length > 0) {
    nodes.push({
      id: 'rewrite',
      type: 'requestModify',
      position: { x: 900, y: 200 },
      data: {
        label: '请求改写',
        transforms: rw.map((r) => ({
          field: r.name,
          action: firstScriptLine(r.script) || '(空)',
        })),
        count: rw.length,
        sourceIds: cc.length > 0 ? ['concurrency'] : hb.length > 0 ? ['heartbeat'] : chIds,
      },
    })
  }

  if (fo.length > 0) {
    nodes.push({
      id: 'failover',
      type: 'autoSwitch',
      position: { x: 1150, y: 80 },
      data: {
        label: '故障转移',
        slots: fo.map((r) => ({
          key: r.name,
          provider: r.fallbackChannel,
          baseURL: r.condition,
        })),
        count: fo.length,
        sourceIds: rw.length > 0
          ? ['rewrite']
          : cc.length > 0
            ? ['concurrency']
            : hb.length > 0
              ? ['heartbeat']
              : chIds,
      },
    })
  }

  return nodes
}

function buildEdges(providers: readonly Provider[], rules: RulesData, baseNodes: Node[]): Edge[] {
  const edges: Edge[] = []
  const chNodeIdSet = new Set(providers.map((p) => `ch-${p.id}`))

  // Hub → each channel (per model binding)
  for (const provider of providers) {
    for (const model of provider.models) {
      edges.push({
        id: `hub:${model.model}→ch-${provider.id}`,
        source: 'hub',
        sourceHandle: model.model,
        target: `ch-${provider.id}`,
        targetHandle: model.model,
        animated: true,
        style: { strokeWidth: 1.5 },
      })
    }
  }

  // Pipeline node order (only those present)
  const pipelineOrder = ['heartbeat', 'concurrency', 'rewrite', 'failover'].filter((id) =>
    baseNodes.some((n) => n.id === id),
  )

  // All channels feed into the first pipeline node
  if (pipelineOrder.length > 0) {
    const first = pipelineOrder[0]
    for (const chId of chNodeIdSet) {
      edges.push({
        id: `${chId}→${first}`,
        source: chId,
        target: first,
        animated: true,
        style: { strokeWidth: 1.5 },
      })
    }

    // Sequential pipeline edges
    for (let i = 1; i < pipelineOrder.length; i++) {
      edges.push({
        id: `${pipelineOrder[i - 1]}→${pipelineOrder[i]}`,
        source: pipelineOrder[i - 1],
        target: pipelineOrder[i],
        animated: true,
        style: { strokeWidth: 1.5 },
      })
    }
  }

  // Failover: primary / fallback channel edges
  for (const fo of activeRules(rules.failover)) {
    const primaryId = `ch-${fo.primaryChannel}`
    const fallbackId = `ch-${fo.fallbackChannel}`
    if (primaryId && chNodeIdSet.has(primaryId)) {
      edges.push({
        id: `${primaryId}→failover-${fo.id}`,
        source: primaryId,
        target: 'failover',
        animated: true,
        style: { stroke: 'var(--warning, #f59e0b)', strokeWidth: 2, strokeDasharray: '4 4' },
      })
    }
    if (fallbackId && chNodeIdSet.has(fallbackId)) {
      edges.push({
        id: `failover-${fo.id}→${fallbackId}`,
        source: 'failover',
        target: fallbackId,
        animated: true,
        style: { stroke: 'var(--success, #10b981)', strokeWidth: 2, strokeDasharray: '4 4' },
      })
    }
  }

  return edges
}

// ── TopologyPage ──

export function TopologyPage() {
  const [providers, setProviders] = useState<readonly Provider[] | null>(null)
  const [rules, setRules] = useState<RulesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [channels, heartbeat, rewrite, concurrency, failover] = await Promise.all([
        dashboardApi.listProviders(),
        dashboardApi.listRules<HeartbeatRule>('heartbeat'),
        dashboardApi.listRules<RewriteRule>('rewrite'),
        dashboardApi.listRules<ConcurrencyRule>('concurrency'),
        dashboardApi.listRules<FailoverRule>('failover'),
      ])
      setProviders(channels)
      setRules({ heartbeat, rewrite, concurrency, failover })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Derive nodes and edges from real data
  const baseNodes = useMemo(() => {
    if (!providers || !rules) return []
    return buildNodes(providers, rules)
  }, [providers, rules])

  const baseEdges = useMemo(() => {
    if (!providers || !rules || baseNodes.length === 0) return []
    return buildEdges(providers, rules, baseNodes)
  }, [providers, rules, baseNodes])

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes)
  const [edges, _setEdges, onEdgesChange] = useEdgesState(baseEdges)

  useEffect(() => {
    setNodes(baseNodes)
  }, [baseNodes, setNodes])

  useEffect(() => {
    _setEdges(baseEdges)
  }, [baseEdges, _setEdges])

  const edgesRef = useRef(edges)
  edgesRef.current = edges

  const handleAutoLayout = useCallback(() => {
    setNodes((nds) => getLayoutedElements(nds, edgesRef.current))
  }, [setNodes])

  // Refresh provider/node data after auto-layout moves positions
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        if (!providers) return n
        if (n.type === 'channel') {
          const prov = providers.find((p) => `ch-${p.id}` === n.id)
          return {
            ...n,
            data: {
              ...n.data,
              label: prov?.name ?? n.data.label,
              baseURLCount: prov?.baseUrls.length ?? 0,
              keyCount: prov?.keys.length ?? 0,
              modelCount: prov?.models.length ?? 0,
              models: prov?.models.map((m) => m.model) ?? [],
              active: prov?.status !== false,
            },
          }
        }
        if (n.type === 'modelHub') {
          const activeProviders = providers.filter((p) => p.status)
          return {
            ...n,
            data: {
              ...n.data,
              models: activeProviders.flatMap((p) =>
                p.models.map((m) => ({ id: m.model, label: m.model, disabled: false })),
              ),
            },
          }
        }
        return n
      }),
    [nodes, providers],
  )

  // ── Loading state ──
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

  // ── Error state ──
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

  // ── Empty state ──
  if (!providers || providers.length === 0) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="转发拓扑" subtitle="API routing workspace" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            暂无渠道配置。请先在「渠道管理」中添加至少一个模型供应商。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="转发拓扑"
        subtitle="API routing workspace"
        status={`${nodes.length} 节点 · ${edges.length} 连线`}
      />
      <div className="relative flex-1">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
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
      </div>
    </div>
  )
}