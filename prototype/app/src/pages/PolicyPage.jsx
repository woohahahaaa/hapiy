import { useState } from 'react';
import PageHeader from './PageHeader';
import { useRules } from '../store/RuleStore';
import JsonEditModal from '../components/JsonEditModal';
import './settings.css';

/* ── Modal ── */
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

/* ── 心跳回复 ── */
const HEARTBEAT_SCRIPT = `// ==UserScript==
// @name         hapiy 心跳零宽字符替换
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  将零宽字符实时替换为可见心跳文本
// @author       hapiy
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    // ===== 用户可在此修改 =====
    const MARKER = '\\u200B';          // 零宽字符 — 与后台「流中心跳」字段保持一致
    const REPLACEMENT = '⏳ 正在生成中……'; // 替换为的可见文字
    // =========================

    function replaceText(node) {
        if (node.nodeValue && node.nodeValue.includes(MARKER))
            node.nodeValue = node.nodeValue.replaceAll(MARKER, REPLACEMENT);
    }

    // 方案 A：劫持 fetch 响应流（SSE）
    const orig = window.fetch;
    window.fetch = async (...a) => {
        const r = await orig(...a);
        if (!r.body || !/text\\/event-stream/.test(r.headers.get('content-type')||'')) return r;
        const rd = r.body.getReader(), td = new TextDecoder(), te = new TextEncoder();
        let b = '';
        return new Response(new ReadableStream({async pull(c){const{done,v}=await rd.read();if(done){c.close();return}b+=td.decode(v,{stream:true});b=b.replaceAll(MARKER,REPLACEMENT);c.enqueue(te.encode(b));b=''}}),r);
    };

    // 方案 B：MutationObserver 兜底（已有 DOM 文本）
    const obs = new MutationObserver(muts => {for(const m of muts)for(const n of m.addedNodes){const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let x;while(x=w.nextNode())replaceText(x)}});
    obs.observe(document.body,{childList:true,subtree:true});
})();`;

function HeartbeatForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [scope, setScope] = useState(initial?.scope || 'all');
  const [window_, setWindow_] = useState(initial?.window ?? 60);
  const [minTokens, setMinTokens] = useState(initial?.minTokens ?? 3);
  const [interval_, setInterval_] = useState(initial?.interval ?? 15);
  const [firstTokenTimeout, setFirstTokenTimeout] = useState(initial?.firstTokenTimeout ?? 0);
  const [onDisconnect, setOnDisconnect] = useState(initial?.onDisconnect !== false);
  const [streamMarker, setStreamMarker] = useState(initial?.streamMarker || '\u200B');
  const [disconnectMessage, setDisconnectMessage] = useState(initial?.disconnectMessage || '请求断开');
  const [status, setStatus] = useState(initial?.status !== false);
  const [showScript, setShowScript] = useState(false);

  function save() {
    onSave({
      name: name.trim() || 'New Rule',
      scope,
      window: Number(window_) || 60,
      minTokens: Number(minTokens) || 0,
      interval: Number(interval_) || 15,
      firstTokenTimeout: Number(firstTokenTimeout) || 0,
      onDisconnect,
      streamMarker: streamMarker || '\u200B',
      disconnectMessage: disconnectMessage.trim() || '请求断开',
      status,
    });
  }

  const sectionStyle = { fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 8, borderTop: '1px solid var(--border)', marginTop: 4 };

  return (
    <div className="settings-card-body" style={{ gap: 12 }}>
      {/* 基本信息 */}
      <div className="settings-switch-row">
        <div className="settings-switch-label">启用</div>
        <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">规则名称</label>
        <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">作用范围</label>
        <select className="settings-field-input" style={{ cursor: 'pointer' }} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">全部渠道 · 全部模型</option>
          <option value="per_channel">按渠道指定</option>
          <option value="per_model">按模型指定</option>
        </select>
      </div>

      {/* 触发条件 */}
      <div style={sectionStyle}>触发条件</div>
      <div className="settings-field">
        <label className="settings-field-label">监测窗口（秒）</label>
        <input className="settings-field-input" type="number" value={window_} onChange={(e) => setWindow_(e.target.value)} />
        <span className="settings-field-hint">多长时间统计一次吐字速度</span>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">最低 Token 数</label>
        <input className="settings-field-input" type="number" value={minTokens} onChange={(e) => setMinTokens(e.target.value)} />
        <span className="settings-field-hint">窗口内新 Token 低于此值 → 触发心跳</span>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">心跳间隔（秒）</label>
        <input className="settings-field-input" type="number" value={interval_} onChange={(e) => setInterval_(e.target.value)} />
        <span className="settings-field-hint">触发后每隔多久发一次心跳，避免过密</span>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">首 Token 超时（秒）</label>
        <input className="settings-field-input" type="number" value={firstTokenTimeout} onChange={(e) => setFirstTokenTimeout(e.target.value)} placeholder="留空 = 不启用" />
        <span className="settings-field-hint">请求发出后首个 Token 还没出来就触发，0 表示不启用</span>
      </div>
      <div className="settings-switch-row">
        <div>
          <div className="settings-switch-label">断连时触发</div>
          <div className="settings-switch-desc">上游直接断开也发一次心跳</div>
        </div>
        <button className={`settings-toggle ${onDisconnect ? 'on' : ''}`} role="switch" aria-checked={onDisconnect} onClick={() => setOnDisconnect((v) => !v)} />
      </div>

      {/* 心跳内容 */}
      <div style={sectionStyle}>心跳内容</div>
      <div className="settings-field">
        <label className="settings-field-label">流中心跳</label>
        <input className="settings-field-input" value={streamMarker} onChange={(e) => setStreamMarker(e.target.value)} placeholder="\u200B" />
        <span className="settings-field-hint">真正下发的字符，预设零宽空格（不影响模型思考）</span>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">断连心跳</label>
        <input className="settings-field-input" value={disconnectMessage} onChange={(e) => setDisconnectMessage(e.target.value)} placeholder="请求断开" />
        <span className="settings-field-hint">断连时直接下发的文本</span>
      </div>

      {/* 辅助前端脚本 */}
      <div style={{ ...sectionStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setShowScript((v) => !v)}>
        <span>前端替换脚本（篡改猴）</span>
        <span style={{ fontSize: 14, fontWeight: 400, transition: 'transform 0.2s', transform: showScript ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
      </div>
      {showScript && (
        <pre style={{
          margin: 0, padding: 12, borderRadius: 8,
          background: 'var(--muted)', border: '1px solid var(--border)',
          fontSize: 11, fontFamily: '"JetBrains Mono", "Fira Code", var(--font-mono), monospace',
          lineHeight: 1.5, color: 'var(--foreground)', overflowX: 'auto',
          whiteSpace: 'pre', tabSize: 2,
        }}>
          {HEARTBEAT_SCRIPT}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

/* ── 故障转移 ── */
function FailoverForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [primary, setPrimary] = useState(initial?.primary || '');
  const [fallback, setFallback] = useState(initial?.fallback || '');
  const [condition, setCondition] = useState(initial?.condition || 'timeout');
  const [status, setStatus] = useState(initial?.status !== false);

  function save() {
    onSave({ name: name.trim() || 'New Rule', primary: primary.trim(), fallback: fallback.trim(), condition, status });
  }

  return (
    <div className="settings-card-body" style={{ gap: 14 }}>
      <div className="settings-switch-row">
        <div className="settings-switch-label">启用</div>
        <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">名称</label>
        <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">主渠道</label>
        <input className="settings-field-input" value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="渠道名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">备选渠道</label>
        <input className="settings-field-input" value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="渠道名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">触发条件</label>
        <select className="settings-field-input" style={{ cursor: 'pointer' }} value={condition} onChange={(e) => setCondition(e.target.value)}>
          <option value="timeout">超时</option>
          <option value="error">错误</option>
          <option value="rate_limit">限流</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

/* ── 并发控制 ── */
function ConcurrencyForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [scope, setScope] = useState(initial?.scope || 'global');
  const [maxConcurrent, setMaxConcurrent] = useState(initial?.maxConcurrent ?? 100);
  const [queueEnabled, setQueueEnabled] = useState(initial?.queueEnabled !== false);
  const [status, setStatus] = useState(initial?.status !== false);

  function save() {
    onSave({ name: name.trim() || 'New Rule', scope, maxConcurrent: Number(maxConcurrent) || 100, queueEnabled, status });
  }

  return (
    <div className="settings-card-body" style={{ gap: 14 }}>
      <div className="settings-switch-row">
        <div className="settings-switch-label">启用</div>
        <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">名称</label>
        <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">作用域</label>
        <select className="settings-field-input" style={{ cursor: 'pointer' }} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="global">全局</option>
          <option value="per_user">每用户</option>
          <option value="per_token">每令牌</option>
        </select>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">最大并发数</label>
        <input className="settings-field-input" type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
      </div>
      <div className="settings-switch-row">
        <div>
          <div className="settings-switch-label">超额排队</div>
          <div className="settings-switch-desc">否则直接拒绝请求</div>
        </div>
        <button className={`settings-toggle ${queueEnabled ? 'on' : ''}`} role="switch" aria-checked={queueEnabled} onClick={() => setQueueEnabled((v) => !v)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="settings-btn" onClick={onCancel}>取消</button>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
      </div>
    </div>
  );
}

/* ── 请求改写 DSL 编辑器 ── */
const DSL_HELP = `# 请求改写语言 (Request Rewrite Language)

# -- 基础操作 --
SET field = value          # 设置字段值
DELETE field               # 删除字段

# -- 条件匹配 --
IF field == "val" THEN SET target = "new"
IF field ~ "wild*" THEN { ... }

# -- 字段语法 --
header.X-Custom           # Header 字段
nested.key.sub            # 嵌套字段
array[0].field            # 数组元素

# -- 内置变量 --
{{request_id}}            # 请求 ID
{{timestamp}}             # 当前时间戳`;

function RewriteForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [script, setScript] = useState(initial?.script || '');
  const [status, setStatus] = useState(initial?.status !== false);
  const [showHelp, setShowHelp] = useState(false);

  function save() {
    onSave({ name: name.trim() || 'New Rule', script: script.trim(), status });
  }

  return (
    <div style={{ display: 'flex', gap: 16, maxHeight: '70vh' }}>
      {/* 左侧：编辑器 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="settings-switch-row" style={{ marginBottom: 0 }}>
          <div className="settings-switch-label">启用</div>
          <button className={`settings-toggle ${status ? 'on' : ''}`} role="switch" aria-checked={status} onClick={() => setStatus((v) => !v)} />
        </div>
        <div className="settings-field">
          <label className="settings-field-label">名称</label>
          <input className="settings-field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名称" />
        </div>
        <div className="settings-field" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="settings-field-label" style={{ marginBottom: 0 }}>脚本</label>
            <button className="settings-btn" style={{ fontSize: 10, height: 24, padding: '0 8px' }} onClick={() => setShowHelp((v) => !v)}>
              {showHelp ? '隐藏' : '语法参考'}
            </button>
          </div>
          <textarea
            style={{
              flex: 1, minHeight: 280,
              background: 'var(--muted)', color: 'var(--foreground)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: 12, fontSize: 12, fontFamily: '"JetBrains Mono", "Fira Code", var(--font-mono), monospace',
              lineHeight: 1.6, tabSize: 2, outline: 'none', resize: 'none',
            }}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={`# 请求改写规则
SET model = "gpt-4o"\n...`}
            spellCheck={false}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="settings-btn" onClick={onCancel}>取消</button>
          <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }} onClick={save}>保存</button>
        </div>
      </div>

      {/* 右侧：语法参考 */}
      <div style={{
        width: showHelp ? 260 : 0, overflow: 'hidden', transition: 'width 0.2s',
        borderLeft: showHelp ? '1px solid var(--border)' : 'none',
        paddingLeft: showHelp ? 16 : 0,
      }}>
        {showHelp && (
          <pre style={{
            margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--muted-foreground)', whiteSpace: 'pre-wrap',
            lineHeight: 1.7, background: 'transparent',
          }}>
            {DSL_HELP}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── 规则列表列定义 ── */
const RULE_CFG = {
  heartbeat: {
    title: '心跳回复', subtitle: 'Heartbeat injector',
    columns: ['名称', '范围', '窗口', '最低Token', '间隔', '断连', '状态', '操作'],
    renderRow: (r) => [r.name, r.scope === 'per_channel' ? '按渠道' : r.scope === 'per_model' ? '按模型' : '全部', `${r.window}s`, r.minTokens, `${r.interval}s`, r.onDisconnect ? '是' : '否'],
    Form: HeartbeatForm,
  },
  failover: {
    title: '故障转移', subtitle: 'Health check & failover',
    columns: ['名称', '主渠道', '备选', '触发条件', '状态', '操作'],
    renderRow: (r) => [r.name, r.primary, r.fallback, r.condition === 'rate_limit' ? '限流' : r.condition === 'error' ? '错误' : '超时'],
    Form: FailoverForm,
  },
  concurrency: {
    title: '并发控制', subtitle: 'Rate & queue limiter',
    columns: ['名称', '作用域', '最大并发', '排队', '状态', '操作'],
    renderRow: (r) => [r.name, r.scope === 'per_user' ? '每用户' : r.scope === 'per_token' ? '每令牌' : '全局', r.maxConcurrent, r.queueEnabled ? '是' : '否'],
    Form: ConcurrencyForm,
  },
};

function scriptFirstLine(script) {
  if (!script) return '';
  const line = script.trim().split('\n').find(l => l.trim() && !l.trim().startsWith('#'));
  return line ? line.trim() : '';
}

export default function PolicyPage({ sub }) {
  const { rules, saveRule, deleteRule, toggleRule, importRules } = useRules();

  // ── 请求改写：完全自定义页面 ──
  if (sub === 'rewrite') return <RewritePage />;

  const type = sub && RULE_CFG[sub] ? sub : 'heartbeat';
  const cfg = RULE_CFG[type];
  const list = rules[type] || [];

  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  function handleSave(form) {
    saveRule(type, editingId != null ? { ...form, id: editingId } : form);
    setModal(null);
    setEditingId(null);
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title={cfg.title} subtitle={cfg.subtitle} />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }}
          onClick={() => { setEditingId(null); setModal({}); }}>
          + 添加规则
        </button>
        <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setJsonOpen(true)}>
          编辑 JSON
        </button>
      </div>

      <div className="settings-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {cfg.columns.map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const cells = cfg.renderRow(r);
              return (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                  {cells.map((v, i) => (
                    <td key={i} style={{ padding: '10px 14px', fontFamily: i === 0 ? undefined : 'var(--font-mono)', fontSize: i === 0 ? 13 : 11, fontWeight: i === 0 ? 500 : undefined }}>{v}</td>
                  ))}
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <button
                      className={`settings-toggle ${r.status ? 'on' : ''}`}
                      role="switch"
                      aria-checked={r.status}
                      aria-label={r.status ? '点击禁用' : '点击启用'}
                      onClick={() => toggleRule(type, r.id)}
                    />
                  </td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                    <button className="settings-btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                      onClick={() => { setEditingId(r.id); setModal(r); }}>编辑</button>
                    <button className="settings-btn danger" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                      onClick={() => deleteRule(type, r.id)}>删除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editingId != null ? '编辑规则' : '添加规则'} onClose={() => { setModal(null); setEditingId(null); }}>
          <cfg.Form initial={editingId != null ? modal : null} onSave={handleSave} onCancel={() => { setModal(null); setEditingId(null); }} />
        </Modal>
      )}
      {jsonOpen && (
        <JsonEditModal data={list} onSave={(data) => { const r = { ...rules, [type]: data }; importRules(r); setJsonOpen(false); }} onClose={() => setJsonOpen(false)} />
      )}
    </div>
  );
}

/* ── 请求改写独立页面 ── */
function RewritePage() {
  const { rules, saveRule, deleteRule, toggleRule, importRules } = useRules();
  const list = rules.rewrite || [];

  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  function handleSave(form) {
    saveRule('rewrite', editingId != null ? { ...form, id: editingId } : form);
    setModal(null);
    setEditingId(null);
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="请求改写" subtitle="Request transformer" />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="settings-btn" style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderColor: 'var(--sidebar-primary)' }}
          onClick={() => { setEditingId(null); setModal({}); }}>
          + 添加规则
        </button>
        <button className="settings-btn" style={{ marginLeft: 'auto' }} onClick={() => setJsonOpen(true)}>
          编辑 JSON
        </button>
      </div>

      <div className="settings-card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {['名称', '脚本', '状态', '操作'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)', opacity: r.status ? 1 : 0.45 }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, fontSize: 13 }}>{r.name}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted-foreground)' }}>
                    {scriptFirstLine(r.script) || '(空)'}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  <button
                    className={`settings-toggle ${r.status ? 'on' : ''}`}
                    role="switch" aria-checked={r.status}
                    onClick={() => toggleRule('rewrite', r.id)}
                  />
                </td>
                <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                  <button className="settings-btn" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => { setEditingId(r.id); setModal(r); }}>编辑</button>
                  <button className="settings-btn danger" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                    onClick={() => deleteRule('rewrite', r.id)}>删除</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
                  暂无请求改写规则，点击"添加规则"创建第一条
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={editingId != null ? '编辑规则' : '添加规则'} onClose={() => { setModal(null); setEditingId(null); }}>
          <RewriteForm initial={editingId != null ? modal : null} onSave={handleSave} onCancel={() => { setModal(null); setEditingId(null); }} />
        </Modal>
      )}
      {jsonOpen && (
        <JsonEditModal data={list} onSave={(data) => { importRules({ ...rules, rewrite: data }); setJsonOpen(false); }} onClose={() => setJsonOpen(false)} />
      )}
    </div>
  );
}