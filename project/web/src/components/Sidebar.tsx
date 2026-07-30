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
} from 'lucide-react'
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

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
    icon: <LayoutGrid />,
    href: '/',
  },
  {
    id: 'monitor',
    label: '监控',
    icon: <Activity />,
    children: [
      { id: 'activity', label: '活动监视', href: '/monitor' },
      { id: 'logs', label: '使用日志', href: '/logs' },
    ],
  },
  {
    id: 'provider',
    label: '供应商',
    icon: <Server />,
    href: '/provider',
  },
  {
    id: 'token',
    label: '令牌管理',
    icon: <Key />,
    href: '/token',
  },
  {
    id: 'price',
    label: '价格配置',
    icon: <Tag />,
    href: '/price',
  },
  {
    id: 'policy',
    label: '策略配置',
    icon: <FileText />,
    children: [
      { id: 'rewrite', label: '请求改写', href: '/policy/rewrite' },
      { id: 'rewrite-response', label: '响应改写', href: '/policy/rewrite-response' },
      { id: 'heartbeat', label: '心跳回复', href: '/policy/heartbeat' },
      { id: 'concurrency', label: '并发控制', href: '/policy/concurrency' },
      { id: 'failover', label: '故障转移', href: '/policy/failover' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: <Settings />,
    href: '/settings',
  },
  {
    id: 'profile',
    label: '个人资料',
    icon: <User />,
    href: '/profile',
  },
]

function isPathActive(currentPath: string, href: string) {
  if (href === '/') return currentPath === '/'
  return currentPath === href || currentPath.startsWith(href + '/')
}

function NavLink({
  item,
  isOpen,
  onToggle,
}: {
  item: NavItem
  isOpen: boolean
  onToggle: () => void
}) {
  const { state } = useSidebar()
  const location = useLocation()
  const isActive = item.href ? isPathActive(location.pathname, item.href) : false
  const hasActiveChild = item.children?.some((child) =>
    isPathActive(location.pathname, child.href),
  )
  const showLabel = state === 'expanded'

  if (item.children && item.children.length > 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={hasActiveChild ?? false}
          tooltip={item.label}
          onClick={onToggle}
        >
          {item.icon}
          <span>{showLabel ? item.label : ''}</span>
          {showLabel && (
            <ChevronRight
              data-icon="inline-end"
              className={`ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
          )}
        </SidebarMenuButton>
        {showLabel && isOpen && (
          <SidebarMenuSub>
            {item.children.map((child) => (
              <SidebarMenuSubItem key={child.id}>
                <SidebarMenuSubButton
                  isActive={isPathActive(location.pathname, child.href)}
                  render={<Link to={child.href} />}
                >
                  <span>{child.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.label}
        render={<Link to={item.href ?? '/'} />}
      >
        {item.icon}
        <span>{showLabel ? item.label : ''}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { state } = useSidebar()
  const [openSections, setOpenSections] = useState(() => new Set(['monitor', 'policy']))
  const collapsed = state === 'collapsed'
  const showLabel = !collapsed

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 py-2">
          <span
            className={
              showLabel
                ? 'font-hapiy-logo text-2xl leading-none text-sidebar-foreground'
                : 'sr-only font-hapiy-logo text-2xl leading-none text-sidebar-foreground'
            }
          >
            hapiy
          </span>
          <SidebarTrigger className="ml-auto" size="icon" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {showLabel && <SidebarGroupLabel>导航</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <NavLink
                  key={item.id}
                  item={item}
                  isOpen={openSections.has(item.id)}
                  onToggle={() => {
                    setOpenSections((sections) => {
                      const next = new Set(sections)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      return next
                    })
                  }}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {showLabel && (
          <p className="text-xs text-muted-foreground">hapiy v0.1.0</p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  )
}
