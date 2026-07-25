import { Handle, Position } from '@xyflow/react';

const style = {
  background: 'color-mix(in oklch, var(--muted) 50%, var(--background))',
  color: 'var(--foreground)',
  width: 48,
  minHeight: 160,
  borderRadius: 24,
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontFamily: 'var(--font-sans)',
  cursor: 'default',
  userSelect: 'none',
};

export default function EgressNode() {
  return (
    <div style={style}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--muted-foreground)', border: '2px solid var(--background)', width: 10, height: 10, top: '50%' }} />
      <div style={{ fontSize: 20, lineHeight: 1, opacity: 0.7 }}>⬆</div>
      <div style={{ fontSize: 12, fontWeight: 600, writingMode: 'vertical-lr', textOrientation: 'upright', letterSpacing: '0.2em' }}>出口</div>
    </div>
  );
}
