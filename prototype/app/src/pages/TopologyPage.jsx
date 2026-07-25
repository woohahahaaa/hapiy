import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import EndpointNode from '../nodes/EndpointNode';
import RouteNode from '../nodes/RouteNode';
import ChannelNode from '../nodes/ChannelNode';
import AutoSwitchNode from '../nodes/AutoSwitchNode';
import AutoReplyNode from '../nodes/AutoReplyNode';
import { initialNodes, initialEdges } from '../data/demoTopology';
import PageHeader from './PageHeader';

const nodeTypes = {
  endpoint: EndpointNode,
  route: RouteNode,
  channel: ChannelNode,
  autoSwitch: AutoSwitchNode,
  autoReply: AutoReplyNode,
};

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
};

const minimapNodeColors = {
  endpoint: 'var(--chart-1)',
  route: 'var(--chart-2)',
  channel: 'var(--chart-4)',
  autoSwitch: 'var(--node-autoswitch)',
  autoReply: 'var(--node-autoreply)',
};

export default function TopologyPage() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader
          icon="account_tree"
          title="转发拓扑"
          subtitle="API routing workspace"
          status="9 节点 · 6 连线"
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
