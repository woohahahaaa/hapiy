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

const MAX_PATH_LEN = 32

function isValidPathName(name: string): boolean {
  return !name.includes('/') && !name.includes('__') && name.length <= MAX_PATH_LEN
}

export function BaseUrlSettings() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [suffixValue, setSuffixValue] = useState('')
  const [paths, setPaths] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([dashboardApi.getSettings(), dashboardApi.getBaseUrlPaths()])
      .then(([settings, savedPaths]) => {
        const suffix = settings.find((s) => s.key === BASE_URL_SUFFIX_KEY)
        setSuffixValue(suffix?.value ?? '')
        setPaths([...savedPaths])
        setState({ kind: 'ready' })
      })
      .catch((err) => {
        const message = err instanceof DashboardApiError ? err.message : '获取设置失败'
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

  const origin = useMemo(() => window.location.origin, [])
  const baseUrl = `${origin}/${suffixValue || 'proxy'}`
  const fullUrlFor = (name: string) => `${baseUrl}/__${name}`

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast('已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  const updatePath = (index: number, value: string) => {
    setPaths((current) => current.map((p, i) => (i === index ? value : p)))
  }

  const removePath = (index: number) => {
    setPaths((current) => current.filter((_, i) => i !== index))
  }

  const addPath = () => {
    setPaths((current) => [...current, ''])
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const invalid = paths.find((p) => p.trim() !== '' && !isValidPathName(p.trim()))
    if (invalid) {
      toast.error(`来源名 "${invalid.trim()}" 无效：不能包含 / 或 __，且长度不超过 ${MAX_PATH_LEN}`)
      return
    }
    setSaving(true)
    try {
      const cleaned = paths.map((p) => p.trim()).filter((p) => p !== '')
      await Promise.all([
        dashboardApi.updateSetting(BASE_URL_SUFFIX_KEY, suffixValue),
        dashboardApi.replaceBaseUrlPaths(cleaned),
      ])
      setPaths(cleaned)
      toast('已保存')
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : '保存设置失败'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="link" size={16} /> BaseURL
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
              <Input value={origin} readOnly disabled />
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
              <span>最终 BaseURL</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                  {baseUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyUrl(baseUrl)}
                  disabled={saving}
                >
                  <AppIcon name="content_copy" size={14} /> 复制
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5 text-sm">
              <span>标记来源</span>
              <p className="text-xs text-muted-foreground">
                在 BaseURL 后追加 <code>__来源名</code> 段即可标记请求来源，系统会按该规则自动识别，无需预先登记。
                也可以不使用来源标记，直接以「最终 BaseURL」作为接入地址，系统同样会正常转发。
                下面登记的来源仅用于生成并复制完整地址，方便配置 Agent 时直接粘贴。
              </p>
              {paths.map((p, index) => {
                const name = p.trim()
                return (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={p}
                      onChange={(event) => updatePath(index, event.target.value)}
                      disabled={saving}
                      placeholder="来源名，如 ABC"
                      className="w-36 shrink-0"
                    />
                    <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                      {name ? fullUrlFor(name) : `${baseUrl}/__…`}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyUrl(fullUrlFor(name))}
                      disabled={saving || !name}
                    >
                      <AppIcon name="content_copy" size={14} /> 复制
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePath(index)}
                      disabled={saving}
                      aria-label="删除该路径"
                    >
                      <AppIcon name="delete" size={14} />
                    </Button>
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPath}
                disabled={saving}
              >
                      <AppIcon name="add" size={14} /> 添加来源
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              请求示例：<code>{baseUrl}/__来源/v1/chat/completions</code>
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
