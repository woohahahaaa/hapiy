import PageHeader from './PageHeader';

const PAGES = {
  req_rewrite: {
    title: '请求改写',
    subtitle: 'Request transformer',
    icon: 'edit_note',
    desc: '改写请求头或请求体（JSON 操作），每条规则 = 操作 + 目标字段 + 值',
  },
  heartbeat: {
    title: '心跳回复',
    subtitle: 'Keep-alive injector',
    icon: 'monitor_heart',
    desc: '上游持续超时无输出时，自动插入自定义消息（如 "连接正常，上游正在吐字但太慢"）',
  },
  concurrency: {
    title: '并发控制',
    subtitle: 'Rate & queue limiter',
    icon: 'speed',
    desc: '并发频率（每 N 分钟 M 次）、超时处理（掐断或排队）',
  },
  failover: {
    title: '故障转移',
    subtitle: 'Health check & failover',
    icon: 'swap_horiz',
    desc: '全局健康检查：429 → 跳过 / 调货，500 → 自动封禁；定时恢复或自检后恢复',
  },
};

export default function PolicyPage({ sub }) {
  const page = sub && PAGES[sub] ? PAGES[sub] : PAGES.req_rewrite;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader icon={page.icon} title={page.title} subtitle={page.subtitle} />
      </div>
      <div className="page-placeholder">
        <span className="material-symbols-outlined page-placeholder-icon">{page.icon}</span>
        <p className="page-placeholder-text">{page.desc}</p>
      </div>
    </div>
  );
}
