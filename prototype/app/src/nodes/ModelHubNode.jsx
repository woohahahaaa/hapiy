import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import './node-base.css';

export default function ModelHubNode({ data, id }) {
  const models = data.models || [];
  const updateNodeInternals = useUpdateNodeInternals();
  const lenRef = useRef(models.length);

  useEffect(() => {
    if (models.length !== lenRef.current) {
      lenRef.current = models.length;
      updateNodeInternals(id);
    }
  }, [id, models.length, updateNodeInternals]);

  return (
    <div className="node" style={{ width: 220, cursor: 'default' }}>
      <div className="node-header" style={{ borderBottom: '1px solid var(--border)' }}>
        模型中心
      </div>
      <div className="node-body" style={{ gap: 0, padding: 0 }}>
        {models.map((m, i) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 10px',
              fontSize: 12,
              gap: 6,
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              color: m.disabled ? 'var(--muted-foreground)' : 'var(--foreground)',
              position: 'relative',
              opacity: m.disabled ? 0.4 : 1,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--sidebar-primary)', flexShrink: 0, opacity: 0.7,
            }} />
            <span style={{ fontSize: 11 }}>{m.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={m.id}
            />
          </div>
        ))}
      </div>
      <div style={{
        padding: '5px 10px', borderTop: '1px solid var(--border)',
        fontSize: 10, color: 'var(--muted-foreground)',
      }}>
        {models.length} models
      </div>
    </div>
  );
}
