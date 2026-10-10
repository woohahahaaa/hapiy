import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { findNavLabelKey } from '@/config/navigation'

interface PageHeaderProps {
  title?: string
  description?: string
  status?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, status, actions }: PageHeaderProps) {
  const location = useLocation()
  const { t } = useTranslation('common')
  // 不传 title 时直接引用侧边栏菜单文案，避免页面和菜单各写一套。
  const navLabelKey = findNavLabelKey(location.pathname)
  const heading = title ?? (navLabelKey ? t(navLabelKey) : '')

  return (
    <div className="bg-card">
      <div className="px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {/* 移动端菜单入口：侧栏在手机上收成浮层，触发器需常驻页面头部 */}
            <SidebarTrigger className="-ml-1 h-10 w-10 shrink-0 md:hidden" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{heading}</h1>
              {(description || status) && (
                <p className="mt-1 hidden text-sm text-muted-foreground md:block">
                  {description}
                  {status && (
                    <>
                      {' '}
                      <span className="text-muted-foreground/80">[{status}]</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
      <Separator className="bg-border-subtle/60" />
    </div>
  )
}
