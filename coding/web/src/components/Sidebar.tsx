import { useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import {
  LayoutGrid,
  Activity,
  FileText,
  Server,
  Key,
  Tag,
  Settings,
  User,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  href?: string
  children?: NavSubItem[]
}

interface NavSubItem {
  id: string
  label: string
  href: string
}

const navigation: NavItem[] = [
  {
    id: 'topology',
    label: '转发拓扑',
    icon: <LayoutGrid className="h-4 w-4" />,
    href: '/',
  },
  {
    id: 'monitor',
    label: '监控',
    icon: <Activity className="h-4 w-4" />,
    children: [
      { id: 'activity', label: '活动监视', href: '/monitor' },
      { id: 'logs', label: '使用日志', href: '/logs' },
    ],
  },
  {
    id: 'provider',
    label: '供应商',
    icon: <Server className="h-4 w-4" />,
    href: '/provider',
  },
  {
    id: 'token',
    label: '令牌管理',
    icon: <Key className="h-4 w-4" />,
    href: '/token',
  },
  {
    id: 'price',
    label: '价格配置',
    icon: <Tag className="h-4 w-4" />,
    href: '/price',
  },
  {
    id: 'policy',
    label: '策略配置',
    icon: <FileText className="h-4 w-4" />,
    children: [
      { id: 'rewrite', label: '请求改写', href: '/policy/rewrite' },
      { id: 'heartbeat', label: '心跳回复', href: '/policy/heartbeat' },
      { id: 'concurrency', label: '并发控制', href: '/policy/concurrency' },
      { id: 'failover', label: '故障转移', href: '/policy/failover' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: <Settings className="h-4 w-4" />,
    href: '/settings',
  },
  {
    id: 'profile',
    label: '个人资料',
    icon: <User className="h-4 w-4" />,
    href: '/profile',
  },
]

interface SidebarProps {
  expanded: boolean
  onToggle: () => void
}

export function Sidebar({ expanded, onToggle }: SidebarProps) {
  const location = useLocation()
  const [expandedSections, setExpandedSections] = useState<string[]>(['monitor', 'policy'])

  const isActive = (href: string) => {
    if (href === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(href)
  }

  const toggleSection = (id: string) => {
    setExpandedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  return (
    <>
      {/* Mobile overlay */}
      {!expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col border-r bg-white transition-all duration-300',
          expanded ? 'w-64' : 'w-0 lg:w-16'
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b px-3">
          {expanded && (
            <span className="font-hapiy-logo text-2xl leading-none text-sidebar-foreground">
              Hapiy
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          >
            {expanded ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-2">
            {navigation.map((item) => {
              const hasChildren = item.children && item.children.length > 0
              const isSectionExpanded = expandedSections.includes(item.id)
              const isItemActive = item.href ? isActive(item.href) : false
              const hasActiveChild = item.children?.some((child) =>
                isActive(child.href)
              )

              return (
                <div key={item.id}>
                  {hasChildren ? (
                    <>
                      <button
                        onClick={() => toggleSection(item.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-2 py-2 text-sm transition-colors',
                          hasActiveChild
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {item.icon}
                          {expanded && <span>{item.label}</span>}
                        </div>
                        {expanded && (
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform',
                              isSectionExpanded ? '' : '-rotate-90'
                            )}
                          />
                        )}
                      </button>
                      {expanded && isSectionExpanded && (
                        <div className="ml-4 mt-1 space-y-1 border-l pl-2">
                          {item.children?.map((child) => (
                            <Link
                              key={child.id}
                              to={child.href}
                              className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                                isActive(child.href)
                                  ? 'bg-gray-900 text-white'
                                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                              )}
                            >
                              <ChevronRight className="h-3 w-3" />
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <Link
                      to={item.href || '/'}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                        isItemActive
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      )}
                    >
                      {item.icon}
                      {expanded && <span>{item.label}</span>}
                    </Link>
                  )}
                </div>
              )
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        {expanded && (
          <div className="border-t p-3">
            <div className="text-xs text-muted-foreground">
              Hapiy v0.1.0
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
