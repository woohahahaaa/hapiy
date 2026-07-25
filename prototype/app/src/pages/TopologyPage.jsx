import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IngressNode from '../nodes/IngressNode';
import ModelHubNode from '../nodes/ModelHubNode';
import ChannelNode from '../nodes/ChannelNode';
import AutoSwitchNode from '../nodes/AutoSwitchNode';
import EgressNode from '../nodes/EgressNode';
import { initialNodes, initialEdges } from '../data/demoTopology';
import PageHeader from './PageHeader';

const nodeTypes = {
  ingress: IngressNode,
  modelHub: ModelHubNode,
  channel: ChannelNode,
  autoSwitch: AutoSwitchNode,
  egress: EgressNode,
};

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
};

const minimapNodeColors = {
  ingress: 'var(--sidebar-primary)',
  modelHub: 'var(--sidebar-primary)',
  channel: 'var(--chart-4)',
  autoSwitch: 'var(--node-autoswitch)',
  egress: 'var(--muted)',
};

export default function TopologyPage() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader
          icon="account_tree"
          title="转发拓扑"
          subtitle="API routing workspace"
          status={`${nodeCount} 节点 · ${edgeCount} 连线`}
        />
      </div>
      <ReactFlow
        nodes={nodes}
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
        <MiniMap
          nodeColor={(node) => minimapNodeColors[node.type] || 'var(--muted-foreground)'}
          nodeStrokeColor="var(--card-foreground)"
          nodeStrokeWidth={1.5}
          nodeBorderRadius={2}
          maskColor="color-mix(in oklch, var(--background) 48%, transparent)"
          maskStrokeColor="var(--ring)"
          maskStrokeWidth={1.5}
          ariaLabel="拓扑缩略图"
        />
        <Controls />
        <Background color="var(--border)" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
