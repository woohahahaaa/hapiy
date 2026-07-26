import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './ChannelNode.css';

export default function ChannelNode({ data }) {
  const { label, baseURLCount, keyCount, modelCount, active, onToggle } = data;

  return (
    <div className={`node node-channel ${!active ? 'off' : ''}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} />
      <div className="node-header channel-header">
        <span className="channel-header-label">{label || 'Channel'}</span>
        <div className="enable-row" onClick={() => onToggle?.()}>
          <button
            type="button"
            className={`enable-switch ${active !== false ? 'on' : ''}`}
            role="switch"
            aria-checked={active !== false}
            tabIndex={-1}
          />
        </div>
      </div>
      <div className="node-body">
        <div className="channel-counts">
          <span className="channel-count">{baseURLCount ?? 0} Base URLs</span>
          <span className="channel-count-sep">·</span>
          <span className="channel-count">{keyCount ?? 0} Keys</span>
          <span className="channel-count-sep">·</span>
          <span className="channel-count">{modelCount ?? 0} Models</span>
        </div>
      </div>
    </div>
  );
}
