import PageHeader from './PageHeader';
import './settings.css';

export default function MonitorPage({ sub }) {
  if (sub === 'usage_log') {
    return <UsageLogPage />;
  }

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="活动监视" subtitle="实时请求状态监控" />
      </div>
      <div className="settings-card">
        <div className="settings-card-body" style={{ alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--muted-foreground)', opacity: 0.4 }}>visibility</span>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 14, maxWidth: 340, lineHeight: 1.5, marginTop: 12 }}>
            当前活跃的 API 请求：连通中 / 发数据中 / 收数据中 / 排队中 / 已断开
          </p>
          <p style={{ color: 'var(--muted-foreground)', fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            已完成或失败的请求保留 1 分钟后移入使用日志。活动中的请求不进入使用日志。
          </p>
        </div>
      </div>
    </div>
  );
}

function UsageLogPage() {
  const logs = [
    { time: '13:24:01', model: 'gpt-4o', tokens: 1245, status: '成功', latency: '1.2s' },
    { time: '13:23:45', model: 'gpt-4o-mini', tokens: 342, status: '成功', latency: '0.6s' },
    { time: '13:22:10', model: 'claude-sonnet', tokens: 2890, status: '成功', latency: '3.1s' },
    { time: '13:21:33', model: 'gpt-4o', tokens: 567, status: '失败', latency: '8.0s' },
    { time: '13:20:55', model: 'deepseek-chat', tokens: 890, status: '成功', latency: '2.4s' },
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
              {['时间', '模型', 'Token', '状态', '延迟'].map(h => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground)' }}>
                <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.time}</td>
                <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.model}</td>
                <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{log.tokens}</td>
                <td style={{ padding: '9px 14px' }}>
                  <span style={{
                    color: log.status === '成功' ? 'var(--chart-1)' : 'var(--destructive)',
                    fontWeight: 500,
                    fontSize: 11,
                  }}>
                    {log.status}
                  </span>
                </td>
                <td style={{ padding: '9px 14px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.latency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
