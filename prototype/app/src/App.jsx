import { useEffect, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Sidebar from './components/Sidebar';
import EndpointNode from './nodes/EndpointNode';
import RouteNode from './nodes/RouteNode';
import ChannelNode from './nodes/ChannelNode';
import AutoSwitchNode from './nodes/AutoSwitchNode';
import AutoReplyNode from './nodes/AutoReplyNode';
import { initialNodes, initialEdges } from './data/demoTopology';
import './App.css';

const nodeTypes = {
  endpoint: EndpointNode,
  route: RouteNode,
  channel: ChannelNode,
  autoSwitch: AutoSwitchNode,
  autoReply: AutoReplyNode,
};

const defaultEdgeOptions = {
  animated: false,
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
};

const minimapNodeColors = {
  endpoint: 'var(--chart-1)',
  route: 'var(--chart-2)',
  channel: 'var(--chart-4)',
  autoSwitch: 'var(--node-autoswitch)',
  autoReply: 'var(--node-autoreply)',
};

const mobileSidebarQuery = '(max-width: 640px)';

function useResponsiveSidebar() {
  const [expanded, setExpanded] = useState(
    () => !window.matchMedia(mobileSidebarQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileSidebarQuery);
    const collapseOnMobile = (event) => {
      if (event.matches) setExpanded(false);
    };

    mediaQuery.addEventListener('change', collapseOnMobile);
    return () => mediaQuery.removeEventListener('change', collapseOnMobile);
  }, []);

  return [expanded, setExpanded];
}

function App() {
  const [expanded, setExpanded] = useResponsiveSidebar();
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="app-shell">
      <Sidebar expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      <main className={`main-area ${expanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        <div className="canvas-topbar" aria-hidden="true">
          <span className="material-symbols-outlined canvas-topbar-icon">account_tree</span>
          <div className="canvas-heading">
            <strong>转发拓扑</strong>
            <span>API routing workspace</span>
          </div>
          <span className="canvas-status">9 节点 · 6 连线</span>
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
      </main>
    </div>
  );
}

export default App;
