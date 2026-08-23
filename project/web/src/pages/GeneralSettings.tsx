import { useEffect, useState, useCallback } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'

const DEFAULT_MODEL_LIST_ENDPOINT_KEY = 'default_model_list_endpoint'
const OWN_MODEL_LIST_ENDPOINT_KEY = 'own_model_list_endpoint'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

function settingsValue(settings: readonly { key: string; value: string }[], key: string): string {
  return settings.find((s) => s.key === key)?.value ?? ''
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : '操作失败，请重试'
}

function isValidPath(value: string): boolean {
  return value.startsWith('/')
}

export function GeneralSettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const [defaultEndpoint, setDefaultEndpoint] = useState('')
  const [savingDefault, setSavingDefault] = useState(false)

  const [ownEndpoint, setOwnEndpoint] = useState('')
  const [savingOwn, setSavingOwn] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setDefaultEndpoint(settingsValue(settings, DEFAULT_MODEL_LIST_ENDPOINT_KEY))
        setOwnEndpoint(settingsValue(settings, OWN_MODEL_LIST_ENDPOINT_KEY))
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

  const handleSaveDefault = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidPath(defaultEndpoint)) {
      toast.error('路径必须以斜杠开头（/）')
      return
    }
    setSavingDefault(true)
    try {
      await dashboardApi.updateSetting(DEFAULT_MODEL_LIST_ENDPOINT_KEY, defaultEndpoint)
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingDefault(false)
    }
  }

  const handleSaveOwn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidPath(ownEndpoint)) {
      toast.error('路径必须以斜杠开头（/）')
      return
    }
    setSavingOwn(true)
    try {
      await dashboardApi.updateSetting(OWN_MODEL_LIST_ENDPOINT_KEY, ownEndpoint)
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingOwn(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="cloud_download" size={16} /> 上游模型列表接口
          </CardTitle>
          <CardDescription>从供应商获取模型列表时的默认接口路径</CardDescription>
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
            <form className="flex flex-col gap-3" onSubmit={handleSaveDefault}>
              <label
                className="grid gap-1.5 text-sm"
                htmlFor="general-default-model-list-endpoint"
              >
                默认模型列表接口路径
                <Input
                  id="general-default-model-list-endpoint"
                  value={defaultEndpoint}
                  onChange={(event) => setDefaultEndpoint(event.target.value)}
                  disabled={savingDefault}
                  placeholder="/v1/models"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                路径必须以斜杠开头（/），将拼接在供应商的 Base URL 之后。当供应商表单中"从上游获取模型"未单独配置接口地址时，将使用此路径作为回退。
              </p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={savingDefault}>
                  {savingDefault && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
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
            <AppIcon name="database" size={16} /> hapiy 模型列表接口
          </CardTitle>
          <CardDescription>对外暴露的 hapiy 自身模型列表路径</CardDescription>
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
            <form className="flex flex-col gap-3" onSubmit={handleSaveOwn}>
              <label
                className="grid gap-1.5 text-sm"
                htmlFor="general-own-model-list-endpoint"
              >
                hapiy 模型列表接口路径
                <Input
                  id="general-own-model-list-endpoint"
                  value={ownEndpoint}
                  onChange={(event) => setOwnEndpoint(event.target.value)}
                  disabled={savingOwn}
                  placeholder="/models"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                路径必须以斜杠开头（/）。访问该路径时，hapiy 会以 OpenAI 兼容格式返回自身已知的模型列表（<code>{'{"data": [{"id", "object", "owned_by"}]}'}</code>），使用 Bearer Token 鉴权，调用方式与其他对外接口一致。
              </p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={savingOwn}>
                  {savingOwn && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                  保存
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
