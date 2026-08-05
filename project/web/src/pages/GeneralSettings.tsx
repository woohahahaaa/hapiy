import { useEffect, useState, useCallback } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'

const SETTING_KEY = 'default_model_list_endpoint'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

export function GeneralSettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        const setting = settings.find((s) => s.key === SETTING_KEY)
        setValue(setting?.value ?? '')
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
      toast.add({ title: '已保存' })
    } catch (err) {
      const message =
        err instanceof DashboardApiError ? err.message : '保存设置失败'
      toast.add({ title: message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
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
  )
}
