import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as HoverCard from '@radix-ui/react-hover-card'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { version as appVersion } from '../../package.json'
import { ModeToggle } from '@/components/ModeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { AppIcon } from '@/components/AppIcon'
import { VersionDialog } from '@/components/VersionDialog'
import { AGENT_ENABLED_SETTING_KEY } from '@/components/OtherSettings'
import { dashboardApi } from '@/lib/dashboard-api'
import { useUpdateStatus } from '@/lib/update'
import { isPathActive, navigation, type NavItem } from '@/config/navigation'
import {
  Sidebar as SidebarRoot,
  SidebarContent,
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
  const { t } = useTranslation('common')
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
                <span>{t(child.labelKey)}</span>
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
            <span>{showLabel ? t(item.labelKey) : ''}</span>
          </Link>
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton>
          {item.icon}
          <span>{showLabel ? t(item.labelKey) : ''}</span>
        </SidebarMenuButton>
      )

      const popoverContent = (closeFlyout: () => void) => (
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            align="start"
            sideOffset={20}
            className="z-[100] min-w-40 rounded-none border border-border bg-popover p-1 shadow-md outline-none"
            onMouseEnter={(event) => event.stopPropagation()}
            onMouseLeave={(event) => event.stopPropagation()}
          >
            {parentClickable ? (
              <Link
                to={item.href!}
                onClick={closeFlyout}
                className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
              >
                <span>{t(item.labelKey)}</span>
              </Link>
            ) : (
              <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">
                {t(item.labelKey)}
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
                    'flex h-8 items-center rounded-none pl-3 pr-2 text-xs outline-none transition-colors',
                    childActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                      : 'hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
                  )}
                >
                  <span>{t(child.labelKey)}</span>
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
          <div className="group/menu-row flex w-full items-center">
            <SidebarMenuButton
              asChild
              isActive={selfActive}
              className="group-hover/menu-row:bg-sidebar-primary group-hover/menu-row:text-sidebar-primary-foreground"
            >
              <Link to={item.href!} onClick={onExpand}>
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </Link>
            </SidebarMenuButton>
            <button
              type="button"
              aria-label={
                isOpen
                  ? t('nav.collapseSection', { name: t(item.labelKey) })
                  : t('nav.expandSection', { name: t(item.labelKey) })
              }
              onClick={onToggle}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-sidebar-foreground/70 outline-none group-hover/menu-row:bg-sidebar-primary group-hover/menu-row:text-sidebar-primary-foreground',
                selfActive && 'bg-sidebar-primary text-sidebar-primary-foreground',
              )}
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
        <span>{t(item.labelKey)}</span>
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
      {item.external ? (
        <a href={item.href} target="_blank" rel="noopener noreferrer">
          {item.icon}
          <span>{showLabel ? t(item.labelKey) : ''}</span>
        </a>
      ) : (
        <Link to={item.href ?? '/'}>
          {item.icon}
          <span>{showLabel ? t(item.labelKey) : ''}</span>
        </Link>
      )}
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
        className="z-[100] min-w-40 rounded-none border border-border bg-popover p-1 shadow-md outline-none"
      >
        <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">
          {t(item.labelKey)}
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
  const { state, setOpenMobile } = useSidebar()
  const { t } = useTranslation('common')
  const location = useLocation()
  const [openSections, setOpenSections] = useState(readOpenSections)
  const [agentEnabled, setAgentEnabled] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable = Boolean(updateStatus?.available)
  const collapsed = state === 'collapsed'
  const showLabel = !collapsed

  // 手机浮层菜单：路由切换后自动收起，避免遮住新页面。
  useEffect(() => {
    setOpenMobile(false)
  }, [location.pathname, setOpenMobile])

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
          <button
            type="button"
            onClick={() => setVersionOpen(true)}
            title={updateAvailable ? t('update.tooltip') : `hapiy v${updateStatus?.current || appVersion}`}
            className={
              showLabel
                ? 'font-hapiy-logo relative -mx-1 cursor-pointer rounded px-1 text-2xl leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                : 'sr-only font-hapiy-logo text-2xl leading-none text-sidebar-foreground'
            }
          >
            hapiy
            {showLabel && updateAvailable && (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-sidebar"
              />
            )}
          </button>
          <div
            className={
              showLabel
                ? 'flex items-center gap-1.5'
                : 'flex flex-col items-center gap-1'
            }
          >
            {showLabel && <LanguageToggle size="icon" />}
            {showLabel && <ModeToggle size="icon" />}
            <SidebarTrigger size="icon" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {showLabel && <SidebarGroupLabel>{t('nav.section')}</SidebarGroupLabel>}
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
      <SidebarRail />
      <VersionDialog open={versionOpen} onOpenChange={setVersionOpen} />
    </SidebarRoot>
  )
}
