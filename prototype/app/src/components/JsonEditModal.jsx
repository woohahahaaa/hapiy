import { useState } from 'react';

export default function JsonEditModal({ data, onSave, onClose }) {
  const [text, setText] = useState(() => JSON.stringify(data, null, 2));
  const [error, setError] = useState(null);

  function handleSave() {
    try {
      const parsed = JSON.parse(text);
      onSave(parsed);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ width: 640, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">编辑 JSON</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && (
            <div style={{ color: 'var(--destructive)', fontSize: 11, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              {error}
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            style={{
              width: '100%',
              minHeight: 340,
              background: 'var(--background)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
            }}
            spellCheck={false}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="settings-btn" onClick={onClose}>取消</button>
            <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={handleSave}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
