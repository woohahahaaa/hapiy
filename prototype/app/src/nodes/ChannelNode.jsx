import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';
import './ChannelNode.css';

export default function ChannelNode({ data, id }) {
  const { label, baseURLCount, keyCount, modelCount, models, active, onToggle } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const lenRef = useRef((models || []).length);

  useEffect(() => {
    if ((models || []).length !== lenRef.current) {
      lenRef.current = (models || []).length;
      updateNodeInternals(id);
    }
  }, [id, models, updateNodeInternals]);

  const modelList = models || [];
  const n = modelList.length;
  const segH = 20;
  const gap = -2;
  const total = n * segH + (n - 1) * gap;
  const start = -(total / 2);

  return (
    <div className={`node node-channel ${!active ? 'off' : ''}`}>
      {modelList.map((m, i) => (
        <Handle
          key={m}
          type="target"
          position={Position.Left}
          id={m}
          className="handle-bar"
          style={{ top: `calc(50% + ${start + i * (segH + gap)}px)`, height: segH, transform: 'translate(-50%, 0)' }}
        />
      ))}
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
