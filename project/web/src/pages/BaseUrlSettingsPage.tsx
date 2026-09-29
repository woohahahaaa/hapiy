import { PageHeader } from '@/components/PageHeader'
import { BaseUrlSettings } from './BaseUrlSettings'

export function BaseUrlSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="BaseURL"
        description="在 BaseURL 后追加来源标记即可区分请求来源，系统自动识别"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BaseUrlSettings />
      </div>
    </div>
  )
}
