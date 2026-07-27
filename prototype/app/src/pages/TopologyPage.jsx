import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import ChannelNode from '../nodes/ChannelNode';
import ModelHubNode from '../nodes/ModelHubNode';
import AutoReplyNode from '../nodes/AutoReplyNode';
import RequestModifyNode from '../nodes/RequestModifyNode';
import AutoSwitchNode from '../nodes/AutoSwitchNode';
import ConcurrencyNode from '../nodes/ConcurrencyNode';
import DebugNode from '../nodes/DebugNode';
import { useProviders, getModelsUnion, generateProviderEdges } from '../store/ProviderStore';
import { useRules } from '../store/RuleStore';
import PageHeader from './PageHeader';

const nodeTypes = {
  modelHub: ModelHubNode,
  channel: ChannelNode,
  autoReply: AutoReplyNode,
  requestModify: RequestModifyNode,
  autoSwitch: AutoSwitchNode,
  concurrency: ConcurrencyNode,
  debug: DebugNode,
};

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
};

const NODE_W = {
  modelHub: 220, channel: 192, autoReply: 192,
  requestModify: 192, autoSwitch: 192, concurrency: 192, debug: 200,
};
const NODE_H = {
  modelHub: 210, channel: 140, autoReply: 130,
  requestModify: 130, autoSwitch: 300, concurrency: 100, debug: 150,
};

function getLayoutedElements(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80, marginx: 20, marginy: 30 });
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W[node.type] || 192, height: NODE_H[node.type] || 80 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);
  return nodes.map((node) => {
    const { x, y } = g.node(node.id);
    const w = NODE_W[node.type] || 192;
    const h = NODE_H[node.type] || 80;
    return { ...node, position: { x: x - w / 2, y: y - h / 2 } };
  });
}

export default function TopologyPage() {
  const { providers, version, toggleProvider } = useProviders();
  const { rules } = useRules();

  const baseNodes = useMemo(() => {
    const hb = (rules.heartbeat || []).filter((r) => r.status);
    const rw = (rules.rewrite || []).filter((r) => r.status);
    const fo = (rules.failover || []).filter((r) => r.status);
    const cc = (rules.concurrency || []).filter((r) => r.status);

    const activeProvs = providers.filter((p) => p.status);
    const chNodes = providers.map((p, i) => ({
      id: `ch-${p.id}`, type: 'channel', position: { x: 350, y: 30 + i * 120 },
      data: {
        label: p.name, baseURLCount: (p.baseUrls || []).length,
        keyCount: (p.keys || []).length, modelCount: (p.models || []).length,
        models: (p.models || []).map((m) => m.model), active: p.status,
      },
    }));

    // ch-1,ch-2 → reply-A → concurrency → rewrite-A → switch-main
    // ch-4 → rewrite-A → switch-main (skip reply+concur)
    // ch-5 → switch-main (no processing)
    // ch-3 → reply-B → switch-backup

    return [
      { id: 'hub', type: 'modelHub', position: { x: 20, y: 30 }, data: { models: getModelsUnion(providers) } },
      ...chNodes,
      { id: 'reply-A', type: 'autoReply', position: { x: 380, y: 20 },
        data: { label: '心跳回复 A', rules: hb, count: hb.length, channelIds: ['ch-1', 'ch-2'] } },
      { id: 'reply-B', type: 'autoReply', position: { x: 380, y: 250 },
        data: { label: '心跳回复 B', rules: hb, count: hb.length, channelIds: ['ch-3', 'ch-5'] } },
      { id: 'concurrency-main', type: 'concurrency', position: { x: 640, y: 20 },
        data: { label: '并发控制', ruleItems: cc.map((r) => ({ name: r.name, scope: r.scope, max: r.maxConcurrent })), count: cc.length, sourceIds: ['reply-A'] } },
      { id: 'debug-A', type: 'debug', position: { x: 640, y: 140 },
        data: { label: '调试 A', enabled: true, selected: ['请求体', '延迟', '状态码'], filePath: '/var/log/hapiy/openai/', sourceIds: ['reply-A'] } },
      { id: 'debug-B', type: 'debug', position: { x: 640, y: 250 },
        data: { label: '调试 B', enabled: false, sourceIds: ['ch-4'] } },
      { id: 'rewrite-A', type: 'requestModify', position: { x: 640, y: 200 },
        data: { label: '请求改写', transforms: rw.map((r) => ({ field: r.field, action: `${r.action} → ${r.value}` })), count: rw.length, sourceIds: ['concurrency-main', 'debug-B'] } },
      { id: 'switch-main', type: 'autoSwitch', position: { x: 900, y: 80 },
        data: { label: '故障转移(主)', slots: fo.map((r) => ({ key: r.name, provider: r.fallback, baseURL: r.condition })), count: fo.length, sourceIds: ['rewrite-A', 'ch-5'] } },
      { id: 'switch-backup', type: 'autoSwitch', position: { x: 900, y: 350 },
        data: { label: '故障转移(备)', slots: fo.map((r) => ({ key: r.name, provider: r.fallback, baseURL: r.condition })), count: fo.length, sourceIds: ['reply-B'] } },
    ];
  }, [providers, rules]);

  const baseEdges = useMemo(() => {
    const providerEdges = generateProviderEdges(providers);

    // Custom pipeline edges — flexible, per-channel routing
    const custom = [
{ id: 'ch-1→reply-A',      source: 'ch-1', target: 'reply-A',   targetHandle: 'ch-1', style: { stroke: 'var(--chart-1)', strokeWidth: 1.5 } },
      { id: 'ch-2→reply-A',      source: 'ch-2', target: 'reply-A',   targetHandle: 'ch-2', style: { stroke: 'var(--chart-2)', strokeWidth: 1.5 } },
      { id: 'reply-A→debug-A',   source: 'reply-A', target: 'debug-A', targetHandle: 'reply-A', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'debug-A→concurrency-main', source: 'debug-A', target: 'concurrency-main', targetHandle: 'debug-A', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'concurrency-main→rewrite-A', source: 'concurrency-main', target: 'rewrite-A', targetHandle: 'concurrency-main', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'rewrite-A→switch-main', source: 'rewrite-A', target: 'switch-main', targetHandle: 'rewrite-A', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'ch-4→debug-B',      source: 'ch-4', target: 'debug-B',   targetHandle: 'ch-4', style: { stroke: 'var(--chart-4)', strokeWidth: 1.5 } },
      { id: 'debug-B→rewrite-A',   source: 'debug-B', target: 'rewrite-A', targetHandle: 'debug-B', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'ch-5→switch-main',  source: 'ch-5', target: 'switch-main', targetHandle: 'ch-5', style: { stroke: 'var(--chart-5)', strokeWidth: 1.5 } },
      { id: 'ch-3→reply-B',      source: 'ch-3', target: 'reply-B',   targetHandle: 'ch-3', style: { stroke: 'var(--chart-3)', strokeWidth: 1.5 } },
      { id: 'reply-B→switch-backup', source: 'reply-B', target: 'switch-backup', targetHandle: 'reply-B', style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
    ];

    return [...providerEdges, ...custom];
  }, [providers]);

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(baseEdges);

  useEffect(() => { setNodes(baseNodes); }, [version]);
  useEffect(() => { _setEdges(baseEdges); }, [version]);

  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const handleAutoLayout = useCallback(() => {
    setNodes((nds) => getLayoutedElements(nds, edgesRef.current));
  }, [setNodes]);

  const displayNodes = useMemo(() =>
    nodes.map((n) => {
      if (n.type === 'channel') {
        const prov = providers.find((p) => `ch-${p.id}` === n.id);
        return {
          ...n,
          data: { ...n.data, label: prov?.name || n.data.label,
            baseURLCount: (prov?.baseUrls || []).length,
            keyCount: (prov?.keys || []).length,
            modelCount: (prov?.models || []).length,
            models: (prov?.models || []).map((m) => m.model),
            active: prov?.status !== false,
            onToggle: () => toggleProvider(prov?.id) },
        };
      }
      if (n.type === 'modelHub') {
        return { ...n, data: { models: getModelsUnion(providers) } };
      }
      return n;
    }),
  [nodes, providers, toggleProvider]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader title="转发拓扑" subtitle="API routing workspace" status={`${nodes.length} 节点 · ${edges.length} 连线`} />
      </div>
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
      >
        <Controls className="topology-controls" position="bottom-right" />
        <Background color="var(--border)" gap={20} size={1} />
        <Panel className="topology-auto-layout" position="bottom-right">
          <button title="自动布局" aria-label="自动布局" onClick={handleAutoLayout}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--foreground)', boxShadow: 'var(--shadow-md)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'wght' 400" }}>auto_awesome</span>
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
