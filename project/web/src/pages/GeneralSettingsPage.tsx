import { PageHeader } from '@/components/PageHeader'
import { GeneralSettings } from './GeneralSettings'

export function GeneralSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="通用设置"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <GeneralSettings />
      </div>
    </div>
  )
}
