import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { DebugSettings } from '@/components/DebugSettings'

export function DebugSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('common:nav.debug')}
        description={t('debug.pageDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <DebugSettings />
      </div>
    </div>
  )
}