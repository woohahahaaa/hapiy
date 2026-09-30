import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'

interface PageHeaderProps {
  title: string
  description?: string
  status?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, status, actions }: PageHeaderProps) {
  return (
    <div className="bg-card">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
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
      <Separator className="bg-border-subtle" />
    </div>
  )
}
