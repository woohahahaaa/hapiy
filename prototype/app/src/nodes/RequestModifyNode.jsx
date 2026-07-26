import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './RequestModifyNode.css';

export default function RequestModifyNode({ data }) {
  const { label, transforms, count } = data;

  return (
    <div className="node node-requestmodify">
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
    </div>
  );
}