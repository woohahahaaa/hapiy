import { useEffect, useState, useCallback } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'

const SETTING_KEY = 'default_model_list_endpoint'
const BILLING_CURRENCY_KEY = 'billing_currency'
const EXCHANGE_RATE_KEY = 'exchange_rate_usd_cny'
const EXCHANGE_API_URL_KEY = 'exchange_rate_api_url'
const EXCHANGE_AUTO_KEY = 'exchange_rate_auto_refresh'

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
  return err instanceof Error ? err.message : '操作失败，请重试'
}

export function GeneralSettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [currency, setCurrency] = useState<BillingCurrency>('CNY')
  const [rate, setRate] = useState('7.2')
  const [apiUrl, setApiUrl] = useState('https://open.er-api.com/v6/latest/USD')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingBilling, setSavingBilling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setValue(settingsValue(settings, SETTING_KEY))
        setCurrency(settingsValue(settings, BILLING_CURRENCY_KEY) === 'USD' ? 'USD' : 'CNY')
        setRate(settingsValue(settings, EXCHANGE_RATE_KEY) || '7.2')
        setApiUrl(settingsValue(settings, EXCHANGE_API_URL_KEY) || 'https://open.er-api.com/v6/latest/USD')
        setAutoRefresh(settingsValue(settings, EXCHANGE_AUTO_KEY) !== 'false')
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message =
          err instanceof DashboardApiError ? err.message : '获取设置失败'
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      await dashboardApi.updateSetting(SETTING_KEY, value)
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveBilling = async () => {
    const rateValue = Number(rate)
    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      toast.error('汇率必须大于 0')
      return
    }
    setSavingBilling(true)
    try {
      await dashboardApi.updateSetting(BILLING_CURRENCY_KEY, currency)
      await dashboardApi.updateSetting(EXCHANGE_RATE_KEY, String(rateValue))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingBilling(false)
    }
  }

  const handleOpenExchangeDialog = () => {
    setSettingsOpen(true)
  }

  const handleSaveExchangeConfig = async () => {
    const url = apiUrl.trim()
    if (!/^https?:\/\//.test(url)) {
      toast.error('接口地址必须以 http:// 或 https:// 开头')
      return
    }
    setRefreshing(true)
    try {
      await dashboardApi.updateSetting(EXCHANGE_API_URL_KEY, url)
      await dashboardApi.updateSetting(EXCHANGE_AUTO_KEY, autoRefresh ? 'true' : 'false')
      try {
        const newRate = await dashboardApi.refreshExchangeRate()
        setRate(String(newRate))
        toast(`已刷新汇率：1 美元 = ${newRate} 人民币`)
      } catch (err) {
        toast.error(`接口配置已保存，但刷新失败：${toErrorMessage(err)}`)
      }
      setSettingsOpen(false)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      const newRate = await dashboardApi.refreshExchangeRate()
      setRate(String(newRate))
      toast(`已刷新：1 美元 = ${newRate} 人民币`)
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="tune" size={16} /> 通用设置
          </CardTitle>
          <CardDescription>系统级默认配置</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> 正在加载设置…
            </div>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <AppIcon name="refresh" data-icon="inline-start" /> 重试
              </Button>
            </div>
          )}

          {state.kind === 'ready' && (
            <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
              <label
                className="grid gap-1.5 text-sm"
                htmlFor="general-default-model-list-endpoint"
              >
                默认模型列表接口路径
                <Input
                  id="general-default-model-list-endpoint"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  disabled={saving}
                  placeholder="/v1/models"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                路径必须以斜杠开头（/），将拼接在供应商的 Base URL 之后。当供应商表单中"从上游获取模型"未单独配置接口地址时，将使用此路径作为回退。
              </p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  保存
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="sell" size={16} /> 全局消耗统计
          </CardTitle>
          <CardDescription>使用记录、模型信息等所有金额展示与计费的币种与汇率</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === 'ready' && (
            <div className="flex flex-col gap-5">
              <div className="grid gap-1.5 text-sm">
                <span>全局消耗统计币种</span>
                <Select value={currency} onValueChange={(v) => setCurrency(v as BillingCurrency)}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="选择币种" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="CNY">人民币 (CNY)</SelectItem>
                      <SelectItem value="USD">美元 (USD)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  切换币种后，历史使用记录保持落库时的币种与金额不变，仅影响新产生的记录。
                </p>
              </div>

              <div className="grid gap-1.5 text-sm">
                <span>汇率</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">1 美元 =</span>
                  <Input
                    className="w-40"
                    type="number"
                    min={0}
                    step={0.0001}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    disabled={savingBilling || refreshing}
                  />
                  <span className="text-xs text-muted-foreground">人民币</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    title="在线获取最新汇率"
                  >
                    <AppIcon name="refresh" data-icon="inline-start" className={refreshing ? 'animate-spin' : ''} />
                    刷新
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  点击「刷新」可在线获取最新汇率，或点击
                  <button
                    type="button"
                    className="mx-1 text-foreground underline underline-offset-2"
                    onClick={handleOpenExchangeDialog}
                  >
                    接口设置
                  </button>
                  配置汇率来源接口与自动刷新。
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleSaveBilling} disabled={savingBilling || refreshing}>
                  {savingBilling && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent width="sm">
          <DialogHeader>
            <DialogTitle>汇率接口设置</DialogTitle>
            <DialogDescription>配置在线获取人民币兑美元汇率的接口</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">
                这是一个通过 GET 方法可以请求到的地址，返回的 JSON 中需包含人民币汇率字段（例如 rates.CNY 或 conversion_rates.CNY）。
              </span>
              <span>接口地址</span>
              <Input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://open.er-api.com/v6/latest/USD"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              每天自动刷新
            </label>
            <p className="text-xs text-muted-foreground">
              勾选后每天自动从接口获取最新汇率；若某次自动刷新失败，会在半小时后自动重试。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={refreshing}>
              取消
            </Button>
            <Button onClick={handleSaveExchangeConfig} disabled={refreshing}>
              {refreshing && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
              保存并刷新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
