import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as HoverCard from '@radix-ui/react-hover-card'
import { cn } from '@/lib/utils'
import { version as appVersion } from '../../../package.json'
import { ModeToggle } from '@/components/wooh/ModeToggle'
import { LanguageToggle } from '@/components/wooh/LanguageToggle'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { VersionDialog } from '@/components/wooh/VersionDialog'
import { AGENT_ENABLED_SETTING_KEY } from '@/components/wooh/OtherSettings'
import { AGENT_DOCK_SPLITTER_WIDTH, useAgentDock } from '@/components/wooh/agent-dock-context'
import { i18n } from '@/i18n/i18n'
import { dashboardApi } from '@/lib/dashboard-api'
import { useUpdateStatus } from '@/lib/update'
import { isPathActive, navigation, type NavItem } from '@/config/navigation'
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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
  const { state, isMobile } = useSidebar()
  const { t } = useTranslation('common')
  const location = useLocation()
  const hasActiveChild =
    item.children?.some((child) => isPathActive(location.pathname, child.href)) ?? false
  // A clickable parent lights up only on its own page; when a child owns the
  // current path the active indicator stays on the leaf.
  const selfActive = item.href
    ? location.pathname === item.href || (isPathActive(location.pathname, item.href) && !hasActiveChild)
    : false
  // 移动端浮层始终展示「图标 + 文字」，忽略桌面端的只显示图标状态。
  const collapsed = state === 'collapsed' && !isMobile
  const showLabel = !collapsed
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
            className="z-[100] min-w-40 rounded-md ring-1 ring-foreground/10 bg-popover p-1 shadow-md outline-none"
            onMouseEnter={(event) => event.stopPropagation()}
            onMouseLeave={(event) => event.stopPropagation()}
          >
            {parentClickable ? (
              <Link
                to={item.href!}
                onClick={closeFlyout}
                className="flex h-8 shrink-0 items-center px-3 text-xs text-sidebar-foreground outline-none transition-colors hover:rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
                    'flex h-8 items-center rounded-md pr-4 pl-5 text-xs outline-none transition-colors',
                    childActive
                      ? 'rounded-full bg-primary font-medium text-primary-foreground'
                      : 'hover:rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
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
          <div className="group/menu-row relative flex w-full items-center">
            {/* 整行一个胶囊：箭头也在胶囊内，右侧留出箭头底板的位置 */}
            <SidebarMenuButton
              asChild
              isActive={selfActive}
              className="pr-10 group-hover/menu-row:bg-sidebar-accent group-hover/menu-row:text-sidebar-accent-foreground"
            >
              <Link to={item.href!} onClick={onExpand}>
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </Link>
            </SidebarMenuButton>
            {/* 箭头单独可点：圆形底板直径 = 行高 32px − 8px = 24px，上下与右侧各留 4px；底板是「可点」提示，仅在本行选中时出现 */}
            <button
              type="button"
              aria-label={
                isOpen
                  ? t('nav.collapseSection', { name: t(item.labelKey) })
                  : t('nav.expandSection', { name: t(item.labelKey) })
              }
              onClick={onToggle}
              className={cn(
                'absolute top-1 right-1 z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-sidebar-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                selfActive && 'bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25',
              )}
            >
              <AppIcon
                name="chevron_right"
                /* strokeWidth 6 = 2 × global strokeWidth: 3 (src/config/icons.json)：10px 的小箭头需要更粗才醒目 */
                strokeWidth={6}
                className={`[&_svg]:size-[10px]! transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
          {subMenu}
        </SidebarMenuItem>
      )
    }

    const trigger = (
      /* pr-[11px]：10px 箭头下让中心仍落在 224px（= 底板中心）*/
      <SidebarMenuButton onClick={onToggle} className="pr-[11px]">
        {item.icon}
        <span>{t(item.labelKey)}</span>
        <AppIcon
          name="chevron_right"
          /* strokeWidth 6 = 2 × global strokeWidth: 3 (src/config/icons.json)：10px 的小箭头需要更粗才醒目 */
          strokeWidth={6}
          className={`[&_svg]:size-[10px]! ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`}
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
    <SidebarMenuButton asChild isActive={selfActive} tooltip={t(item.labelKey)}>
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

  return <SidebarMenuItem>{trigger}</SidebarMenuItem>
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
  const { state, setOpenMobile, isMobile } = useSidebar()
  const { t } = useTranslation('common')
  const location = useLocation()
  const [openSections, setOpenSections] = useState(readOpenSections)
  const [agentEnabled, setAgentEnabled] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable = Boolean(updateStatus?.available)
  // 对话面板在最左边，侧边栏是 fixed 定位，要按面板宽度（含分隔条）
  // 整体右移，才能和它自己的占位 gap 对齐。
  const { width: dockWidth, dragging: dockDragging, openDock, setWidth } = useAgentDock()
  const chatOpen = dockWidth > 0
  const toggleChat = () => {
    if (chatOpen) setWidth(0)
    else openDock()
  }
  const sidebarLeft = dockWidth > 0 ? dockWidth + AGENT_DOCK_SPLITTER_WIDTH : 0
  // 移动端浮层始终是展开形态，只有桌面端折叠成图标栏。
  const collapsed = state === 'collapsed' && !isMobile
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

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
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
    ))

  return (
    <SidebarRoot
      collapsible="icon"
      variant="inset"
      style={{ left: sidebarLeft }}
      className={cn(
        // 拖动时去掉 left 的 200ms 过渡，避免侧边栏追着指针慢半拍。
        dockDragging && 'md:transition-none!',
        // 对话面板出现时给侧边栏本身也描一圈边，避免这一列看起来是“裸”的。
        dockWidth > 0 &&
          'pl-1! md:[&>[data-slot=sidebar-inner]]:rounded-xl md:[&>[data-slot=sidebar-inner]]:border md:[&>[data-slot=sidebar-inner]]:border-border',
      )}
    >
      <SidebarHeader>
        {/* 顶部一行：左边 logo、右边语言/深浅/折叠——与预览页 /p 一致 */}
        <div
          className={
            showLabel ? 'flex items-center justify-between gap-2 py-2 pl-2' : 'flex flex-col items-center justify-center gap-1 py-1'
          }
        >
          <div className="flex items-center gap-1.5">
            {/* 移动端：菜单开关固定在左侧，与页面头部同一位置、同为三横线图标 */}
            {isMobile && <SidebarTrigger icon="menu" />}
            <button
              type="button"
              onClick={() => setVersionOpen(true)}
              title={updateAvailable ? t('update.tooltip') : `hapiy v${updateStatus?.current || appVersion}`}
              className={cn(
                showLabel
                  ? 'relative -mx-1 cursor-pointer rounded-md px-1 font-hapiy-logo text-2xl leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  : 'relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md font-hapiy-logo text-2xl leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              {collapsed ? 'h' : 'hapiy'}
              {showLabel && updateAvailable && (
                <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success" />
              )}
            </button>
          </div>
          <div className={showLabel ? 'flex items-center gap-1.5' : 'flex flex-col items-center gap-1'}>
            {showLabel && <LanguageToggle size="icon" />}
            {showLabel && <ModeToggle size="icon" />}
            <SidebarTrigger size="icon" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <div className={showLabel ? 'px-2 pt-2' : 'flex justify-center px-1 pt-2'}>
          {showLabel ? (
            <Button
              size="sm"
              variant="ghost"
              className="justify-start gap-2 border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80"
              onClick={toggleChat}
            >
              <AppIcon name="chat" />
              <span>{i18n.t(chatOpen ? 'agentPanel:collapseAgent' : 'agentPanel:expandAgent')}</span>
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              className="border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80"
              onClick={toggleChat}
              aria-label={i18n.t(chatOpen ? 'agentPanel:collapseAgent' : 'agentPanel:expandAgent')}
              title={i18n.t(chatOpen ? 'agentPanel:collapseAgent' : 'agentPanel:expandAgent')}
            >
              <AppIcon name="chat" />
            </Button>
          )}
        </div>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(visibleNavigation)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
      <VersionDialog open={versionOpen} onOpenChange={setVersionOpen} />
    </SidebarRoot>
  )
}
