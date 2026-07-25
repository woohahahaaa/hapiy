import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './EndpointNode.css';

export default function EndpointNode({ data }) {
  const { label, model, status } = data;
  const statusClass = status === 'active' ? 'status-active' : 'status-inactive';

  return (
    <div className="node node-endpoint">
      <div className="node-header">{label || 'Endpoint'}</div>
      <div className="node-body">
        <div className="prop">
          Model: <span className="prop-value">{model || '—'}</span>
        </div>
        <div className="prop status-row">
          Status:
          <span className={`prop-value ${statusClass}`}>
            <span className="status-dot" />
            {status || 'unknown'}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
