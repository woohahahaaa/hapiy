import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, Shield, User as UserIcon, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Provider, Token } from '@/lib/dashboard-api'

type ProfileSummary = {
  readonly user: { readonly id: string; readonly username: string; readonly role: string }
  readonly providerCount: number
  readonly activeProviderCount: number
  readonly tokenCount: number
  readonly activeTokenCount: number
}

function summarizeUser(me: { id: string; username: string; role: string } | null) {
  return me ?? { id: 'admin', username: 'admin', role: 'admin' }
}

export function ProfilePage() {
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly message: string }
    | { readonly kind: 'ready'; readonly summary: ProfileSummary; readonly me: { id: string; username: string; role: string } | null }
  >({ kind: 'loading' })

  const load = async () => {
    setState({ kind: 'loading' })
    try {
      const [me, providers, tokens] = await Promise.all([
        dashboardApi.currentUser().catch(() => null),
        dashboardApi.listProviders() as Promise<readonly Provider[]>,
        dashboardApi.listTokens() as Promise<readonly Token[]>,
      ])
      const activeProviders = providers.filter((p) => p.status).length
      const activeTokens = tokens.filter((t) => t.status).length
      setState({
        kind: 'ready',
        me,
        summary: {
          user: summarizeUser(me),
          providerCount: providers.length,
          activeProviderCount: activeProviders,
          tokenCount: tokens.length,
          activeTokenCount: activeTokens,
        },
      })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof DashboardApiError ? err.message : (err as Error).message })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="个人资料"
        subtitle="Account information"
        status={state.kind === 'ready' ? state.summary.user.role : 'loading'}
      />
      <div className="flex-1 space-y-6 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在加载账户信息…
          </div>
        )}

        {state.kind === 'error' && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw data-icon="inline-start" /> 重试
              </Button>
            </CardContent>
          </Card>
        )}

        {state.kind === 'ready' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserIcon className="size-4" /> 账户信息
                </CardTitle>
                <CardDescription>当前登录用户及其角色</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Row label="用户名" value={state.summary.user.username} />
                <Row label="用户 ID" value={state.summary.user.id} mono />
                <Row label="角色" value={
                  <Badge variant={state.summary.user.role === 'admin' ? 'default' : 'secondary'}>
                    <Shield className="mr-1 size-3" /> {state.summary.user.role}
                  </Badge>
                } />
                <Row label="登录状态" value={
                  state.me === null ? <Badge variant="outline">本地默认</Badge> : <Badge>已登录</Badge>
                } />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="size-4" /> 资源概览
                </CardTitle>
                <CardDescription>当前账户可管理的渠道与令牌</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="渠道总数" value={state.summary.providerCount} />
                <Metric label="启用渠道" value={state.summary.activeProviderCount} />
                <Metric label="令牌总数" value={state.summary.tokenCount} />
                <Metric label="启用令牌" value={state.summary.activeTokenCount} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}
