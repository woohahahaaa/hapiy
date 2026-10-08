import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
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
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{heading}</h1>
            {(description || status) && (
              <p className="mt-1 text-sm text-muted-foreground">
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
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <Separator className="bg-border-subtle/60" />
    </div>
  )
}
