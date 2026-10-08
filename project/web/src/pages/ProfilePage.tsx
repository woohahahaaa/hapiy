import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
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
      toast.error(t('profile.usernameEmpty'))
      return
    }
    setSavingUsername(true)
    try {
      const user = await dashboardApi.updateUsername(nextUsername)
      setUsername(user.username)
      updateReadyUser(user)
      toast(t('profile.usernameUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profile.usernameUpdateFailed'))
    } finally {
      setSavingUsername(false)
    }
  }

  const handlePasswordSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentPassword || !newPassword || !passwordConfirmation) {
      toast.error(t('profile.passwordFieldsRequired'))
      return
    }
    if (newPassword.length < 8) {
      toast.error(t('profile.passwordTooShort'))
      return
    }
    if (newPassword !== passwordConfirmation) {
      toast.error(t('profile.passwordMismatch'))
      return
    }
    setSavingPassword(true)
    try {
      await dashboardApi.updatePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordConfirmation('')
      toast(t('profile.passwordUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profile.passwordUpdateFailed'))
    } finally {
      setSavingPassword(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await dashboardApi.logout()
    toast(t('profile.loggedOut'))
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('profile.pageDescription')}
      />
      <div className="flex-1 space-y-6 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('profile.loading')}
          </div>
        )}

        {state.kind === 'error' && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AppIcon name="warning" size={32} className="text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={load}>
                <AppIcon name="refresh" data-icon="inline-start" /> {t('common:action.retry')}
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
              {t('profile.logout')}
            </Button>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AppIcon name="shield" size={16} /> {t('profile.securityTitle')}
                </CardTitle>
                <CardDescription>{t('profile.securityDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <form className="space-y-3" onSubmit={handleUsernameSave}>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-username">
                    {t('profile.usernameLabel')}
                    <Input
                      id="profile-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      disabled={savingUsername}
                    />
                  </label>
                  <Button type="submit" disabled={savingUsername}>
                    {savingUsername && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    {t('profile.saveUsername')}
                  </Button>
                </form>
                <form className="space-y-3" onSubmit={handlePasswordSave}>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-current-password">
                    {t('profile.currentPasswordLabel')}
                    <Input
                      id="profile-current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      disabled={savingPassword}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-new-password">
                    {t('profile.newPasswordLabel')}
                    <Input
                      id="profile-new-password"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={savingPassword}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm" htmlFor="profile-password-confirmation">
                    {t('profile.confirmPasswordLabel')}
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
                    {t('profile.savePassword')}
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
