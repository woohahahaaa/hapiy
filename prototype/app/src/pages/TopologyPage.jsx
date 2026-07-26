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
import { useProviders, getModelsUnion, generateProviderEdges } from '../store/ProviderStore';
import { useRules } from '../store/RuleStore';
import PageHeader from './PageHeader';

const nodeTypes = {
  modelHub: ModelHubNode,
  channel: ChannelNode,
  autoReply: AutoReplyNode,
  requestModify: RequestModifyNode,
  autoSwitch: AutoSwitchNode,
};

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
};

const NODE_W = {
  modelHub: 220,
  channel: 192,
  autoReply: 192,
  requestModify: 192,
  autoSwitch: 192,
};
const NODE_H = {
  modelHub: 210,
  channel: 140,
  autoReply: 130,
  requestModify: 130,
  autoSwitch: 300,
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
    const heartbeatRules = (rules.heartbeat || []).filter((r) => r.status);
    const rewriteRules = (rules.rewrite || []).filter((r) => r.status);
    const failoverRules = (rules.failover || []).filter((r) => r.status);

const channelNodes = providers.map((p, i) => ({
      id: `ch-${p.id}`,
      type: 'channel',
      position: { x: 350, y: 30 + i * 160 },
      data: {
        label: p.name,
        baseURLCount: (p.baseUrls || []).length,
        keyCount: (p.keys || []).length,
        modelCount: (p.models || []).length,
        models: (p.models || []).map((m) => m.model),
        active: p.status,
      },
    }));

    return [
      { id: 'hub', type: 'modelHub', position: { x: 20, y: 30 }, data: { models: getModelsUnion(providers) } },
      ...channelNodes,
      {
        id: 'auto-reply', type: 'autoReply', position: { x: 380, y: 30 },
        data: {
          label: '自动回复',
          rules: heartbeatRules.map((r) => ({ pattern: r.pattern, response: r.response })),
          count: heartbeatRules.length,
          channelIds: providers.map((p) => `ch-${p.id}`),
        },
      },
      {
        id: 'request-modify', type: 'requestModify', position: { x: 640, y: 180 },
        data: {
          label: '请求改写',
          transforms: rewriteRules.map((r) => ({ field: r.field, action: `${r.action} → ${r.value}` })),
          count: rewriteRules.length,
          sourceIds: ['auto-reply'],
        },
      },
      {
        id: 'auto-switch', type: 'autoSwitch', position: { x: 900, y: 330 },
        data: {
          label: '故障转移',
          slots: failoverRules.map((r) => ({ key: r.name, provider: r.fallback, baseURL: r.condition === 'rate_limit' ? '限流触发' : r.condition === 'error' ? '错误触发' : '超时触发' })),
          count: failoverRules.length,
          sourceIds: ['request-modify'],
        },
      },
    ];
  }, [providers, rules]);

  const baseEdges = useMemo(() => {
    const providerEdges = generateProviderEdges(providers);
    const channelIds = providers.map((p) => `ch-${p.id}`);
    return [
      ...providerEdges,
      ...channelIds.map((chId) => ({
        id: `${chId}->auto-reply`,
        source: chId,
        target: 'auto-reply',
        targetHandle: chId,
        animated: true,
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
      })),
      { id: 'auto-reply->request-modify', source: 'auto-reply', target: 'request-modify', targetHandle: 'auto-reply', animated: true, style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
      { id: 'request-modify->auto-switch', source: 'request-modify', target: 'auto-switch', targetHandle: 'request-modify', animated: true, style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 } },
    ];
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
          data: {
            ...n.data,
            label: prov?.name || n.data.label,
            baseURLCount: (prov?.baseUrls || []).length,
            keyCount: (prov?.keys || []).length,
            modelCount: (prov?.models || []).length,
            models: (prov?.models || []).map((m) => m.model),
            active: prov?.status !== false,
            onToggle: () => toggleProvider(prov?.id),
          },
        };
      }
      if (n.type === 'modelHub') {
        return { ...n, data: { models: getModelsUnion(providers) } };
      }
      return n;
    }),
  [nodes, providers, toggleProvider]);

  const displayEdges = edges;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader
         
          title="转发拓扑"
          subtitle="API routing workspace"
          status={`${nodes.length} 节点 · ${edges.length} 连线`}
        />
      </div>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
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
          <button
            title="自动布局"
            aria-label="自动布局"
            onClick={handleAutoLayout}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--foreground)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'wght' 400" }}>auto_awesome</span>
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
