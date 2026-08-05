import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'

const BASE_URL_SUFFIX_KEY = 'base_url_suffix'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

export function BaseUrlSettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [suffixValue, setSuffixValue] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        const suffix = settings.find((s) => s.key === BASE_URL_SUFFIX_KEY)
        setSuffixValue(suffix?.value ?? '')
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
      await dashboardApi.updateSetting(BASE_URL_SUFFIX_KEY, suffixValue)
      toast.add({ title: '已保存' })
    } catch (err) {
      const message =
        err instanceof DashboardApiError ? err.message : '保存设置失败'
      toast.add({ title: message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const hostname = useMemo(() => window.location.hostname, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AppIcon name="link" size={16} /> BaseURL 配置
        </CardTitle>
        <CardDescription>配置系统的对外 BaseURL，用于 Agent 软件接入</CardDescription>
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
            <div className="grid gap-1.5 text-sm">
              <span>域名</span>
              <Input value={hostname} readOnly disabled />
              <p className="text-xs text-muted-foreground">
                自动取当前网页域名，不可修改（公网反代或局域网地址均可）
              </p>
            </div>
            <label className="grid gap-1.5 text-sm" htmlFor="base-url-suffix">
              后缀
              <Input
                id="base-url-suffix"
                value={suffixValue}
                onChange={(event) => setSuffixValue(event.target.value)}
                disabled={saving}
                placeholder="proxy"
              />
            </label>
            <div className="grid gap-1.5 text-sm">
              <span>拼接预览</span>
              <code className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-mono">
                {hostname}/{suffixValue || 'proxy'}
              </code>
            </div>
            <p className="text-xs text-muted-foreground">
              Agent 软件将以此地址作为 BaseURL。如需标记请求来源，可在路径中插入 <code>__来源</code> 段：
              <br />· <code>{hostname}/{suffixValue || 'proxy'}/__来源/v1/chat/completions</code>
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
