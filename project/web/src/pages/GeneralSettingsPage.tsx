import { PageHeader } from '@/components/PageHeader'
import { GeneralSettings } from './GeneralSettings'

export function GeneralSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="查询Model"
        description="查询模型列表接口路径的默认配置"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <GeneralSettings />
      </div>
    </div>
  )
}
