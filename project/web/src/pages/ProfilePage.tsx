import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { CurrentUser } from '@/lib/dashboard-api'

type AccountUser = { readonly id: string; readonly username: string; readonly role: string }

export function ProfilePage() {
  const navigate = useNavigate()
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly message: string }
    | { readonly kind: 'ready'; readonly me: AccountUser }
  >({ kind: 'loading' })
  const [username, setUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const load = async () => {
    setState({ kind: 'loading' })
    try {
      const me = await dashboardApi.currentUser() as AccountUser
      setState({ kind: 'ready', me })
      setUsername(me.username)
    } catch (err) {
      setState({ kind: 'error', message: err instanceof DashboardApiError ? err.message : (err as Error).message })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const updateReadyUser = (user: CurrentUser) => {
    setState((previous) => previous.kind === 'ready'
      ? { ...previous, me: user }
      : previous)
  }

  const handleUsernameSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextUsername = username.trim()
    if (!nextUsername) {
      toast.error('用户名不能为空')
      return
    }
    setSavingUsername(true)
    try {
      const user = await dashboardApi.updateUsername(nextUsername)
      setUsername(user.username)
      updateReadyUser(user)
      toast('用户名已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新用户名失败')
    } finally {
      setSavingUsername(false)
    }
  }

  const handlePasswordSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentPassword || !newPassword || !passwordConfirmation) {
      toast.error('请填写所有密码字段')
      return
    }
    if (newPassword.length < 8) {
      toast.error('新密码至少需要 8 个字符')
      return
    }
    if (newPassword !== passwordConfirmation) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setSavingPassword(true)
    try {
      await dashboardApi.updatePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordConfirmation('')
      toast('密码已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新密码失败')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await dashboardApi.logout()
    toast('已退出登录')
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="个人资料"
        description="管理账户信息与修改登录密码"
      />
      <div className="flex-1 space-y-6 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AppIcon name="progress_activity" size={16} className="animate-spin" /> 正在加载账户信息…
          </div>
        )}

        {state.kind === 'error' && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={load}>
                <AppIcon name="refresh" data-icon="inline-start" /> 重试
              </Button>
            </CardContent>
          </Card>
        )}

        {state.kind === 'ready' && (
          <>
            <Button
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />
              ) : (
                <AppIcon name="logout" data-icon="inline-start" />
              )}
              退出登录
            </Button>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AppIcon name="shield" size={16} /> 安全设置
                </CardTitle>
                <CardDescription>更新登录用户名和密码</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <form className="space-y-3" onSubmit={handleUsernameSave}>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-username">
                    用户名
                    <Input
                      id="profile-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      disabled={savingUsername}
                    />
                  </label>
                  <Button type="submit" disabled={savingUsername}>
                    {savingUsername && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存用户名
                  </Button>
                </form>
                <form className="space-y-3" onSubmit={handlePasswordSave}>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-current-password">
                    当前密码
                    <Input
                      id="profile-current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      disabled={savingPassword}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-new-password">
                    新密码
                    <Input
                      id="profile-new-password"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={savingPassword}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-password-confirmation">
                    确认新密码
                    <Input
                      id="profile-password-confirmation"
                      type="password"
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                      disabled={savingPassword}
                    />
                  </label>
                  <Button type="submit" disabled={savingPassword}>
                    {savingPassword && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存密码
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
