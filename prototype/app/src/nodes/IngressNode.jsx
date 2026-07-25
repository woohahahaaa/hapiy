import { Handle, Position } from '@xyflow/react';

const style = {
  background: 'var(--sidebar-primary)',
  color: 'var(--sidebar-primary-foreground)',
  width: 48,
  minHeight: 160,
  borderRadius: 24,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontFamily: 'var(--font-sans)',
  cursor: 'default',
  userSelect: 'none',
};

export default function IngressNode() {
  return (
    <div style={style}>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--sidebar-primary)', border: '2px solid var(--background)', width: 10, height: 10, top: '50%' }} />
      <div style={{ fontSize: 20, lineHeight: 1, opacity: 0.7 }}>⬇</div>
      <div style={{ fontSize: 12, fontWeight: 600, writingMode: 'vertical-lr', textOrientation: 'upright', letterSpacing: '0.2em' }}>入口</div>
    </div>
  );
}
