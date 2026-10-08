import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { GeneralSettings } from './GeneralSettings'

export function GeneralSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('general.pageDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <GeneralSettings />
      </div>
    </div>
  )
}
