import { useState } from 'react';
import PageHeader from './PageHeader';
import './settings.css';

const STATUS_COLORS = {
  '连通中': 'var(--chart-4)',
  '发数据中': 'var(--chart-2)',
  '收数据中': 'var(--chart-1)',
  '排队中': 'var(--chart-5)',
  '已断开': 'var(--muted-foreground)',
};

const STATUS_ORDER = ['连通中', '发数据中', '收数据中', '排队中', '已断开'];

const SESSION_FIELDS = [
  { key: 'user', label: '按用户' },
  { key: 'ip', label: '按 IP' },
  { key: 'token', label: '按 Token' },
  { key: 'model', label: '按模型' },
];

const MOCK_REQUESTS = [
  { id: 1, session: 'sess-001', user: 'admin', ip: '10.0.0.1', token: 'sk-prod-xxx', model: 'gpt-4o', status: '发数据中', elapsed: '12s', tokens: '3,210' },
  { id: 2, session: 'sess-001', user: 'admin', ip: '10.0.0.1', token: 'sk-prod-xxx', model: 'gpt-4o', status: '收数据中', elapsed: '45s', tokens: '8,450' },
  { id: 3, session: 'sess-002', user: 'dev-01', ip: '10.0.0.2', token: 'sk-test-xxx', model: 'claude-sonnet', status: '连通中', elapsed: '3s', tokens: '0' },
  { id: 4, session: 'sess-002', user: 'dev-01', ip: '10.0.0.2', token: 'sk-test-xxx', model: 'claude-sonnet', status: '排队中', elapsed: '1s', tokens: '0' },
  { id: 5, session: 'sess-003', user: 'admin', ip: '10.0.0.3', token: 'sk-prod-xxx', model: 'gpt-4o', status: '收数据中', elapsed: '28s', tokens: '1,890' },
  { id: 6, session: 'sess-004', user: 'guest', ip: '10.0.0.4', token: 'sk-dev-xxx', model: 'doubao-pro', status: '发数据中', elapsed: '6s', tokens: '520' },
  { id: 7, session: 'sess-005', user: 'dev-01', ip: '10.0.0.2', token: 'sk-test-xxx', model: 'doubao-lite', status: '已断开', elapsed: '30s', tokens: '1,200' },
];

function SettingsModal({ onClose, onSelect }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ width: 300 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">选择分组方式</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SESSION_FIELDS.map((f) => (
            <button
              key={f.key}
              className="settings-btn"
              style={{ justifyContent: 'flex-start', fontSize: 12, padding: '8px 12px' }}
              onClick={() => { onSelect(f.key); onClose(); }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MonitorPage({ sub }) {
  if (sub === 'usage_log') {
    return <UsageLogPage />;
  }

  return <ActivityPage />;
}

function ActivityPage() {
  const [sessionField, setSessionField] = useState('user');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const grouped = {};
  for (const req of MOCK_REQUESTS) {
    const key = req[sessionField];
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(req);
  }

  const keys = Object.keys(grouped).sort((a, b) =>
    grouped[b].length - grouped[a].length
  );

  const fieldLabel = SESSION_FIELDS.find((f) => f.key === sessionField)?.label || '';

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <PageHeader title="活动监视" subtitle={`分组方式：${fieldLabel}`} />
        <button
          className="settings-btn"
          style={{ marginTop: 4, fontSize: 11, height: 30 }}
          onClick={() => setSettingsOpen(true)}
        >
          ⚙ 设置
        </button>
      </div>

      {keys.map((key) => {
        const reqs = grouped[key];
        const totalTokens = reqs.reduce((sum, r) => sum + parseInt(r.tokens.replace(/,/g, '')) || 0, 0);

        return (
          <div key={key} className="settings-card" style={{ marginBottom: 16 }}>
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--foreground)' }}>
                {key}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {reqs.length} 个请求 · {totalTokens.toLocaleString()} tokens
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--background)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
                  {['状态', 'IP', 'Token', '模型', '耗时', 'Token 数'].map((h) => (
                    <th key={h} style={{ padding: '8px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                    <td style={{ padding: '8px 14px' }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: STATUS_COLORS[r.status] || 'var(--muted-foreground)',
                        marginRight: 6, verticalAlign: 'middle',
                      }} />
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.ip}</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted-foreground)' }}>{r.token}</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.model}</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.elapsed}</td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onSelect={setSessionField} />
      )}
    </div>
  );
}

function UsageLogPage() {
  const logs = [
    { time: '2026-07-27 13:24:01', username: 'admin', tokenName: '生产环境', channelName: 'Open Code Go', model: 'gpt-4o', promptTokens: '850', completionTokens: '395', quota: '12.50', useTime: '1.2s', isStream: true, status: '成功' },
    { time: '2026-07-27 13:23:45', username: 'dev-01', tokenName: '测试环境', channelName: '字节跳动', model: 'doubao-pro', promptTokens: '120', completionTokens: '222', quota: '0.80', useTime: '0.6s', isStream: false, status: '成功' },
    { time: '2026-07-27 13:22:10', username: 'admin', tokenName: '生产环境', channelName: 'Open Code Go', model: 'claude-sonnet', promptTokens: '1,500', completionTokens: '1,390', quota: '28.00', useTime: '3.1s', isStream: true, status: '成功' },
    { time: '2026-07-27 13:21:33', username: 'guest', tokenName: '开发环境', channelName: '阿里百炼', model: 'qwen-max', promptTokens: '320', completionTokens: '0', quota: '0', useTime: '8.0s', isStream: false, status: '失败' },
    { time: '2026-07-27 13:20:55', username: 'admin', tokenName: '生产环境', channelName: '智谱 AI', model: 'glm-4', promptTokens: '400', completionTokens: '490', quota: '3.20', useTime: '2.4s', isStream: true, status: '成功' },
  ];

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="使用日志" subtitle="请求历史记录" />
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', textAlign: 'left' }}>
              {['时间', '用户', '令牌', '渠道', '模型', 'Tokens', '流式', '消耗', '耗时', '状态'].map(h => (
                <th key={h} style={{ padding: '8px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{log.time}</td>
                <td style={{ padding: '8px 10px', fontSize: 11 }}>{log.username}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted-foreground)' }}>{log.tokenName}</td>
                <td style={{ padding: '8px 10px', fontSize: 11 }}>{log.channelName}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.model}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {log.promptTokens} / {log.completionTokens}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ color: log.isStream ? 'var(--chart-1)' : 'var(--muted-foreground)', fontSize: 11, fontWeight: 500 }}>
                    {log.isStream ? 'SSE' : '-'}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>¥ {log.quota}</td>
                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.useTime}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ color: log.status === '成功' ? 'var(--chart-1)' : 'var(--destructive)', fontWeight: 500, fontSize: 11 }}>
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
