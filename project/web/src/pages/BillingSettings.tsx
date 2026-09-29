import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { i18n } from '@/i18n/i18n'

const BILLING_CURRENCY_KEY = 'billing_currency'
const EXCHANGE_RATE_KEY = 'exchange_rate_usd_cny'
const EXCHANGE_API_URL_KEY = 'exchange_rate_api_url'
const EXCHANGE_AUTO_KEY = 'exchange_rate_auto_refresh'
const EXCHANGE_FIELD_KEY = 'exchange_rate_field'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

type BillingCurrency = 'USD' | 'CNY'

function settingsValue(settings: readonly { key: string; value: string }[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? ''
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : i18n.t('settings:errors.operationFailed')
}

export function BillingSettings() {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [currency, setCurrency] = useState<BillingCurrency>('CNY')
  const [rate, setRate] = useState('7.2')
  const [apiUrl, setApiUrl] = useState('https://open.er-api.com/v6/latest/USD')
  const [fieldPath, setFieldPath] = useState('rates.CNY')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingBilling, setSavingBilling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    { readonly kind: 'success'; readonly rate: number } | { readonly kind: 'error'; readonly message: string } | null
  >(null)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setCurrency(settingsValue(settings, BILLING_CURRENCY_KEY) === 'USD' ? 'USD' : 'CNY')
        setRate(settingsValue(settings, EXCHANGE_RATE_KEY) || '7.2')
        setApiUrl(settingsValue(settings, EXCHANGE_API_URL_KEY) || 'https://open.er-api.com/v6/latest/USD')
        setFieldPath(settingsValue(settings, EXCHANGE_FIELD_KEY) || 'rates.CNY')
        setAutoRefresh(settingsValue(settings, EXCHANGE_AUTO_KEY) !== 'false')
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : i18n.t('settings:errors.fetchSettingsFailed')
        setState({ kind: 'error', message })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    load()
  }

  const handleSaveBilling = async () => {
    const rateValue = Number(rate)
    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      toast.error(t('billing.rateMustBePositive'))
      return
    }
    setSavingBilling(true)
    try {
      await dashboardApi.updateSetting(BILLING_CURRENCY_KEY, currency)
      await dashboardApi.updateSetting(EXCHANGE_RATE_KEY, String(rateValue))
      toast(t('toast.saved'))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingBilling(false)
    }
  }

  const handleOpenExchangeDialog = () => {
    setTestResult(null)
    setSettingsOpen(true)
  }

  const handleTestExchange = async () => {
    const url = apiUrl.trim()
    if (!/^https?:\/\//.test(url)) {
      setTestResult({ kind: 'error', message: t('billing.invalidUrl') })
      return
    }
    const field = fieldPath.trim()
    if (!field) {
      setTestResult({ kind: 'error', message: t('billing.missingField') })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const rate = await dashboardApi.testExchangeRate(url, field)
      setTestResult({ kind: 'success', rate })
    } catch (err) {
      setTestResult({ kind: 'error', message: toErrorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  const handleSaveExchangeConfig = async () => {
    const url = apiUrl.trim()
    if (!/^https?:\/\//.test(url)) {
      setTestResult({ kind: 'error', message: t('billing.invalidUrl') })
      return
    }
    const field = fieldPath.trim()
    if (!field) {
      setTestResult({ kind: 'error', message: t('billing.missingField') })
      return
    }
    setRefreshing(true)
    setTestResult(null)
    try {
      await dashboardApi.updateSetting(EXCHANGE_API_URL_KEY, url)
      await dashboardApi.updateSetting(EXCHANGE_FIELD_KEY, field)
      await dashboardApi.updateSetting(EXCHANGE_AUTO_KEY, autoRefresh ? 'true' : 'false')
      try {
        const newRate = await dashboardApi.refreshExchangeRate()
        setRate(String(newRate))
        toast(t('billing.refreshedRate', { rate: newRate }))
      } catch (err) {
        const message = toErrorMessage(err)
        const savedButFailed = t('billing.savedButRefreshFailed', { message })
        setTestResult({ kind: 'error', message: savedButFailed })
        toast.error(savedButFailed)
      }
      setSettingsOpen(false)
    } catch (err) {
      const message = toErrorMessage(err)
      setTestResult({ kind: 'error', message })
      toast.error(message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      const newRate = await dashboardApi.refreshExchangeRate()
      setRate(String(newRate))
      toast(t('billing.refreshed', { rate: newRate }))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="sell" size={16} /> {t('common:nav.billing')}
          </CardTitle>
          <CardDescription>{t('billing.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('loading')}
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
              </Button>
            </div>
          )}

          {state.kind === 'ready' && (
            <div className="flex flex-col gap-5">
              <div className="grid gap-1.5 text-sm">
                <span>{t('billing.currencyLabel')}</span>
                <Select value={currency} onValueChange={(v) => setCurrency(v as BillingCurrency)}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={t('billing.currencyPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="CNY">{t('billing.currencyCny')}</SelectItem>
                      <SelectItem value="USD">{t('billing.currencyUsd')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('billing.currencyHint')}
                </p>
              </div>

              <div className="grid gap-1.5 text-sm">
                <span>{t('billing.rateLabel')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('billing.oneUsdEquals')}</span>
                  <Input
                    className="w-40"
                    type="number"
                    min={0}
                    step={0.0001}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    disabled={savingBilling || refreshing}
                  />
                  <span className="text-xs text-muted-foreground">{t('billing.currencyUnit')}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    title={t('billing.refreshTitle')}
                  >
                    <AppIcon name="refresh" data-icon="inline-start" className={refreshing ? 'animate-spin' : ''} />
                    {t('common:action.refresh')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={handleOpenExchangeDialog}
                    disabled={refreshing}
                    title={t('billing.exchangeDialogTitle')}
                    aria-label={t('billing.exchangeDialogTitle')}
                  >
                    <AppIcon name="settings" size={14} />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('billing.rateHint')}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleSaveBilling} disabled={savingBilling || refreshing}>
                  {savingBilling && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  {t('common:action.save')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>{t('billing.exchangeDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('billing.exchangeDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button onClick={handleSaveExchangeConfig} disabled={refreshing}>
                {refreshing && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                {t('billing.saveAndRefresh')}
              </Button>
            </>
          }>
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5 text-sm">
              <span>{t('billing.apiUrlLabel')}</span>
              <Input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://open.er-api.com/v6/latest/USD"
              />
              <p className="text-xs text-muted-foreground">
                {t('billing.apiUrlHint')}
              </p>
            </div>
            <div className="grid gap-1.5 text-sm">
              <span>{t('billing.fieldLabel')}</span>
              <Input
                value={fieldPath}
                onChange={(e) => setFieldPath(e.target.value)}
                placeholder={t('billing.fieldPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('billing.fieldHint')}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              {t('billing.autoRefreshLabel')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t('billing.autoRefreshHint')}
            </p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleTestExchange()}
                disabled={testing || refreshing}
              >
                {testing && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                {t('billing.testApi')}
              </Button>
              {testResult?.kind === 'success' && (
                <p role="status" className="text-xs text-emerald-600">
                  {t('billing.testSuccess', { rate: testResult.rate })}
                </p>
              )}
              {testResult?.kind === 'error' && (
                <p role="alert" className="text-xs text-destructive">{testResult.message}</p>
              )}
            </div>
          </div>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
