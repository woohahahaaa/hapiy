import PageHeader from './PageHeader';

export default function ProviderPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 5, top: 12, left: 12 }}>
        <PageHeader icon="cloud" title="供应商" subtitle="上游厂商管理" />
      </div>
      <div className="page-placeholder">
        <span className="material-symbols-outlined page-placeholder-icon">cloud</span>
        <p className="page-placeholder-text">
          上游厂商配置：名称、Base URL、Key（可多个）、支持模型、协议模式（名称 + 路径后缀）
        </p>
        <p className="page-placeholder-text" style={{ fontSize: 12, opacity: 0.6 }}>
          通道：实际转发单元，绑定供应商的某个 Key + 某个 Base URL，可配权重
        </p>
      </div>
    </div>
  );
}
