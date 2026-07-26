import { useState } from 'react';
import PageHeader from './PageHeader';
import { usePrices } from '../store/PriceStore';
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

function PriceForm({ initial, onSave, onCancel }) {
  const [model, setModel] = useState(initial?.model || '');
  const [input, setInput] = useState(initial?.input || '');
  const [output, setOutput] = useState(initial?.output || '');
  const [cacheWrite, setCacheWrite] = useState(initial?.cacheWrite || '');
  const [cacheRead, setCacheRead] = useState(initial?.cacheRead || '');

  function save() {
    onSave({
      model: model.trim() || 'New Model',
      input: input.trim() || '0',
      output: output.trim() || '0',
      cacheWrite: cacheWrite.trim() || '0',
      cacheRead: cacheRead.trim() || '0',
    });
  }

  return (
    <div className="settings-card-body" style={{ gap: 14 }}>
      <div className="settings-field">
        <label className="settings-field-label">模型名称</label>
        <input className="settings-field-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">输入价格 (¥/1M tokens)</label>
        <input className="settings-field-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0.0025" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">输出价格 (¥/1M tokens)</label>
        <input className="settings-field-input" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="0.0100" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">缓存写入 (¥/1M tokens)</label>
        <input className="settings-field-input" value={cacheWrite} onChange={(e) => setCacheWrite(e.target.value)} placeholder="0.00375" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">缓存读取 (¥/1M tokens)</label>
        <input className="settings-field-input" value={cacheRead} onChange={(e) => setCacheRead(e.target.value)} placeholder="0.00075" />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

export default function PricePage() {
  const { prices, savePrice, deletePrice, importPrices } = usePrices();
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  function handleSave(form) {
    savePrice(editingId != null ? { ...form, id: editingId } : form);
    setModal(null);
    setEditingId(null);
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="价格配置" subtitle="¥ / 1M tokens" />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }}
          onClick={() => { setEditingId(null); setModal({}); }}>
          + 添加模型
        </button>
        <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setJsonOpen(true)}>
          编辑 JSON
        </button>
      </div>

      <div className="settings-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {['模型', '输入', '输出', '缓存写', '缓存读', '操作'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, fontSize: 13 }}>{p.model}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>¥ {p.input}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>¥ {p.output}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>¥ {p.cacheWrite}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>¥ {p.cacheRead}</td>
                <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                  <button className="settings-btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => { setEditingId(p.id); setModal(p); }}>编辑</button>
                  <button className="settings-btn danger" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => deletePrice(p.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editingId != null ? '编辑价格' : '添加模型'} onClose={() => { setModal(null); setEditingId(null); }}>
          <PriceForm initial={editingId != null ? modal : null} onSave={handleSave} onCancel={() => { setModal(null); setEditingId(null); }} />
        </Modal>
      )}
      {jsonOpen && (
        <JsonEditModal data={prices} onSave={importPrices} onClose={() => setJsonOpen(false)} />
      )}
    </div>
  );
}
