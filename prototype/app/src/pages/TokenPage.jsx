import { useState } from 'react';
import PageHeader from './PageHeader';
import JsonEditModal from '../components/JsonEditModal';
import './settings.css';

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const SEED = [
  { id: 1, name: '生产环境', key: 'sk-prod-xxxxxxxxxxxxxxxx', quota: '', status: true },
  { id: 2, name: '测试环境', key: 'sk-test-xxxxxxxxxxxxxxxx', quota: '100.00', status: true },
  { id: 3, name: '开发环境', key: 'sk-dev-xxxxxxxxxxxxxxxx', quota: '50.00', status: false },
];

function TokenForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [key, setKey] = useState(initial?.key || '');
  const [quota, setQuota] = useState(initial?.quota || '');
  const [status, setStatus] = useState(initial?.status !== false);

  function save() {
    onSave({ name: name.trim() || 'New Token', key: key.trim() || 'sk-xxxxxxxx', quota: quota.trim() || '无限制', status });
  }

  return (
    <div className="settings-card-body" style={{ gap: 14 }}>
      <div className="settings-switch-row">
        <div className="settings-switch-label">启用</div>
        <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">名称</label>
        <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="令牌名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">Key</label>
        <input className="settings-field-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-xxxxxxxx" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">额度 (¥)</label>
        <input className="settings-field-input" value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="留空则表示不限制" />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

export default function TokenPage() {
  const [tokens, setTokens] = useState(SEED);
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  function handleSave(form) {
    if (editingId != null) {
      setTokens((ts) => ts.map((t) => (t.id === editingId ? { ...t, ...form } : t)));
    } else {
      const id = Math.max(0, ...tokens.map((t) => t.id)) + 1;
      setTokens((ts) => [...ts, { id, ...form }]);
    }
    setModal(null);
    setEditingId(null);
  }

  function handleDelete(id) {
    setTokens((ts) => ts.filter((t) => t.id !== id));
  }

  function handleToggle(id) {
    setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, status: !t.status } : t)));
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="令牌管理" subtitle="API Token 与额度" />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }}
          onClick={() => { setEditingId(null); setModal({}); }}>
          + 添加令牌
        </button>
        <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setJsonOpen(true)}>
          编辑 JSON
        </button>
      </div>

      <div className="settings-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {['名称', 'Token', '额度', '状态', '操作'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, fontSize: 13 }}>{t.name}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted-foreground)' }}>{t.key}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{t.quota ? `¥ ${t.quota}` : '不限制'}</td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  <button
                    className={`settings-toggle ${t.status ? 'on' : ''}`}
                    role="switch"
                    aria-checked={t.status}
                    aria-label={t.status ? '点击禁用' : '点击启用'}
                    onClick={() => handleToggle(t.id)}
                  />
                </td>
                <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                  <button className="settings-btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => { setEditingId(t.id); setModal(t); }}>编辑</button>
                  <button className="settings-btn danger" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => handleDelete(t.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editingId != null ? '编辑令牌' : '添加令牌'} onClose={() => { setModal(null); setEditingId(null); }}>
          <TokenForm initial={editingId != null ? modal : null} onSave={handleSave} onCancel={() => { setModal(null); setEditingId(null); }} />
        </Modal>
      )}
      {jsonOpen && (
        <JsonEditModal data={tokens} onSave={(data) => { setTokens(data); setJsonOpen(false); }} onClose={() => setJsonOpen(false)} />
      )}
    </div>
  );
}
