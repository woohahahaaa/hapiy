import { PageHeader } from '@/components/PageHeader'
import { RecoverySettings } from './RecoverySettings'

export function RecoverySettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="恢复自动禁用"
        description="配置自动禁用供应商、BaseURL、Key 的恢复时间间隔"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <RecoverySettings />
      </div>
    </div>
  )
}
