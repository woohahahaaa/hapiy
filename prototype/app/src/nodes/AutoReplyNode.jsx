import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './AutoReplyNode.css';

export default function AutoReplyNode({ data }) {
  const { label, rules, count } = data;

  return (
    <div className="node node-autoreply">
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
