import { useState } from 'react';
import './Sidebar.css';

/* ── Google Material Symbols ── */
const ICONS = {
  topology: 'hub',          // 转发拓扑
  monitor: 'monitoring',    // 监控
  provider: 'cloud',        // 供应商
  token: 'key',             // 令牌管理
  policy: 'tune',           // 策略配置
  settings: 'settings',     // 系统设置
};

const MENU = [
  {
    id: 'topology',
    label: '转发拓扑',
    icon: ICONS.topology,
    children: null,
  },
  {
    id: 'monitor',
    label: '监控',
    icon: ICONS.monitor,
    children: [
      { id: 'activity', label: '活动监视' },
      { id: 'usage_log', label: '使用日志' },
    ],
  },
  {
    id: 'provider',
    label: '供应商',
    icon: ICONS.provider,
    children: null,
  },
  {
    id: 'token',
    label: '令牌管理',
    icon: ICONS.token,
    children: null,
  },
  {
    id: 'policy',
    label: '策略配置',
    icon: ICONS.policy,
    children: [
      { id: 'req_rewrite', label: '请求改写' },
      { id: 'heartbeat', label: '心跳回复' },
      { id: 'concurrency', label: '并发控制' },
      { id: 'failover', label: '故障转移' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: ICONS.settings,
    children: [
      { id: 'security', label: '安全' },
      { id: 'performance', label: '性能' },
    ],
  },
];

export default function Sidebar({ expanded, onToggle }) {
  const [openMenus, setOpenMenus] = useState(new Set());
  const [activeId, setActiveId] = useState('topology');

  function toggleMenu(id) {
    setOpenMenus((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleItemClick(item) {
    setActiveId(item.id);
    if (item.children) {
      toggleMenu(item.id);
    }
  }

  function handleSubItemClick(parentId, subId) {
    setActiveId(subId);
    // ensure parent stays open when sub-item is clicked
    setOpenMenus((prev) => new Set(prev).add(parentId));
  }

  return (
    <nav className={`sidebar ${expanded ? 'expanded' : 'collapsed'}`} aria-label="主导航">
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggle}
            title={expanded ? '折叠侧栏' : '展开侧栏'}
            aria-label={expanded ? '折叠侧栏' : '展开侧栏'}
          >
            <span className="material-symbols-outlined sidebar-toggle-icon" aria-hidden="true">
              {expanded ? 'menu_open' : 'menu'}
            </span>
          </button>
        </div>
        <div className="sidebar-menu">
          {MENU.map((item) => {
            const isOpen = openMenus.has(item.id);
            const isActive = activeId === item.id;
            const hasChildren = item.children && item.children.length > 0;

            return (
              <div key={item.id}>
                {/* ── Top-level item ── */}
                <button
                  type="button"
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleItemClick(item)}
                  title={!expanded ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  aria-expanded={hasChildren ? isOpen && expanded : undefined}
                >
                  <span className="material-symbols-outlined sidebar-item-icon" aria-hidden="true">{item.icon}</span>
                  <span className="sidebar-item-label">{item.label}</span>
                  {hasChildren && (
                    <span
                      className={`material-symbols-outlined sidebar-item-arrow ${isOpen ? 'open' : ''}`}
                      aria-hidden="true"
                    >
                      chevron_right
                    </span>
                  )}
                </button>

                {/* ── Sub-items ── */}
                {hasChildren && isOpen && expanded && (
                  <div className="sidebar-submenu">
                    {item.children.map((sub) => (
                      <button
                        type="button"
                        key={sub.id}
                        className={`sidebar-subitem ${activeId === sub.id ? 'active' : ''}`}
                        onClick={() => handleSubItemClick(item.id, sub.id)}
                        aria-label={sub.label}
                        aria-current={activeId === sub.id ? 'page' : undefined}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </nav>
  );
}
