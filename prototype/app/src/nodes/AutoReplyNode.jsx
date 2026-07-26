import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';
import './AutoReplyNode.css';

export default function AutoReplyNode({ data, id }) {
  const { label, rules, count, channelIds } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const lenRef = useRef((channelIds || []).length);

  useEffect(() => {
    if ((channelIds || []).length !== lenRef.current) {
      lenRef.current = (channelIds || []).length;
      updateNodeInternals(id);
    }
  }, [id, channelIds, updateNodeInternals]);

  const cids = channelIds || [];
  const n = cids.length;
  const segH = 20;
  const gap = -2;
  const barTotal = n * segH + (n - 1) * gap;
  const barStart = -(barTotal / 2);

  return (
    <div className="node node-autoreply">
      {cids.map((ch, i) => (
        <Handle
          key={ch}
          type="target"
          position={Position.Left}
          id={ch}
          className="handle-bar"
          style={{ top: `calc(50% + ${barStart + i * (segH + gap)}px)`, height: segH, transform: 'translate(-50%, 0)' }}
        />
      ))}
      <Handle type="source" position={Position.Right} />
      <div className="node-header">{label || '自动回复'}</div>
      <div className="node-body">
        {rules && rules.length > 0 ? (
          rules.map((r, i) => (
            <div className="prop" key={i}>
              {r.pattern}: <span className="prop-value">{r.response}</span>
            </div>
          ))
        ) : (
          <div className="prop">No rules</div>
        )}
      </div>
      <div style={{
        padding: '4px 8px', borderTop: '1px solid var(--border)',
        fontSize: 10, color: 'var(--muted-foreground)',
      }}>
        {count ?? rules?.length ?? 0} rules
      </div>
    </div>
  );
}
