import { Handle, Position } from '@xyflow/react';
import './node-base.css';
import './AutoSwitchNode.css';

export default function AutoSwitchNode({ data }) {
  const { label, slots, count } = data;

  return (
    <div className="node node-autoswitch">
      <Handle type="target" position={Position.Left} />
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
