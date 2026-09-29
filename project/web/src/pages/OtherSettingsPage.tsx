import { PageHeader } from '@/components/PageHeader'
import { OtherSettings } from '@/components/OtherSettings'

export function OtherSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="开启接管Agent"
        description="开启后侧边栏显示「接管 Agent」入口，管理接管文件与规则"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <OtherSettings />
      </div>
    </div>
  )
}