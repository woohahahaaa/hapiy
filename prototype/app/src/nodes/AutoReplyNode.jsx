import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './AutoReplyNode.css';

export default function AutoReplyNode({ data }) {
  const { label, timeout, message } = data;

  return (
    <div className="node node-autoreply">
      <Handle type="target" position={Position.Left} />
      <div className="node-header">{label || '自动回复'}</div>
      <div className="node-body">
        <div className="prop">
          Timeout: <span className="prop-value">{timeout || '—'}</span>
        </div>
        <div className="prop">
          Message: <span className="prop-value">{message || '—'}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
