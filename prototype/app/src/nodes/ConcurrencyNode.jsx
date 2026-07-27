import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';

export default function ConcurrencyNode({ data, id }) {
  const { label, ruleItems, count, sourceIds } = data;
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
    <div className="node" style={{ width: 192, cursor: 'default' }}>
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
      <Handle type="source" position={Position.Right} />
      <div className="node-header">{label || '并发控制'}</div>
      <div className="node-body">
        {ruleItems && ruleItems.length > 0 ? (
          ruleItems.map((r, i) => (
            <div className="prop" key={i}>
              {r.name}: <span className="prop-value">{r.scope} / {r.max}</span>
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
        {count ?? ruleItems?.length ?? 0} rules
      </div>
    </div>
  );
}
