import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './RouteNode.css';

export default function RouteNode({ data }) {
  const { label, rule, priority } = data;

  return (
    <div className="node node-route">
      <Handle type="target" position={Position.Left} />
      <div className="node-header">{label || 'Route'}</div>
      <div className="node-body">
        <div className="prop">
          Rule: <span className="prop-value">{rule || '—'}</span>
        </div>
        <div className="prop">
          Priority: <span className="prop-value">{priority != null ? priority : '—'}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
