import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { BillingSettings } from './BillingSettings'

export function BillingSettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('billing.pageDescription')}
      />
      <div className="flex-1 flex flex-col gap-6 p-6">
        <BillingSettings />
      </div>
    </div>
  )
}
