import { Badge } from '@/components/ui/badge'

interface PageHeaderProps {
  title: string
  subtitle?: string
  status?: string
}

export function PageHeader({ title, subtitle, status }: PageHeaderProps) {
  return (
    <div className="border-b bg-card px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {status && <Badge variant="secondary">{status}</Badge>}
      </div>
    </div>
  )
}
