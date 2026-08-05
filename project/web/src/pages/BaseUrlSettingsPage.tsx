import { PageHeader } from '@/components/PageHeader'
import { BaseUrlSettings } from './BaseUrlSettings'

export function BaseUrlSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="BaseURL 配置"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BaseUrlSettings />
      </div>
    </div>
  )
}
