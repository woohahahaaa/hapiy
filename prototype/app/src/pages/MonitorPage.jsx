import PageHeader from './PageHeader';

const PAGES = {
  activity: {
    title: '活动监视',
    subtitle: '实时请求状态监控',
    icon: 'visibility',
    desc: '当前活跃的 API 请求：连通中 / 发数据中 / 收数据中 / 排队中 / 已断开',
    detail: '已完成或失败的请求保留 1 分钟后移入使用日志。活动中的请求不进入使用日志。',
  },
  usage_log: {
    title: '使用日志',
    subtitle: '请求历史记录',
    icon: 'receipt_long',
    desc: '已完成的请求历史记录。日志轮转：每 100 万行切新文件，异步写盘不阻塞。',
    detail: '批量更新：配额 / 计数累积到内存，每 5 秒合并写入数据库。',
  },
};

export default function MonitorPage({ sub }) {
  const page = sub && PAGES[sub] ? PAGES[sub] : PAGES.activity;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader icon={page.icon} title={page.title} subtitle={page.subtitle} />
      </div>
      <div className="page-placeholder">
        <span className="material-symbols-outlined page-placeholder-icon">{page.icon}</span>
        <p className="page-placeholder-text">{page.desc}</p>
        <p className="page-placeholder-text" style={{ fontSize: 12, opacity: 0.6 }}>
          {page.detail}
        </p>
      </div>
    </div>
  );
}
