import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import * as HoverCard from '@radix-ui/react-hover-card'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { ModeToggle } from '@/components/ModeToggle'
import { AppIcon } from '@/components/AppIcon'
import { AGENT_ENABLED_SETTING_KEY } from '@/components/OtherSettings'
import { dashboardApi } from '@/lib/dashboard-api'
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
      { id: 'logs', label: '使用记录', href: '/logs' },
      { id: 'capture', label: '日志抓取', href: '/logs/capture' },
    ],
  },
  {
    id: 'llm-config',
    label: '模型接入',
    icon: <AppIcon name="layers" />,
    children: [
      { id: 'token', label: '令牌', href: '/token' },
      { id: 'provider', label: '供应商', href: '/provider' },
    ],
  },
  {
    id: 'policy',
    label: '请求处理',
    icon: <AppIcon name="description" />,
    children: [
      { id: 'rewrite', label: '请求改写', href: '/policy/rewrite' },
      { id: 'rewrite-response', label: '响应改写', href: '/policy/rewrite-response' },
      { id: 'channel-affinity', label: '渠道亲和性', href: '/channel-affinity' },
      { id: 'failover', label: '自动禁用', href: '/policy/failover' },
    ],
  },
  {
    id: 'agent',
    label: '接管Agent',
    icon: <AppIcon name="robot" />,
    href: '/agent',
    children: [
      { id: 'agent-config', label: '配置文件', href: '/agent/config' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: <AppIcon name="settings" />,
    children: [
      { id: 'base-url', label: 'BaseURL', href: '/settings/base-url' },
      { id: 'general', label: '查询Model', href: '/settings/general' },
      { id: 'billing', label: '币种汇率', href: '/settings/billing' },
      { id: 'token-usage', label: '查询token用量', href: '/settings/token-usage' },
      { id: 'other', label: '开启接管Agent', href: '/settings/other' },
      { id: 'debug', label: 'Debug', href: '/settings/debug' },
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
  return currentPath === href || (href !== '/logs' && currentPath.startsWith(href + '/'))
}

function NavLink({
  item,
  isOpen,
  onToggle,
  onExpand,
}: {
  item: NavItem
  isOpen: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  const { state } = useSidebar()
  const location = useLocation()
  const hasActiveChild =
    item.children?.some((child) => isPathActive(location.pathname, child.href)) ?? false
  // A clickable parent lights up only on its own page; when a child owns the
  // current path the active indicator stays on the leaf.
  const selfActive = item.href
    ? location.pathname === item.href || (isPathActive(location.pathname, item.href) && !hasActiveChild)
    : false
  const showLabel = state === 'expanded'
  const collapsed = state === 'collapsed'
  const hasChildren = item.children && item.children.length > 0
  // A parent with both children and its own page: body navigates + expands,
  // the chevron is a separate toggle-only hit area.
  const parentClickable = Boolean(item.href) && hasChildren

  if (hasChildren) {
    const subMenu = isOpen && (
      <SidebarMenuSub>
        {item.children!.map((child) => (
          <SidebarMenuSubItem key={child.id}>
            <SidebarMenuSubButton
              asChild
              isActive={isPathActive(location.pathname, child.href)}
            >
              <Link to={child.href}>
                <span>{child.label}</span>
              </Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    )

    if (collapsed) {
      const trigger = parentClickable ? (
        <SidebarMenuButton asChild isActive={selfActive || hasActiveChild}>
          <Link to={item.href!}>
            {item.icon}
            <span>{showLabel ? item.label : ''}</span>
          </Link>
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton>
          {item.icon}
          <span>{showLabel ? item.label : ''}</span>
        </SidebarMenuButton>
      )

      const popoverContent = (closeFlyout: () => void) => (
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            align="start"
            sideOffset={20}
            className="z-[100] min-w-40 rounded-md border border-border bg-popover p-1 shadow-md outline-none"
            onMouseEnter={(event) => event.stopPropagation()}
            onMouseLeave={(event) => event.stopPropagation()}
          >
            {parentClickable ? (
              <Link
                to={item.href!}
                onClick={closeFlyout}
                className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
              >
                <span>{item.label}</span>
              </Link>
            ) : (
              <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">
                {item.label}
              </div>
            )}
            {item.children!.map((child) => {
              const childActive = isPathActive(location.pathname, child.href)
              return (
                <Link
                  key={child.id}
                  to={child.href}
                  onClick={closeFlyout}
                  className={cn(
                    'flex h-8 items-center rounded-sm pl-3 pr-2 text-xs outline-none transition-colors',
                    childActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                      : 'hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
                  )}
                >
                  <span>{child.label}</span>
                </Link>
              )
            })}
          </HoverCard.Content>
        </HoverCard.Portal>
      )

      return (
        <SidebarMenuItem>
          <CollapsedNavItem trigger={trigger} content={popoverContent} />
        </SidebarMenuItem>
      )
    }

    if (parentClickable) {
      return (
        <SidebarMenuItem>
          <div className="flex w-full items-center">
            <SidebarMenuButton asChild isActive={selfActive}>
              <Link to={item.href!} onClick={onExpand}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
            <button
              type="button"
              aria-label={isOpen ? `折叠 ${item.label}` : `展开 ${item.label}`}
              onClick={onToggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
            >
              <AppIcon
                name="chevron_right"
                className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
          {subMenu}
        </SidebarMenuItem>
      )
    }

    const trigger = (
      <SidebarMenuButton onClick={onToggle}>
        {item.icon}
        <span>{item.label}</span>
        <AppIcon
          name="chevron_right"
          className={`ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </SidebarMenuButton>
    )

    return (
      <SidebarMenuItem>
        {trigger}
        {subMenu}
      </SidebarMenuItem>
    )
  }

  const trigger = (
    <SidebarMenuButton asChild isActive={selfActive}>
      <Link to={item.href ?? '/'}>
        {item.icon}
        <span>{showLabel ? item.label : ''}</span>
      </Link>
    </SidebarMenuButton>
  )

  if (!collapsed) {
    return (
      <SidebarMenuItem>
        {trigger}
      </SidebarMenuItem>
    )
  }

  // Collapsed: show a tooltip that mirrors the style of the submenu
  // popover (same panel, border, title row), but clicking the icon
  // navigates directly instead of expanding a menu.
  const tooltipContent = (
    <Tooltip.Portal>
      <Tooltip.Content
        side="right"
        align="start"
        sideOffset={20}
        className="z-[100] min-w-40 rounded-md border border-border bg-popover p-1 shadow-md outline-none"
      >
        <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">
          {item.label}
        </div>
      </Tooltip.Content>
    </Tooltip.Portal>
  )

  return (
    <SidebarMenuItem>
      <Tooltip.Root delayDuration={60} disableHoverableContent>
        <Tooltip.Trigger asChild>
          <span className="block w-full">{trigger}</span>
        </Tooltip.Trigger>
        {tooltipContent}
      </Tooltip.Root>
    </SidebarMenuItem>
  )
}

function CollapsedNavItem({
  trigger,
  content,
}: {
  trigger: React.ReactNode
  content: (closeFlyout: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={60} closeDelay={180}>
      <HoverCard.Trigger asChild>
        <span className="block w-full">{trigger}</span>
      </HoverCard.Trigger>
      {content(() => setOpen(false))}
    </HoverCard.Root>
  )
}

const OPEN_SECTIONS_KEY = 'sidebar_open_sections'

const DEFAULT_OPEN_SECTIONS = ['monitor', 'llm-config', 'policy', 'agent', 'settings']

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
  const [agentEnabled, setAgentEnabled] = useState(false)
  const collapsed = state === 'collapsed'
  const showLabel = !collapsed

  useEffect(() => {
    localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify([...openSections]))
  }, [openSections])

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        setAgentEnabled(settings.find((s) => s.key === AGENT_ENABLED_SETTING_KEY)?.value === 'true')
      })
      .catch(() => {
        if (!cancelled) setAgentEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visibleNavigation =
    agentEnabled ? navigation : navigation.filter((item) => item.id !== 'agent')

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <div
          className={
            showLabel
              ? 'flex items-center justify-between gap-2 py-2 pl-2'
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
              {visibleNavigation.map((item) => (
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
                  onExpand={() => {
                    setOpenSections((sections) => {
                      if (sections.has(item.id)) return sections
                      const next = new Set(sections)
                      next.add(item.id)
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
