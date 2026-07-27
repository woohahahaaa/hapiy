import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';
import './RequestModifyNode.css';

export default function RequestModifyNode({ data, id }) {
  const { label, transforms, count, sourceIds } = data;
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
    <div className="node node-requestmodify">
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
      <div className="node-header">{label || '请求修改'}</div>
      <div className="node-body">
        <div className="modify-transforms">
          {transforms && transforms.length > 0 ? (
            transforms.map((t, i) => (
              <div className="modify-transform" key={i}>
                <span className="transform-field">{t.field ?? '—'}</span>
                <span className="transform-action">{t.action ?? '—'}</span>
              </div>
            ))
          ) : (
            <div className="prop">No transforms configured</div>
          )}
        </div>
      </div>
      <div style={{
        padding: '4px 8px', borderTop: '1px solid var(--border)',
        fontSize: 10, color: 'var(--muted-foreground)',
      }}>
        {count ?? transforms?.length ?? 0} rules
      </div>
    </div>
  );
}