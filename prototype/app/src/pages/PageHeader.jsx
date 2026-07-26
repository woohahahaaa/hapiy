import './pages.css';

export default function PageHeader({ title, subtitle, status }) {
  return (
    <div className="page-header" aria-hidden="true">
      <div className="page-header-text">
        <strong className="page-header-title">{title}</strong>
        <span className="page-header-subtitle">{subtitle}</span>
      </div>
      {status && <span className="page-header-status">{status}</span>}
    </div>
  );
}
