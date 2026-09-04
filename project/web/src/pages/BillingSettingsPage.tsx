import { PageHeader } from '@/components/PageHeader'
import { BillingSettings } from './BillingSettings'

export function BillingSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="币种汇率"
        description="配置金额展示与计费的币种、汇率及汇率来源接口"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BillingSettings />
      </div>
    </div>
  )
}
