import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import { DEFAULT_TOKEN_USAGE_FIELDS, parseTokenUsageFields, type TokenUsageFields } from '@/lib/token-usage-fields'

const TOKEN_USAGE_FIELDS_KEY = 'token_usage_fields'

const FIELD_GROUPS: readonly { key: keyof TokenUsageFields; label: string; hint: string }[] = [
  { key: 'prompt_tokens', label: '输入', hint: '输入 tokens（prompt tokens）' },
  { key: 'cache_write_tokens', label: '缓存写入', hint: '写入缓存的 tokens' },
  { key: 'cache_read_tokens', label: '缓存读取', hint: '命中缓存的 tokens' },
  { key: 'completion_tokens', label: '输出', hint: '输出 tokens（completion tokens）' },
]

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

export function TokenUsageSettingsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [draft, setDraft] = useState<TokenUsageFields>(DEFAULT_TOKEN_USAGE_FIELDS)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        setDraft(parseTokenUsageFields(settingsValue(settings, TOKEN_USAGE_FIELDS_KEY)))
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        setState({ kind: 'error', message: err instanceof DashboardApiError ? err.message : '获取设置失败' })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const updateGroup = (group: keyof TokenUsageFields, paths: readonly string[]) => {
    setDraft((prev) => ({ ...prev, [group]: paths }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await dashboardApi.updateSetting(TOKEN_USAGE_FIELDS_KEY, JSON.stringify(draft))
      toast('已保存')
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Token 用量字段"
        description="配置从上游响应体读取 token 用量的字段路径（gjson），按顺序尝试，命中即停"
      />
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AppIcon name="key" size={16} /> 字段路径配置
            </CardTitle>
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
                <Button variant="outline" size="sm" onClick={load}>
                  <AppIcon name="refresh" data-icon="inline-start" /> 重试
                </Button>
              </div>
            )}

            {state.kind === 'ready' && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4">
                  {FIELD_GROUPS.map((group) => {
                    const paths = draft[group.key]
                    return (
                      <div key={group.key} className="flex flex-col gap-2">
                        <div>
                          <div className="text-sm font-medium">{group.label}</div>
                          <div className="text-xs text-muted-foreground">{group.hint}</div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {paths.map((path, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input
                                value={path}
                                onChange={(e) => {
                                  const next = [...paths]
                                  next[i] = e.target.value
                                  updateGroup(group.key, next)
                                }}
                                placeholder="gjson 路径，如 usage.prompt_tokens"
                                className="font-mono text-xs"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => updateGroup(group.key, paths.filter((_, idx) => idx !== i))}
                                title="删除此路径"
                              >
                                <AppIcon name="delete" size={14} />
                              </Button>
                            </div>
                          ))}
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateGroup(group.key, [...paths, ''])}
                            >
                              + 添加路径
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  保存后即时生效：系统记录请求的 token 用量时，将从这些路径依次读取四个计数（输入 / 缓存写入 / 缓存读取 / 输出）。
                </p>

                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => setDraft(DEFAULT_TOKEN_USAGE_FIELDS)}>
                    恢复默认
                  </Button>
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving && <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" />}
                    保存
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
