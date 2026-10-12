import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/wooh/PageHeader'
import { DebugSettings } from '@/components/wooh/DebugSettings'

export function DebugSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('debug.pageDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <DebugSettings />
      </div>
    </div>
  )
}