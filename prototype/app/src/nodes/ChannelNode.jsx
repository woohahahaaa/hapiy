import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './ChannelNode.css';

export default function ChannelNode({ data }) {
  const { label, provider, url, latency } = data;

  return (
    <div className="node node-channel">
      <Handle type="target" position={Position.Left} />
      <div className="node-header">{label || 'Channel'}</div>
      <div className="node-body">
        <div className="prop">
          Provider: <span className="prop-value">{provider || '—'}</span>
        </div>
        <div className="prop">
          URL: <span className="prop-value">{url || '—'}</span>
        </div>
        <div className="prop">
          Latency: <span className="prop-value">{latency || '—'}</span>
        </div>
      </div>
    </div>
  );
}
