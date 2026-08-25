import { PageHeader } from '@/components/PageHeader'
import { DebugSettings } from '@/components/DebugSettings'

export function DebugSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Debug"
        description="调试与排查开关"
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <DebugSettings />
      </div>
    </div>
  )
}