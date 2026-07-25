import './pages.css';

export default function PageHeader({ icon, title, subtitle, status }) {
  return (
    <div className="page-header" aria-hidden="true">
      <span className="material-symbols-outlined page-header-icon">{icon}</span>
      <div className="page-header-text">
        <strong className="page-header-title">{title}</strong>
        <span className="page-header-subtitle">{subtitle}</span>
      </div>
      {status && <span className="page-header-status">{status}</span>}
    </div>
  );
}
