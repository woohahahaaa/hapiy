import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/wooh/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GeneralSettings } from './GeneralSettings'
import { TokenUsageSettings } from './TokenUsageSettings'
import { BillingSettings } from './BillingSettings'

// 「高级查询」：模型列表 / Token用量 / 币种汇率合并页，Tab 样式与「故障转移」一致。
export function AdvancedQuerySettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('advancedQuery.pageDescription')}
      />
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="model-list" className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="mb-5 !h-[50px] w-full justify-start gap-6 border-b border-border p-0">
            <TabsTrigger value="model-list" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('common:nav.general')}</TabsTrigger>
            <TabsTrigger value="token-usage" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('common:nav.tokenUsage')}</TabsTrigger>
            <TabsTrigger value="billing" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">{t('common:nav.billing')}</TabsTrigger>
          </TabsList>
          <TabsContent value="model-list" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="token-usage" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <TokenUsageSettings />
          </TabsContent>
          <TabsContent value="billing" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <BillingSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
