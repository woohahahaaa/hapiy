import { PageHeader } from '@/components/PageHeader'
import { OtherSettings } from '@/components/OtherSettings'

export function OtherSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="开启接管Agent"
        description="接管 Agent 相关设置"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <OtherSettings />
      </div>
    </div>
  )
}