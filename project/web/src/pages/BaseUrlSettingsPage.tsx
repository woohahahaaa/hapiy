import { PageHeader } from '@/components/PageHeader'
import { BaseUrlSettings } from './BaseUrlSettings'

export function BaseUrlSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="BaseURL"
        description="为 BaseURL 后追加 __来源名 段即可标记请求来源，系统会按该规则自动识别"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BaseUrlSettings />
      </div>
    </div>
  )
}
