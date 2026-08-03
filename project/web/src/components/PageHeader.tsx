import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'

interface PageHeaderProps {
  title: string
  status?: string
  actions?: ReactNode
}

export function PageHeader({ title, status, actions }: PageHeaderProps) {
  return (
    <div className="bg-card">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {status && (
              <p className="text-xs text-muted-foreground">{status}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <Separator />
    </div>
  )
}
