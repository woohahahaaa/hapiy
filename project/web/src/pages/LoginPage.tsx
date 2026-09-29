import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/AppIcon'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as LocationState | null)?.from ?? '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await dashboardApi.login(username.trim(), password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof DashboardApiError ? err.message : t('login.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-6">
        <div className="flex justify-center">
          <span className="font-hapiy-logo text-5xl leading-none tracking-tight text-foreground">
            hapiy
          </span>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-username">{t('login.usernameLabel')}</FieldLabel>
            <Input
              id="login-username"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('login.usernamePlaceholder')}
              disabled={submitting}
              className="rounded-none"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">{t('login.passwordLabel')}</FieldLabel>
            <Input
              id="login-password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              disabled={submitting}
              className="rounded-none"
            />
          </Field>
        </FieldGroup>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full shadow-none"
          disabled={submitting || !username.trim() || !password}
        >
          {submitting ? (
            <>
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> {t('login.submitting')}
            </>
          ) : (
            t('login.submit')
          )}
        </Button>
      </form>
    </div>
  )
}
