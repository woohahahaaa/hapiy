import PageHeader from './PageHeader';

export default function TokenPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader icon="key" title="令牌管理" subtitle="API Token 与额度" />
      </div>
      <div className="page-placeholder">
        <span className="material-symbols-outlined page-placeholder-icon">key</span>
        <p className="page-placeholder-text">下游 API Token：名称、额度限制、过期时间</p>
      </div>
    </div>
  );
}
