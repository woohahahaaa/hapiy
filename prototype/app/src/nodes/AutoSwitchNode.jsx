import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';
import './AutoSwitchNode.css';

export default function AutoSwitchNode({ data, id }) {
  const { label, slots, count, sourceIds } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const lenRef = useRef((sourceIds || []).length);

  useEffect(() => {
    if ((sourceIds || []).length !== lenRef.current) {
      lenRef.current = (sourceIds || []).length;
      updateNodeInternals(id);
    }
  }, [id, sourceIds, updateNodeInternals]);

  const sids = sourceIds || [];
  const n = sids.length;
  const segH = 20;
  const gap = -2;
  const total = n * segH + (n - 1) * gap;
  const start = -(total / 2);

  return (
    <div className="node node-autoswitch">
      {sids.map((src, i) => (
        <Handle
          key={src}
          type="target"
          position={Position.Left}
          id={src}
          className="handle-bar"
          style={{ top: `calc(50% + ${start + i * (segH + gap)}px)`, height: segH, transform: 'translate(-50%, 0)' }}
        />
      ))}
      <div className="node-header">{label || '自动切换'}</div>
      <div className="node-body">
        <div className="switch-slots">
          {slots && slots.length > 0 ? (
            slots.map((slot, i) => (
              <div className="switch-slot" key={i}>
                <span className="slot-key">{slot.key ?? `Slot ${i + 1}`}</span>
                <span className="slot-provider">{slot.provider || '—'}</span>
                <span className="slot-url">{slot.baseURL || '—'}</span>
              </div>
            ))
          ) : (
            <div className="prop">No slots configured</div>
          )}
        </div>
      </div>
      <div style={{
        padding: '4px 8px', borderTop: '1px solid var(--border)',
        fontSize: 10, color: 'var(--muted-foreground)',
      }}>
        {count ?? slots?.length ?? 0} rules
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
