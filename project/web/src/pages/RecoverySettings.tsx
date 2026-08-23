import { useEffect, useState, useCallback } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'

const RECOVERY_INTERVAL_KEY = 'automatic_disable_recovery_minutes'
const RECOVERY_TTFB_KEY = 'recovery_ttfb_seconds'

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

export function RecoverySettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [recoveryMinutes, setRecoveryMinutes] = useState('')
  const [recoveryTTFB, setRecoveryTTFB] = useState('')
  const [savingInterval, setSavingInterval] = useState(false)
  const [savingTTFB, setSavingTTFB] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setRecoveryMinutes(settingsValue(settings, RECOVERY_INTERVAL_KEY))
        setRecoveryTTFB(settingsValue(settings, RECOVERY_TTFB_KEY))
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

  const handleSaveInterval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const minutes = Number(recoveryMinutes)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error('时间间隔必须是非负数字')
      return
    }
    setSavingInterval(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_INTERVAL_KEY, String(minutes))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingInterval(false)
    }
  }

  const handleSaveTTFB = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const seconds = Number(recoveryTTFB)
    if (!Number.isFinite(seconds) || seconds < 0) {
      toast.error('首字超时必须是非负数字')
      return
    }
    setSavingTTFB(true)
    try {
      await dashboardApi.updateSetting(RECOVERY_TTFB_KEY, String(seconds))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSavingTTFB(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="refresh" size={16} /> 恢复自动禁用
          </CardTitle>
          <CardDescription>恢复自动禁用的供应商、BaseURL、Key 的时间间隔与恢复条件。</CardDescription>
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
            <div className="flex flex-col gap-5">
              <form className="flex flex-col gap-3" onSubmit={handleSaveInterval}>
                <label className="grid gap-1.5 text-sm" htmlFor="automatic-disable-recovery-minutes">
                  时间间隔（分钟）
                  <Input
                    id="automatic-disable-recovery-minutes"
                    className="w-40"
                    type="number"
                    min={0}
                    value={recoveryMinutes}
                    onChange={(event) => setRecoveryMinutes(event.target.value)}
                    disabled={savingInterval}
                    placeholder="1440"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  填 0 表示关闭自动恢复；填大于 0 的数字表示每隔 N 分钟检查一次被自动禁用的项，能恢复的会自动取消禁用。默认 1440 分钟（24 小时）。
                </p>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={savingInterval}>
                    {savingInterval && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存
                  </Button>
                </div>
              </form>

              <form className="flex flex-col gap-3" onSubmit={handleSaveTTFB}>
                <label className="grid gap-1.5 text-sm" htmlFor="recovery-ttfb-seconds">
                  首字响应需在 N 秒内（恢复条件）
                  <Input
                    id="recovery-ttfb-seconds"
                    className="w-40"
                    type="number"
                    min={0}
                    value={recoveryTTFB}
                    onChange={(event) => setRecoveryTTFB(event.target.value)}
                    disabled={savingTTFB}
                    placeholder="0"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  上游响应正常是必须条件。若此处填 0 或留空，则只看上游响应是否正常；若填大于 0，则首字响应也需在 N 秒内返回才算恢复（两个条件 AND）。
                </p>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={savingTTFB}>
                    {savingTTFB && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
