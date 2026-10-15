// 临时预览：官方 dashboard 侧边栏结构 + 我们的导航，外壳用 variant="inset"。
// 组件来自 ./sidebar-nova 与 ./button-nova（官方组件的 nova 风格副本），
// 页面内容按真实 LogsPage（使用日志）摆，用来确认样式。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as HoverCard from '@radix-ui/react-hover-card'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Button } from './button-nova'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select-nova'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from './dialog-nova'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from './sidebar-nova'
import { AppIcon } from '@/components/wooh/AppIcon'

const square = <AppIcon name="grid_view" />
const activity = <AppIcon name="monitoring" />
const layers = <AppIcon name="layers" />
const policy = <AppIcon name="description" />
const robot = <AppIcon name="robot" />
const settings = <AppIcon name="settings" />
const person = <AppIcon name="person" />
const help = <AppIcon name="help" />

type Row = {
  date: string
  time: string
  source?: string
  token?: string
  provider?: string
  model?: string
  affinity?: { text: string; tone: 'success' | 'warning' | 'muted' }
  tokens?: string
  stream?: boolean
  quota?: string
  latency?: string
  speed?: string
  status?: 'success' | 'failed'
  event?: { text: string; tone: 'destructive' | 'success' | 'muted' }
}

const rows: Row[] = [
  { date: '2026-10-15', time: '09:41:22', source: 'default', token: 'T-GPT4', provider: 'OpenAI', model: 'gpt-4o-mini', affinity: { text: '复用渠道', tone: 'success' }, tokens: '1,284', stream: true, quota: '¥0.000128', latency: '412ms（首字：180ms）', speed: '3.1k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:41:18', source: 'default', token: 'T-GPT4', provider: 'Anthropic', model: 'claude-sonnet-4', affinity: { text: '部分复用', tone: 'warning' }, tokens: '3,902', stream: true, quota: '¥0.004210', latency: '1.8s（首字：620ms）', speed: '2.4k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:41:07', source: 'default', token: 'T-CURSOR', provider: 'DeepSeek', model: 'deepseek-v3.2', affinity: { text: '新建渠道', tone: 'muted' }, tokens: '742', quota: '¥0.000061', latency: '980ms（首字：310ms）', speed: '1.1k t/s', status: 'failed' },
  { date: '2026-10-15', time: '09:40:55', provider: 'OpenAI', model: 'gpt-4.1', event: { text: '故障转移', tone: 'destructive' } },
  { date: '2026-10-15', time: '09:40:31', source: 'default', token: 'T-GPT4', provider: 'Google', model: 'gemini-2.5-pro', affinity: { text: '复用渠道', tone: 'success' }, tokens: '5,120', stream: true, quota: '¥0.007310', latency: '2.4s（首字：840ms）', speed: '2.9k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:40:12', provider: 'Anthropic', model: 'claude-haiku-4.5', event: { text: '自动恢复', tone: 'success' } },
  { date: '2026-10-15', time: '09:39:58', source: 'default', token: 'T-CLAUDE', provider: 'Anthropic', model: 'claude-sonnet-4', affinity: { text: '复用渠道', tone: 'success' }, tokens: '18,430', stream: true, quota: '¥0.019880', latency: '6.2s（首字：2.1s）', speed: '4.2k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:39:40', source: 'default', token: 'T-GPT4', provider: 'OpenAI', model: 'gpt-4o', affinity: { text: '部分复用', tone: 'warning' }, tokens: '2,066', stream: true, quota: '¥0.002940', latency: '1.2s（首字：400ms）', speed: '2.0k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:39:12', source: 'default', token: 'T-CURSOR', provider: 'DeepSeek', model: 'deepseek-v3.2', affinity: { text: '复用渠道', tone: 'success' }, tokens: '958', quota: '¥0.000084', latency: '740ms（首字：260ms）', speed: '1.5k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:38:47', event: { text: '系统管理', tone: 'muted' } },
  { date: '2026-10-15', time: '09:38:20', source: 'default', token: 'T-GPT4', provider: 'OpenAI', model: 'gpt-4o-mini', affinity: { text: '复用渠道', tone: 'success' }, tokens: '3,344', stream: true, quota: '¥0.000412', latency: '1.1s（首字：350ms）', speed: '3.4k t/s', status: 'success' },
  { date: '2026-10-15', time: '09:37:51', source: 'default', token: 'T-CLAUDE', provider: 'Anthropic', model: 'claude-haiku-4.5', affinity: { text: '新建渠道', tone: 'muted' }, tokens: '806', stream: true, quota: '¥0.000121', latency: '560ms（首字：190ms）', speed: '1.8k t/s', status: 'failed' },
]

const toneClass = { success: 'text-success', warning: 'text-warning', muted: 'text-muted-foreground', destructive: 'text-destructive' } as const

type NavEntry = {
  id: string
  label: string
  icon: React.ReactNode
  href?: string
  children?: { label: string }[]
}

// 侧边栏专用的两个浮层：折叠时子菜单用 HoverCard 飞出、叶子项用 Tooltip 面板，
// 和我们现在线上（wooh/Sidebar.tsx）一模一样。
function CollapsedFlyout({ item, activeChild, close }: { item: NavEntry; activeChild: string | null; close: () => void }) {
  return (
    <HoverCard.Portal>
      <HoverCard.Content
        side="right"
        align="start"
        sideOffset={20}
        className="z-[100] min-w-40 rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10 outline-none"
      >
        {item.href ? (
          <a
            href="#"
            onClick={close}
            className="flex h-8 shrink-0 items-center px-3 text-xs text-sidebar-foreground outline-none transition-colors hover:rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span>{item.label}</span>
          </a>
        ) : (
          <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">{item.label}</div>
        )}
        {item.children!.map((child) => (
          <a
            key={child.label}
            href="#"
            onClick={close}
            className={cn(
              'flex h-8 items-center rounded-md pr-4 pl-5 text-xs outline-none transition-colors',
              activeChild === child.label
                ? 'rounded-full bg-primary font-medium text-primary-foreground'
                : 'hover:rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <span>{child.label}</span>
          </a>
        ))}
      </HoverCard.Content>
    </HoverCard.Portal>
  )
}

function NavLink({
  item,
  active,
  activeChild,
  onSelect,
}: {
  item: NavEntry
  active: boolean
  activeChild: string | null
  onSelect: (child: string | null) => void
}) {
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const showLabel = !collapsed
  const hasChildren = (item.children?.length ?? 0) > 0
  const [open, setOpen] = useState(true)

  if (hasChildren) {
    const isOpen = open && !collapsed
    const subMenu = isOpen && (
      <SidebarMenuSub>
        {item.children!.map((child) => (
          <SidebarMenuSubItem key={child.label}>
            <SidebarMenuSubButton isActive={activeChild === child.label} onClick={() => onSelect(child.label)}>
              <span>{child.label}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    )

    if (collapsed) {
      const trigger = (
        <SidebarMenuButton
          isActive={active && !activeChild}
          className={cn(active && activeChild && 'rounded-full bg-sidebar-accent text-sidebar-accent-foreground')}
          onClick={() => onSelect(null)}
        >
          {item.icon}
          <span>{showLabel ? item.label : ''}</span>
        </SidebarMenuButton>
      )
      return (
        <SidebarMenuItem>
          <HoverCard.Root openDelay={60} closeDelay={180}>
            <HoverCard.Trigger asChild>
              <span className="block w-full">{trigger}</span>
            </HoverCard.Trigger>
            <CollapsedFlyout item={item} activeChild={activeChild} close={() => undefined} />
          </HoverCard.Root>
        </SidebarMenuItem>
      )
    }

    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={active && !activeChild}
          className={cn(active && activeChild && 'rounded-full bg-sidebar-accent text-sidebar-accent-foreground')}
          onClick={() => {
            setOpen((v) => !v)
            onSelect(null)
          }}
        >
          {item.icon}
          <span>{item.label}</span>
          <AppIcon name="chevron_right" className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />
        </SidebarMenuButton>
        {subMenu}
      </SidebarMenuItem>
    )
  }

  const trigger = (
    <SidebarMenuButton isActive={active} onClick={() => onSelect(null)}>
      {item.icon}
      <span>{showLabel ? item.label : ''}</span>
    </SidebarMenuButton>
  )

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <Tooltip.Root delayDuration={60} disableHoverableContent>
          <Tooltip.Trigger asChild>
            <span className="block w-full">{trigger}</span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              align="start"
              sideOffset={20}
              className="z-[100] min-w-40 rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10 outline-none"
            >
              <div className="flex h-8 shrink-0 items-center px-2 text-xs text-sidebar-foreground/70">{item.label}</div>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </SidebarMenuItem>
    )
  }

  return <SidebarMenuItem>{trigger}</SidebarMenuItem>
}

function PreviewSidebar() {
  const { t } = useTranslation('common')
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const showLabel = !collapsed
  const [activeId, setActiveId] = useState('monitor')
  const [activeChild, setActiveChild] = useState<string | null>(t('common:nav.activity'))

  const items: NavEntry[] = [
    { id: 'topology', label: t('common:nav.topology'), icon: square },
    {
      id: 'monitor',
      label: t('common:nav.monitor'),
      icon: activity,
      children: [
        { label: t('common:nav.activity') },
        { label: t('common:nav.logs') },
        { label: t('common:nav.capture') },
      ],
    },
    { id: 'llm', label: t('common:nav.llmConfig'), icon: layers },
    { id: 'policy', label: t('common:nav.policy'), icon: policy },
    { id: 'agent', label: t('common:nav.agent'), icon: robot },
    { id: 'settings', label: t('common:nav.settings'), icon: settings },
  ]

  const selectItem = (id: string) => (child: string | null) => {
    setActiveId(id)
    setActiveChild(child)
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        {/* 顶部一行：左边 logo、右边语言/深浅/折叠——沿用我们原来的位置与折叠逻辑 */}
        <div
          className={
            showLabel ? 'flex items-center justify-between gap-2 py-2 pl-2' : 'flex flex-col items-center justify-center gap-1 py-1'
          }
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="hapiy v1.0.0"
              className={cn(
                showLabel
                  ? 'relative -mx-1 cursor-pointer rounded-md px-1 font-hapiy-logo text-2xl leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  : 'relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md font-hapiy-logo text-2xl leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              {collapsed ? 'h' : 'hapiy'}
            </button>
          </div>
          <div className={showLabel ? 'flex items-center gap-1.5' : 'flex flex-col items-center gap-1'}>
            {showLabel && (
              <Button variant="ghost" size="icon" title="语言">
                <AppIcon name="translate" />
              </Button>
            )}
            {showLabel && (
              <Button variant="ghost" size="icon" title="深浅色">
                <AppIcon name="dark_mode" />
              </Button>
            )}
            <SidebarTrigger size="icon" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('common:nav.section')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <NavLink
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  activeChild={activeChild}
                  onSelect={selectItem(item.id)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLink
                item={{ id: 'profile', label: t('common:nav.profile'), icon: person }}
                active={activeId === 'profile'}
                activeChild={activeChild}
                onSelect={selectItem('profile')}
              />
              <NavLink
                item={{ id: 'help', label: t('common:nav.help'), icon: help }}
                active={activeId === 'help'}
                activeChild={activeChild}
                onSelect={selectItem('help')}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 h-px bg-border" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </div>
  )
}

function Field({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className ?? ''}`}>
      <span className="min-w-[4rem] shrink-0 text-muted-foreground/60">{label}</span>
      <span className="min-w-0 leading-relaxed break-words whitespace-pre-wrap text-foreground">{value}</span>
    </div>
  )
}

function DetailFields({ row }: { row: Row }) {
  const { t } = useTranslation('logs')
  return (
    <div className="space-y-4 text-xs">
      <FieldGroup>
        <Field label={t('detail.requestId')} value={`req_${row.time.replaceAll(':', '')}`} />
        <Field label={t('detail.providerKey')} value={row.provider ?? '-'} />
        <Field className="col-span-2" label={t('detail.downstreamUrl')} value="https://api.hapiy.local/v1/chat/completions" />
        <Field className="col-span-2" label={t('detail.upstreamUrl')} value={`https://api.${(row.provider ?? 'openai').toLowerCase()}.com/v1/chat/completions`} />
      </FieldGroup>
      <FieldGroup>
        <Field label={t('columns.model')} value={row.model ?? '-'} />
        <Field label={t('columns.stream')} value={row.stream ? 'SSE' : '-'} />
        <Field
          className="col-span-2"
          label={t('columns.tokens')}
          value={row.tokens ? t('tokens.summary', { input: row.tokens, cacheWrite: 512, cacheRead: 768, hitRate: '（21.4%）', output: 384 }) : '-'}
        />
      </FieldGroup>
      <FieldGroup>
        <Field label={t('columns.latency')} value={row.latency ?? '-'} />
        <Field label={t('columns.speed')} value={row.speed ?? '-'} />
        <Field label={t('columns.quota')} value={row.quota ?? '-'} />
        <Field label={t('columns.affinity')} value={row.affinity?.text ?? '-'} />
      </FieldGroup>
      {row.status === 'failed' && (
        <FieldGroup>
          <Field className="col-span-2" label={t('detail.details')} value={<span className="text-destructive">upstream returned 502 Bad Gateway（channel #12）</span>} />
        </FieldGroup>
      )}
    </div>
  )
}

const PAGE_SIZE_OPTIONS = ['20', '50', '100', '200']
const TOTAL = 12480

function LogsPage() {
  // 真实页面的筛选区：左 filters（flex-1 + flex-wrap 换行）、中间 actions、右侧 passive 靠右，
  // 布局类串直接照搬 DataTable 的 toolbar 约定。
  const { t } = useTranslation(['logs', 'ui', 'common'])
  const [selected, setSelected] = useState<Row | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [preset, setPreset] = useState('all')
  const [type, setType] = useState('all')
  const [source, setSource] = useState('all')
  const [token, setToken] = useState('all')
  const [provider, setProvider] = useState('all')
  const [model, setModel] = useState('all')
  const [status, setStatus] = useState('all')
  const [limit, setLimit] = useState('50')
  const [offset, setOffset] = useState(0)

  const presets: { key: string; label: string }[] = [
    { key: 'all', label: t('logs:dateRange.all') },
    { key: 'month', label: t('logs:dateRange.lastMonth') },
    { key: 'week', label: t('logs:dateRange.lastWeek') },
    { key: 'day', label: t('logs:dateRange.lastDay') },
    { key: 'today', label: t('logs:dateRange.today') },
  ]

  const selects: { value: string; set: (v: string) => void; width: string; placeholder: string; all: string; options: string[] }[] = [
    { value: type, set: setType, width: 'w-32', placeholder: t('logs:filters.type'), all: t('logs:filters.allTypes'), options: ['请求', '故障转移', '自动恢复', '手动恢复', '系统管理'] },
    { value: source, set: setSource, width: 'w-40', placeholder: t('logs:filters.source'), all: t('logs:filters.allSources'), options: ['default', '__unmarked'] },
    { value: token, set: setToken, width: 'w-40', placeholder: t('logs:filters.token'), all: t('logs:filters.allTokens'), options: ['T-GPT4', 'T-CLAUDE', 'T-CURSOR'] },
    { value: provider, set: setProvider, width: 'w-40', placeholder: t('logs:filters.provider'), all: t('logs:filters.allProviders'), options: ['OpenAI', 'Anthropic', 'DeepSeek', 'Google'] },
    { value: model, set: setModel, width: 'w-40', placeholder: t('logs:filters.model'), all: t('logs:filters.allModels'), options: ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4', 'deepseek-v3.2'] },
    { value: status, set: setStatus, width: 'w-32', placeholder: t('logs:filters.status'), all: t('logs:filters.allStatuses'), options: [t('logs:status.success'), t('logs:status.failed')] },
  ]

  const columns = [
    t('logs:columns.time'),
    t('logs:columns.source'),
    t('logs:columns.token'),
    t('logs:columns.provider'),
    t('logs:columns.model'),
    t('logs:columns.affinity'),
    t('logs:columns.tokens'),
    t('logs:columns.stream'),
    t('logs:columns.quota'),
    t('logs:columns.latency'),
    t('logs:columns.speed'),
    t('logs:columns.status'),
  ]

  const currentPage = Math.floor(offset / Number(limit)) + 1
  const hasPrev = offset > 0
  const hasNext = offset + Number(limit) < TOTAL

  return (
    <div className="flex h-full flex-col">
      {/* PageHeader */}
      <div className="bg-card">
        <div className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger icon="menu" className="-ml-1 h-10 w-10 shrink-0 md:hidden" />
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">使用日志</h1>
                <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                  {t('logs:page.usage.description')}{' '}
                  <span className="text-muted-foreground/80">[{t('logs:page.recordCount', { count: TOTAL })}]</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <Separator className="bg-border/60" />
      </div>

      <div className="p-6">
        {/* Toolbar：active 侧 = filters + actions，passive 侧靠右（照搬 DataTable 的约定） */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div data-group="active" className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            {/* DateRangeFilter：两个 DatePicker + 至 + 五个快捷按钮 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={t('logs:dateRange.start')}
                className={cn(
                  'flex w-36 items-center gap-1.5 rounded-lg border border-border bg-input/30 px-2.5 text-xs transition-colors outline-none',
                  'h-7',
                  'hover:bg-input/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                <AppIcon name="schedule" className="shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{t('logs:dateRange.start')}</span>
              </button>
              <span className="text-xs text-muted-foreground">{t('logs:dateRange.to')}</span>
              <button
                type="button"
                aria-label={t('logs:dateRange.end')}
                className={cn(
                  'flex w-36 items-center gap-1.5 rounded-lg border border-border bg-input/30 px-2.5 text-xs transition-colors outline-none',
                  'h-7',
                  'hover:bg-input/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                <AppIcon name="schedule" className="shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{t('logs:dateRange.end')}</span>
              </button>
              <div className="ml-1 flex flex-wrap items-center gap-1">
                {presets.map((p) => (
                  <Button key={p.key} variant={preset === p.key ? 'default' : 'outline'} size="sm" onClick={() => setPreset(p.key)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {selects.map((sel) => (
              <Select key={sel.placeholder} value={sel.value} onValueChange={sel.set}>
                <SelectTrigger size="sm" className={sel.width}>
                  <SelectValue placeholder={sel.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{sel.all}</SelectItem>
                    {sel.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt.replace(/^__/, '')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPreset('all')
                selects.forEach((sel) => sel.set('all'))
              }}
            >
              {t('logs:filters.reset')}
            </Button>
          </div>

          <div data-group="active" className="flex shrink-0 items-start gap-2 whitespace-nowrap">
            <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}>
              {t('common:action.clear')}
            </Button>
          </div>

          <div data-group="passive" className="ml-auto flex shrink-0 items-center gap-2 self-end">
            <Button variant="ghost" size="icon-sm" aria-label={t('ui:columns.settings')}>
              <AppIcon name="auto_width" />
            </Button>
          </div>
        </div>

        {/* 表格 */}
        <div className="relative w-full overflow-x-hidden rounded-lg border border-border">
          <table data-slot="table" className="w-full caption-bottom text-xs leading-5 table-fixed">
            <thead data-slot="table-header" className="[&_tr]:border-b">
              <tr data-slot="table-row" className="border-b border-border transition-colors">
                {columns.map((label, i) => (
                  <th
                    key={label}
                    data-slot="table-head"
                    className={`h-10 px-2 align-middle font-medium whitespace-nowrap text-foreground ${i === 0 ? 'pl-6' : ''} ${i === columns.length - 1 ? 'pr-6' : ''} text-left`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-slot="table-body" className="[&>tr:last-child]:border-0">
              {rows.map((row) => (
                <tr
                  key={row.time}
                  data-slot="table-row"
                  onClick={() => setSelected(row)}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-muted/50"
                >
                  <td data-slot="table-cell" className="p-2 pl-6 align-middle">
                    <div>{row.date}</div>
                    <div className="text-xs text-muted-foreground">{row.time}</div>
                  </td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">
                    {row.event ? (
                      <span className={toneClass[row.event.tone]}>{row.event.text}</span>
                    ) : (
                      <span className="text-muted-foreground">{row.source}</span>
                    )}
                  </td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.token}</td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.provider}</td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.model}</td>
                  <td data-slot="table-cell" className={`p-2 align-middle whitespace-normal break-words ${row.affinity ? toneClass[row.affinity.tone] : ''}`}>
                    {row.affinity?.text}
                  </td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.tokens}</td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words text-muted-foreground">
                    {row.stream ? 'SSE' : ''}
                  </td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.quota}</td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">
                    {row.latency ?? (row.event ? '—' : '')}
                  </td>
                  <td data-slot="table-cell" className="p-2 align-middle whitespace-normal break-words">{row.speed}</td>
                  <td
                    data-slot="table-cell"
                    className={`p-2 pr-6 align-middle whitespace-normal break-words ${row.status === 'success' ? 'text-success' : row.status === 'failed' ? 'text-destructive' : ''}`}
                  >
                    {row.status === 'success' ? t('logs:status.success') : row.status === 'failed' ? t('logs:status.failed') : row.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('ui:pagination.perPage')}</span>
            <Select value={limit} onValueChange={(v) => { setLimit(v); setOffset(0) }}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{t('ui:pagination.rows')}</span>
          </div>
          <div className="text-xs text-muted-foreground">{t('ui:pagination.pageOf', { page: currentPage, total: Math.ceil(TOTAL / Number(limit)) })}</div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="hidden lg:inline-flex"
              disabled={!hasPrev}
              aria-label={t('ui:pagination.first')}
              onClick={() => setOffset(0)}
            >
              <AppIcon name="first_page" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={!hasPrev}
              aria-label={t('ui:pagination.prev')}
              onClick={() => setOffset(Math.max(0, offset - Number(limit)))}
            >
              <AppIcon name="chevron_left" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={!hasNext}
              aria-label={t('ui:pagination.next')}
              onClick={() => setOffset(offset + Number(limit))}
            >
              <AppIcon name="chevron_right" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden lg:inline-flex"
              disabled={!hasNext}
              aria-label={t('ui:pagination.last')}
              onClick={() => setOffset(Math.max(0, (Math.ceil(TOTAL / Number(limit)) - 1) * Number(limit)))}
            >
              <AppIcon name="last_page" />
            </Button>
          </div>
        </div>
      </div>

      {/* 清空确认（真实页面的那颗弹窗） */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('logs:clear.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('logs:clear.description')}</DialogDescription>
          </DialogHeader>
          <DialogScrollBody
            footer={
              <>
                <Button variant="destructive-strong" size="sm" onClick={() => setClearOpen(false)}>
                  {t('logs:clear.filtered')}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setClearOpen(false)}>
                  {t('logs:clear.all')}
                </Button>
              </>
            }
          ></DialogScrollBody>
        </DialogContent>
      </Dialog>

      {/* 行详情（点表格行打开） */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>{t('logs:detail.title', { id: selected?.time.replaceAll(':', '') ?? '' })}</DialogTitle>
          </DialogHeader>
          {selected && <DetailFields row={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function PreviewApp() {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 64)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <PreviewSidebar />
      <SidebarInset className="overflow-hidden">
        <LogsPage />
      </SidebarInset>
    </SidebarProvider>
  )
}
