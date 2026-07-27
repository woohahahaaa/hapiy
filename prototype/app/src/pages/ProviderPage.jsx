import { useState } from 'react';
import PageHeader from './PageHeader';
import { useProviders } from '../store/ProviderStore';
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

function ProviderForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [status, setStatus] = useState(initial?.status !== false);
  const [baseUrls, setBaseUrls] = useState(initial?.baseUrls || ['']);
  const [keys, setKeys] = useState(initial?.keys || ['']);
  const [endpoints, setEndpoints] = useState(initial?.endpoints || ['']);
  const [models, setModels] = useState(initial?.models || [{ model: '', endpoints: [], discount: '' }]);

  function save() {
    onSave({
      name: name.trim() || 'New Provider',
      status,
      baseUrls: baseUrls.filter(Boolean),
      keys: keys.filter(Boolean),
      endpoints: endpoints.filter(Boolean),
      models: models.filter(m => m.model.trim()),
    });
  }

  return (
    <div className="settings-card-body" style={{ gap: 14 }}>
      <div className="settings-switch-row">
        <div className="settings-switch-label">启用</div>
        <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">名称</label>
        <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Provider 名称" />
      </div>
      <MultiField label="Base URL" items={baseUrls} setItems={setBaseUrls} placeholder="https://api.example.com" />
      <MultiField label="Key" items={keys} setItems={setKeys} placeholder="sk-xxxxxxxx" />
      <MultiField label="Endpoint" items={endpoints} setItems={setEndpoints} placeholder="/v1/chat/completions" />
      <ModelField label="支持的模型" models={models} setModels={setModels} endpoints={endpoints} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

function MultiField({ label, items, setItems, placeholder }) {
  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="settings-field-input" style={{ flex: 1, height: 34, fontSize: 12 }} value={v} onChange={(e) => { const n = [...items]; n[i] = e.target.value; setItems(n); }} placeholder={placeholder} />
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
          </div>
        ))}
        <button onClick={() => setItems([...items, ''])} className="settings-btn" style={{ justifyContent: 'center', borderStyle: 'dashed', fontSize: 12 }}>+ 添加</button>
      </div>
    </div>
  );
}

function ModelField({ label, models, setModels, endpoints }) {
  const [openPopIdx, setOpenPopIdx] = useState(null);
  const activeEndpoints = endpoints.filter(Boolean);

  function toggleEndpoint(mIdx, ep) {
    setModels(models.map((m, i) => {
      if (i !== mIdx) return m;
      const cur = m.endpoints || [];
      const next = cur.includes(ep) ? cur.filter(e => e !== ep) : [...cur, ep];
      return { ...m, endpoints: next };
    }));
  }

  function endpointLabel(m) {
    const eps = m.endpoints || [];
    if (eps.length === 0 || eps.length === activeEndpoints.length) return '不限';
    return eps.join(', ');
  }

  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {models.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="settings-field-input" style={{ flex: 1, minWidth: 120, height: 34, fontSize: 12 }} value={m.model} onChange={(e) => { const n = [...models]; n[i] = { ...n[i], model: e.target.value }; setModels(n); }} placeholder="model-id" />
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="settings-btn"
                style={{ height: 34, fontSize: 11, minWidth: 120, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}
                onClick={() => setOpenPopIdx(openPopIdx === i ? null : i)}
              >
                {endpointLabel(m)}
                <span style={{ marginLeft: 4, fontSize: 10 }}>{openPopIdx === i ? '▲' : '▼'}</span>
              </button>
              {openPopIdx === i && activeEndpoints.length > 0 && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpenPopIdx(null)} />
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 50,
                    background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 8,
                    minWidth: 220, padding: 4, marginTop: 4, boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                  }}>
                    <button
                      type="button"
                      onClick={() => {
                        setModels(models.map((mm, j) => j === i ? { ...mm, endpoints: [] } : mm));
                      }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                        border: 'none', background: (m.endpoints || []).length === 0 ? 'var(--muted)' : 'transparent',
                        color: 'var(--foreground)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                    >
                      <span style={{ color: (m.endpoints || []).length === 0 ? 'var(--chart-1)' : 'var(--muted-foreground)', marginRight: 4 }}>{(m.endpoints || []).length === 0 ? '✓' : '○'}</span>
                      不限
                    </button>
                    <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                    {activeEndpoints.map(ep => {
                      const selected = (m.endpoints || []).includes(ep);
                      return (
                        <button
                          key={ep}
                          type="button"
                          onClick={() => toggleEndpoint(i, ep)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                            border: 'none', background: selected ? 'var(--muted)' : 'transparent',
                            color: selected ? 'var(--foreground)' : 'var(--muted-foreground)',
                            borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        >
                          <span style={{ color: selected ? 'var(--chart-1)' : 'var(--muted-foreground)', marginRight: 4 }}>{selected ? '✓' : '○'}</span>
                          {ep}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <input
              className="settings-field-input"
              style={{ width: 72, height: 34, fontSize: 11, flexShrink: 0 }}
              value={m.discount || ''}
              onChange={(e) => { const n = [...models]; n[i] = { ...n[i], discount: e.target.value }; setModels(n); }}
              placeholder="折扣"
            />
            <button onClick={() => setModels(models.filter((_, j) => j !== i))} style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
          </div>
        ))}
        <button onClick={() => setModels([...models, { model: '', endpoints: [], discount: '' }])} className="settings-btn" style={{ justifyContent: 'center', borderStyle: 'dashed', fontSize: 12 }}>+ 添加</button>
      </div>
    </div>
  );
}

export default function ProviderPage() {
  const { providers, saveProvider, deleteProvider, toggleProvider, importProviders } = useProviders();
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  function handleSave(form) {
    saveProvider(editingId != null ? { ...form, id: editingId } : form);
    setModal(null);
    setEditingId(null);
  }

  function handleDelete(id) {
    deleteProvider(id);
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="渠道" subtitle="上游厂商配置" />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }}
          onClick={() => { setEditingId(null); setModal({}); }}>
          + 添加渠道
        </button>
        <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setJsonOpen(true)}>
          编辑 JSON
        </button>
      </div>

      <div className="settings-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {['名称', 'Base URLs', 'Keys', 'Endpoints', 'Models', '状态', '操作'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, fontSize: 13 }}>{p.name}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.baseUrls.length}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.keys.length}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{(p.endpoints || []).length}</td>
                <td style={{ padding: '10px 14px', fontSize: 11 }}>
                  {(p.models || []).map((m, i) => (
                    <span key={i} style={{ fontFamily: 'var(--font-mono)' }}>
                      {m.model}{m.discount ? <span style={{ color: 'var(--muted-foreground)', fontSize: 10 }}> ({m.discount})</span> : ''}
                      {i < p.models.length - 1 ? <span style={{ color: 'var(--border)' }}>, </span> : ''}
                    </span>
                  ))}
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  <button
                    className={`settings-toggle ${p.status ? 'on' : ''}`}
                    role="switch"
                    aria-checked={p.status}
                    aria-label={p.status ? '点击禁用' : '点击启用'}
                    onClick={() => toggleProvider(p.id)}
                  />
                </td>
                <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                  <button className="settings-btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => { setEditingId(p.id); setModal(p); }}>编辑</button>
                  <button className="settings-btn danger" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => handleDelete(p.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editingId != null ? '编辑渠道' : '添加渠道'} onClose={() => { setModal(null); setEditingId(null); }}>
          <ProviderForm initial={editingId != null ? modal : null} onSave={handleSave} onCancel={() => { setModal(null); setEditingId(null); }} />
        </Modal>
      )}
      {jsonOpen && (
        <JsonEditModal data={providers} onSave={importProviders} onClose={() => setJsonOpen(false)} />
      )}
    </div>
  );
}
