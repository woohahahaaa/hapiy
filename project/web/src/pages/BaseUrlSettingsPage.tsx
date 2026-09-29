import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { BaseUrlSettings } from './BaseUrlSettings'

export function BaseUrlSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="BaseURL"
        description={t('page.baseUrlDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BaseUrlSettings />
      </div>
    </div>
  )
}
