import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { OtherSettings } from '@/components/OtherSettings'

export function OtherSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('other.title')}
        description={t('other.pageDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <OtherSettings />
      </div>
    </div>
  )
}