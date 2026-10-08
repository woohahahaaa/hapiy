import type { ReactNode } from 'react'
import { AppIcon } from '@/components/AppIcon'

export interface NavSubItem {
  id: string
  labelKey: string
  href: string
}

export interface NavItem {
  id: string
  labelKey: string
  icon: ReactNode
  href?: string
  children?: NavSubItem[]
  // 外部静态页面（如帮助文档）：在新标签页打开，不进入 SPA 路由。
  external?: boolean
}

export const navigation: NavItem[] = [
  {
    id: 'topology',
    labelKey: 'nav.topology',
    icon: <AppIcon name="grid_view" />,
    href: '/',
  },
  {
    id: 'monitor',
    labelKey: 'nav.monitor',
    icon: <AppIcon name="monitoring" />,
    children: [
      { id: 'activity', labelKey: 'nav.activity', href: '/monitor' },
      { id: 'logs', labelKey: 'nav.logs', href: '/logs' },
      { id: 'capture', labelKey: 'nav.capture', href: '/logs/capture' },
    ],
  },
  {
    id: 'llm-config',
    labelKey: 'nav.llmConfig',
    icon: <AppIcon name="layers" />,
    children: [
      { id: 'token', labelKey: 'nav.token', href: '/token' },
      { id: 'provider', labelKey: 'nav.provider', href: '/provider' },
    ],
  },
  {
    id: 'policy',
    labelKey: 'nav.policy',
    icon: <AppIcon name="description" />,
    children: [
      { id: 'rewrite', labelKey: 'nav.rewrite', href: '/policy/rewrite' },
      { id: 'rewrite-response', labelKey: 'nav.rewriteResponse', href: '/policy/rewrite-response' },
      { id: 'channel-affinity', labelKey: 'nav.channelAffinity', href: '/channel-affinity' },
      { id: 'failover', labelKey: 'nav.failover', href: '/policy/failover' },
    ],
  },
  {
    id: 'agent',
    labelKey: 'nav.agent',
    icon: <AppIcon name="robot" />,
    href: '/agent',
    children: [
      { id: 'agent-config', labelKey: 'nav.agentConfig', href: '/agent/config' },
    ],
  },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    icon: <AppIcon name="settings" />,
    children: [
      { id: 'base-url', labelKey: 'nav.baseUrl', href: '/settings/base-url' },
      { id: 'general', labelKey: 'nav.general', href: '/settings/general' },
      { id: 'billing', labelKey: 'nav.billing', href: '/settings/billing' },
      { id: 'token-usage', labelKey: 'nav.tokenUsage', href: '/settings/token-usage' },
      { id: 'backup', labelKey: 'nav.backup', href: '/settings/backup' },
      // Debug 只在 dev 模式（Vite 开发服务器）显示；生产构建里整项隐藏。
      ...(import.meta.env.DEV
        ? [{ id: 'debug', labelKey: 'nav.debug', href: '/settings/debug' }]
        : []),
    ],
  },
  {
    id: 'profile',
    labelKey: 'nav.profile',
    icon: <AppIcon name="person" />,
    href: '/profile',
  },
  {
    id: 'help',
    labelKey: 'nav.help',
    icon: <AppIcon name="help" />,
    href: '/help',
    external: true,
  },
]

export function isPathActive(currentPath: string, href: string) {
  if (href === '/') return currentPath === '/'
  return currentPath === href || (href !== '/logs' && currentPath.startsWith(href + '/'))
}

/**
 * Resolve a route to the navigation label key so page headers reference the
 * same copy as the sidebar. Exact matches win over prefix matches, which keeps
 * /agent/config from resolving to its /agent parent.
 */
export function findNavLabelKey(pathname: string): string | undefined {
  const entries: { href: string; labelKey: string }[] = []
  for (const item of navigation) {
    for (const child of item.children ?? []) entries.push(child)
    if (item.href) entries.push({ href: item.href, labelKey: item.labelKey })
  }
  const exact = entries.find((entry) => entry.href === pathname)
  if (exact) return exact.labelKey
  return entries.find((entry) => isPathActive(pathname, entry.href))?.labelKey
}
