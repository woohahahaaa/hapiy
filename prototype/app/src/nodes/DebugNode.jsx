import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import './node-base.css';

const LOG_OPTIONS = ['请求体', '响应体', 'Headers', '延迟', 'Token消耗', '状态码'];

export default function DebugNode({ data, id }) {
  const { label, sourceIds } = data;
  const [enabled, setEnabled] = useState(data.enabled !== false);
  const [selected, setSelected] = useState(data.selected || []);
  const [filePath, setFilePath] = useState(data.filePath || '');
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

  function toggleOption(opt) {
    setSelected((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  }

  return (
    <div className="node" style={{ width: 200, cursor: 'default' }}>
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
      <div className="node-header" style={{ justifyContent: 'space-between' }}>
        <span>{label || '调试'}</span>
        <button
          type="button"
          className={`enable-switch ${enabled ? 'on' : ''}`}
          style={{
            position: 'relative', width: 32, height: 18, borderRadius: 9,
            border: 'none', background: enabled ? 'var(--chart-2)' : 'var(--muted-foreground)',
            cursor: 'pointer', padding: 0, flexShrink: 0,
          }}
          onClick={() => setEnabled((v) => !v)}
        >
          <span style={{
            position: 'absolute', top: 1.5, left: enabled ? 15.5 : 1.5,
            width: 15, height: 15, borderRadius: '50%', background: 'var(--card)',
            transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }} />
        </button>
      </div>
      {enabled && (
        <div className="node-body">
          <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 4 }}>记录字段：</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {LOG_OPTIONS.map((opt) => (
              <label
                key={opt}
                style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  background: selected.includes(opt) ? 'var(--sidebar-primary)' : 'var(--muted)',
                  color: selected.includes(opt) ? 'var(--sidebar-primary-foreground)' : 'var(--muted-foreground)',
                  cursor: 'pointer', userSelect: 'none',
                }}
                onClick={() => toggleOption(opt)}
              >
                {opt}
              </label>
            ))}
          </div>
          <div className="prop">
            存储路径：
          </div>
          <input
            style={{
              width: '100%', height: 24, fontSize: 10, fontFamily: 'var(--font-mono)',
              background: 'var(--background)', color: 'var(--foreground)',
              border: '1px solid var(--border)', borderRadius: 4, padding: '0 6px',
              outline: 'none', marginTop: 2,
            }}
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="/var/log/hapiy/"
          />
        </div>
      )}
      {!enabled && (
        <div className="node-body">
          <div className="prop" style={{ color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
            已关闭
          </div>
        </div>
      )}
    </div>
  );
}
