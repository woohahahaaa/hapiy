import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AppIcon } from '@/components/AppIcon'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'

interface LocationState {
  from?: string
}

export function LoginPage() {
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
      setError(err instanceof DashboardApiError ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <AppIcon name="lock" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">hapiy 控制台</h1>
            <p className="text-sm text-muted-foreground">登录以管理供应商、规则与价格配置</p>
          </div>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="login-username">用户名</FieldLabel>
            <Input
              id="login-username"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">密码</FieldLabel>
            <Input
              id="login-password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </Field>
        </FieldGroup>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting || !username.trim() || !password}>
          {submitting ? (
            <>
              <AppIcon name="progress_activity" size={16} className="animate-spin" /> 登录中…
            </>
          ) : (
            '登录'
          )}
        </Button>
      </form>
    </div>
  )
}