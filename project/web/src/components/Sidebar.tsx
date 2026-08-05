import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { Popover } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'
import { ModeToggle } from '@/components/ModeToggle'
import { AppIcon } from '@/components/AppIcon'
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
    icon: <AppIcon name="grid_view" />,
    href: '/',
  },
  {
    id: 'monitor',
    label: '监控',
    icon: <AppIcon name="monitoring" />,
    children: [
      { id: 'activity', label: '活动监视', href: '/monitor' },
      { id: 'logs', label: '使用日志', href: '/logs' },
    ],
  },
  {
    id: 'provider',
    label: '供应商',
    icon: <AppIcon name="dns" />,
    href: '/provider',
  },
  {
    id: 'token',
    label: '令牌管理',
    icon: <AppIcon name="key" />,
    href: '/token',
  },
  {
    id: 'channel-affinity',
    label: '渠道亲和性',
    icon: <AppIcon name="call_split" />,
    href: '/channel-affinity',
  },
  {
    id: 'price',
    label: '模型信息',
    icon: <AppIcon name="sell" />,
    href: '/model',
  },
  {
    id: 'policy',
    label: '策略配置',
    icon: <AppIcon name="description" />,
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
    icon: <AppIcon name="settings" />,
    children: [
      { id: 'base-url', label: 'BaseURL 配置', href: '/settings/base-url' },
      { id: 'general', label: '通用设置', href: '/settings/general' },
    ],
  },
  {
    id: 'profile',
    label: '个人资料',
    icon: <AppIcon name="person" />,
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
  const hasActiveChild =
    item.children?.some((child) => isPathActive(location.pathname, child.href)) ?? false
  const showLabel = state === 'expanded'
  const collapsed = state === 'collapsed'
  const hasChildren = item.children && item.children.length > 0

  // Light up the icon in collapsed mode when this section contains the active
  // path; in expanded mode the parent is intentionally never lit so the active
  // indicator stays on the leaf only.
  const triggerIsActive = collapsed && hasActiveChild

  if (hasChildren) {
    const trigger = (
      <SidebarMenuButton
        isActive={triggerIsActive}
        onClick={collapsed ? undefined : onToggle}
      >
        {item.icon}
        <span>{showLabel ? item.label : ''}</span>
        {showLabel && (
          <AppIcon
            name="chevron_right"
            className={`ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
        )}
      </SidebarMenuButton>
    )

    const popoverContent = (
      <Popover.Portal>
        <Popover.Positioner side="right" align="start" sideOffset={20}>
          <Popover.Popup
            className="z-[100] min-w-40 rounded-md border border-border bg-popover p-1 shadow-md outline-none"
            onMouseEnter={(event) => event.stopPropagation()}
            onMouseLeave={(event) => event.stopPropagation()}
          >
            <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">
              {item.label}
            </div>
            {item.children!.map((child) => {
              const childActive = isPathActive(location.pathname, child.href)
              return (
                <Popover.Close
                  key={child.id}
                  render={
                    <Link
                      to={child.href}
                      className={cn(
                        'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors',
                        childActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                          : 'hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
                      )}
                    >
                      <span>{child.label}</span>
                    </Link>
                  }
                />
              )
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    )

    return (
      <SidebarMenuItem>
        {collapsed ? (
          <CollapsedNavItem trigger={trigger} content={popoverContent} />
        ) : (
          <>
            {trigger}
            {showLabel && isOpen && (
              <SidebarMenuSub>
                {item.children!.map((child) => (
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
          </>
        )}
      </SidebarMenuItem>
    )
  }

  const trigger = (
    <SidebarMenuButton
      isActive={isActive}
      tooltip={collapsed ? item.label : undefined}
      render={<Link to={item.href ?? '/'} />}
    >
      {item.icon}
      <span>{showLabel ? item.label : ''}</span>
    </SidebarMenuButton>
  )

  if (!collapsed) {
    return (
      <SidebarMenuItem>
        {trigger}
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      {trigger}
    </SidebarMenuItem>
  )
}

function CollapsedNavItem({
  trigger,
  content,
}: {
  trigger: React.ReactNode
  content: React.ReactNode
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        nativeButton={false}
        openOnHover
        delay={60}
        closeDelay={180}
        render={<span className="block w-full" />}
      >
        {trigger}
      </Popover.Trigger>
      {content}
    </Popover.Root>
  )
}

const OPEN_SECTIONS_KEY = 'sidebar_open_sections'

const DEFAULT_OPEN_SECTIONS = ['monitor', 'policy', 'settings']

function readOpenSections(): Set<string> {
  const fallback = () => new Set(DEFAULT_OPEN_SECTIONS)
  try {
    const raw = localStorage.getItem(OPEN_SECTIONS_KEY)
    if (!raw) return fallback()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallback()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return fallback()
  }
}

export function AppSidebar() {
  const { state } = useSidebar()
  const [openSections, setOpenSections] = useState(readOpenSections)
  const collapsed = state === 'collapsed'
  const showLabel = !collapsed

  useEffect(() => {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify([...openSections]))
  }, [openSections])

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <div
          className={
            showLabel
              ? 'flex items-center justify-between gap-2 py-2'
              : 'flex flex-col items-start justify-center gap-1 py-1'
          }
        >
          <span
            className={
              showLabel
                ? 'font-hapiy-logo text-2xl leading-none text-sidebar-foreground'
                : 'sr-only font-hapiy-logo text-2xl leading-none text-sidebar-foreground'
            }
          >
            hapiy
          </span>
          <div
            className={
              showLabel
                ? 'flex items-center gap-1.5'
                : 'flex flex-col items-center gap-1'
            }
          >
            <ModeToggle size="icon" />
            <SidebarTrigger size="icon" />
          </div>
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
