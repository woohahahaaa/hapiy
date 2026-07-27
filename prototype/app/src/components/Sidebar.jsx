import { useState } from 'react';
import './Sidebar.css';

/* ── Google Material Symbols ── */
const ICONS = {
  topology: 'hub',          // 转发拓扑
  monitor: 'monitoring',    // 监控
  provider: 'cloud',        // 供应商
  token: 'key',             // 令牌管理
  policy: 'tune',           // 策略配置
  price: 'monetization_on', // 价格配置
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
    label: '渠道',
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
    id: 'price',
    label: '价格配置',
    icon: ICONS.price,
    children: null,
  },
  {
    id: 'policy',
    label: '策略配置',
    icon: ICONS.policy,
    children: [
      { id: 'rewrite', label: '请求改写' },
      { id: 'heartbeat', label: '心跳回复' },
      { id: 'concurrency', label: '并发控制' },
      { id: 'failover', label: '故障转移' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: ICONS.settings,
    children: null,
  },
];

export default function Sidebar({ expanded, onToggle, activeSection, activeSub, onNavigate }) {
  const [openMenus, setOpenMenus] = useState(new Set());

  function toggleMenu(id) {
    setOpenMenus((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleItemClick(item) {
    if (item.children) {
      toggleMenu(item.id);
    }
    onNavigate(item.id, null);
  }

  function handleSubItemClick(parentId, subId) {
    setOpenMenus((prev) => new Set(prev).add(parentId));
    onNavigate(parentId, subId);
  }

  function isActive(id) {
    if (activeSub) return id === activeSub;
    return id === activeSection && !activeSub;
  }

  function isSectionActive(id) {
    return id === activeSection;
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
            const hasChildren = item.children && item.children.length > 0;

            return (
              <div key={item.id}>
                <button
                  type="button"
                  className={`sidebar-item ${isSectionActive(item.id) ? 'active' : ''}`}
                  onClick={() => handleItemClick(item)}
                  title={!expanded ? item.label : undefined}
                  aria-label={item.label}
                  aria-current={isSectionActive(item.id) ? 'page' : undefined}
                  aria-expanded={hasChildren ? openMenus.has(item.id) && expanded : undefined}
                >
                  <span className="material-symbols-outlined sidebar-item-icon" aria-hidden="true">{item.icon}</span>
                  <span className="sidebar-item-label">{item.label}</span>
                  {hasChildren && (
                    <span
                      className={`material-symbols-outlined sidebar-item-arrow ${openMenus.has(item.id) ? 'open' : ''}`}
                      aria-hidden="true"
                    >
                      chevron_right
                    </span>
                  )}
                </button>

                {hasChildren && openMenus.has(item.id) && expanded && (
                  <div className="sidebar-submenu">
                    {item.children.map((sub) => (
                      <button
                        type="button"
                        key={sub.id}
                        className={`sidebar-subitem ${isActive(sub.id) ? 'active' : ''}`}
                        onClick={() => handleSubItemClick(item.id, sub.id)}
                        aria-label={sub.label}
                        aria-current={isActive(sub.id) ? 'page' : undefined}
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

        <div className="sidebar-user" onClick={() => onNavigate('profile')}>
          <div className="sidebar-user-avatar">A</div>
          {expanded && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">Admin</div>
              <div className="sidebar-user-role">管理员</div>
            </div>
          )}
          {expanded && (
            <button
              className="sidebar-logout-btn"
              title="退出登录"
              aria-label="退出登录"
              onClick={(e) => { e.stopPropagation(); }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>logout</span>
            </button>
          )}
        </div>

      </nav>
  );
}
