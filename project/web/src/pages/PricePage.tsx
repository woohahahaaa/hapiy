import { PageHeader } from '@/components/PageHeader'

export function PricePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="价格配置" subtitle="Model pricing" />
      <div className="flex-1 p-6">
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed">
          <p className="text-muted-foreground">Price configuration will be here</p>
        </div>
      </div>
    </div>
  )
}
