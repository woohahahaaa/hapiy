import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { PageHeader } from '@/components/wooh/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'

const REVERSE_PROXY_DOMAINS_KEY = 'reverse_proxy_domains'
function errorMessage(error: unknown): string {
  if (error instanceof DashboardApiError) return error.message
  return error instanceof Error ? error.message : i18n.t('settings:errors.operationFailed')
}

export function ReverseProxySettingsPage() {
  const { t } = useTranslation('settings')
  const [domains, setDomains] = useState<string[]>([])
  const [input, setInput] = useState('')
  const load = useCallback(async () => {
    const settings = await dashboardApi.getSettings()
    const raw = settings.find((setting) => setting.key === REVERSE_PROXY_DOMAINS_KEY)?.value
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : []
      setDomains(Array.isArray(parsed) ? parsed.filter((domain): domain is string => typeof domain === 'string') : [])
    } catch { setDomains([]) }
  }, [])
  useEffect(() => { void load().catch((error) => toast.error(errorMessage(error))) }, [load])
  const save = async (next: string[]) => {
    try {
      await dashboardApi.updateSetting(REVERSE_PROXY_DOMAINS_KEY, JSON.stringify(next))
      setDomains(next)
      toast(t('reverseProxy.saved'))
    } catch (error) { toast.error(errorMessage(error)) }
  }
  const add = () => {
    const domain = input.trim()
    if (domain === '' || domains.includes(domain)) return
    void save([...domains, domain]).then(() => setInput(''))
  }
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t('reverseProxy.title')} description={t('reverseProxy.pageDescription')} />
      <div className="flex-1 flex flex-col gap-6 p-6"><Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AppIcon name="link" size={16} /> {t('reverseProxy.title')}</CardTitle><CardDescription>{t('reverseProxy.description')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2"><Input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && add()} placeholder={t('reverseProxy.placeholder')} /><Button variant="outline" onClick={add}><AppIcon name="add" data-icon="inline-start" /> {t('reverseProxy.add')}</Button></div>
          {domains.map((domain) => <div key={domain} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"><span className="break-all">{domain}</span><Button variant="ghost" size="sm" onClick={() => void save(domains.filter((item) => item !== domain))}>{t('reverseProxy.remove')}</Button></div>)}
        </CardContent>
      </Card></div>
    </div>
  )
}
