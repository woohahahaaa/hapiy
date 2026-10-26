// 首次配置预览页（onboarding.html）：只做界面与交互流程，不接后端、不进路由。
// 流程：填 Base URL + Key → 拉模型列表（失败转手动输入）→ 选至少一个模型 → 完成。
// 拉取模型是本地 mock，靠右下角「预览控制」切换成功/失败两种结果。
import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'

import '@/index.css'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Step = 1 | 2 | 3

type PreviewMode = 'success' | 'failure'

const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
]

// mockModels 让预览里的「获取模型」看起来像真的：按 Base URL 猜测厂商，
// 返回一组合理的模型名，方便确认列表、搜索和多选的样子。
function mockModels(baseUrl: string): readonly string[] {
  const url = baseUrl.toLowerCase()
  if (url.includes('deepseek')) return ['deepseek-chat', 'deepseek-reasoner']
  if (url.includes('openai')) return ['gpt-4o', 'gpt-4o-mini', 'o3-mini']
  if (url.includes('openrouter')) return ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat']
  if (url.includes('anthropic') || url.includes('claude')) return ['claude-sonnet-4-5', 'claude-haiku-4-5']
  return ['gpt-4o-mini', 'deepseek-chat', 'qwen-max']
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || '未命名供应商'
  }
}

async function fetchModels(baseUrl: string, apiKey: string, mode: PreviewMode): Promise<readonly string[]> {
  await new Promise((resolve) => setTimeout(resolve, 900))
  if (mode === 'failure' || baseUrl.toLowerCase().includes('fail')) {
    throw new Error('上游返回 401：Key 无效，或该供应商不提供 /models 接口')
  }
  if (!apiKey.trim()) throw new Error('请先填写 API Key')
  return mockModels(baseUrl)
}

function StepDots({ step }: { readonly step: Step }) {
  const items = [
    { id: 1, label: '连接供应商' },
    { id: 2, label: '选择模型' },
  ]
  return (
    <div className="flex items-center gap-3">
      {items.map((item, index) => {
        const done = step > item.id
        const active = step === item.id
        return (
          <div key={item.id} className="flex items-center gap-2">
            {index > 0 && (
              <span className={cn('h-px w-10', step > index ? 'bg-primary' : 'bg-border')} aria-hidden />
            )}
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border text-[11px] font-medium transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary text-primary',
                !done && !active && 'border-border text-muted-foreground',
              )}
            >
              {done ? <AppIcon name="check" size={13} /> : item.id}
            </span>
            <span
              className={cn(
                'text-xs',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Alert({
  tone = 'error',
  title,
  children,
}: {
  readonly tone?: 'error' | 'warning'
  readonly title: string
  readonly children?: React.ReactNode
}) {
  const error = tone === 'error'
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs',
        error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-warning/30 bg-warning/5 text-warning',
      )}
    >
      <AppIcon name={error ? 'error' : 'warning'} size={15} className="mt-px shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 leading-5 opacity-90">{children}</div>}
      </div>
    </div>
  )
}

function ProviderStep({
  baseUrl,
  apiKey,
  name,
  error,
  onBaseUrl,
  onApiKey,
  onName,
  onFetched,
  onManual,
  onError,
  mode,
}: {
  readonly baseUrl: string
  readonly apiKey: string
  readonly name: string
  readonly error: string
  readonly onBaseUrl: (value: string) => void
  readonly onApiKey: (value: string) => void
  readonly onName: (value: string) => void
  readonly onFetched: (models: readonly string[]) => void
  readonly onManual: () => void
  readonly onError: (message: string) => void
  readonly mode: PreviewMode
}) {
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)

  const baseUrlOk = /^https?:\/\/\S+$/i.test(baseUrl.trim())
  const canFetch = baseUrlOk && apiKey.trim().length > 0 && !busy

  const runFetch = async () => {
    if (!canFetch) return
    setBusy(true)
    onError('')
    try {
      const models = await fetchModels(baseUrl.trim(), apiKey, mode)
      onFetched(models)
    } catch (err) {
      onError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="provider-name">
          供应商名称 <span className="font-normal text-muted-foreground">（可选）</span>
        </label>
        <Input
          id="provider-name"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder={baseUrl ? hostOf(baseUrl) : 'DeepSeek 官方'}
          className="h-10 text-sm"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="provider-base-url">
          Base URL
        </label>
        <Input
          id="provider-base-url"
          value={baseUrl}
          onChange={(event) => onBaseUrl(event.target.value)}
          placeholder="https://api.deepseek.com/v1"
          className="h-10 font-mono text-sm"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>常用：</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onBaseUrl(preset.baseUrl)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-muted hover:text-foreground"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="provider-key">
          API Key
        </label>
        <div className="relative">
          <Input
            id="provider-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => onApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runFetch()
            }}
            placeholder="sk-…"
            className="h-10 pr-16 font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            className="absolute inset-y-0 right-2 my-auto h-6 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          填到 <code className="rounded bg-muted px-1 py-0.5 font-mono">/v1</code> 这一级即可，不要带
          <code className="rounded bg-muted px-1 py-0.5 font-mono">/chat/completions</code>。Key 只保存在本机。
        </p>
      </div>

      {error && (
        <Alert title="自动获取模型失败">
          {error}。可以重试，或者直接进入下一步手动填写模型名称。
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button size="lg" variant="ghost" onClick={onManual}>
          手动填模型
        </Button>
        <Button size="lg" onClick={() => void runFetch()} disabled={!canFetch}>
          {busy ? (
            <>
              <AppIcon name="progress_activity" size={16} className="animate-spin" />
              正在获取模型…
            </>
          ) : (
            <>
              获取模型
              <AppIcon name="chevron_right" size={16} />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function ModelStep({
  providerName,
  baseUrl,
  fetched,
  manual,
  error,
  selected,
  onSelected,
  onManualInput,
  onBack,
  onDone,
}: {
  readonly providerName: string
  readonly baseUrl: string
  readonly fetched: readonly string[] | null
  readonly manual: boolean
  readonly error: string
  readonly selected: readonly string[]
  readonly onSelected: (models: readonly string[]) => void
  readonly onManualInput: () => void
  readonly onBack: () => void
  readonly onDone: () => void
}) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const draftRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const list = fetched ?? []
    const q = query.trim().toLowerCase()
    return q ? list.filter((model) => model.toLowerCase().includes(q)) : list
  }, [fetched, query])

  const toggle = (model: string) => {
    onSelected(selected.includes(model) ? selected.filter((item) => item !== model) : [...selected, model])
  }

  const addDraft = () => {
    const value = draft.trim()
    if (!value) return
    if (!selected.includes(value)) onSelected([...selected, value])
    setDraft('')
    draftRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs">
        <AppIcon name="dns" size={14} className="text-muted-foreground" />
        <span className="font-medium">{providerName || hostOf(baseUrl)}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{baseUrl}</span>
        <span className="ms-auto rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
          OpenAI 兼容
        </span>
      </div>

      {error && (
        <Alert title="自动获取失败，改为手动填写" tone="warning">
          {error}。在下面输入模型名，按回车或逗号添加，也可以返回上一步重试。
        </Alert>
      )}

      {!manual ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              已获取 <span className="font-medium text-foreground">{(fetched ?? []).length}</span> 个模型，选择要启用的
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelected(filtered)}
              >
                全选
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelected([])}
              >
                清空
              </button>
            </div>
          </div>

          <div className="relative">
            <AppIcon
              name="search"
              size={14}
              className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型"
              className="h-9 ps-8 text-xs"
              autoComplete="off"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的模型</div>
            )}
            {filtered.map((model) => {
              const checked = selected.includes(model)
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => toggle(model)}
                  aria-pressed={checked}
                  className={cn(
                    'flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left text-xs transition-colors last:border-b-0',
                    checked ? 'bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {checked && <AppIcon name="check" size={11} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{model}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">chat</span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              ref={draftRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  addDraft()
                }
              }}
              placeholder="deepseek-chat"
              className="h-9 font-mono text-xs"
              autoComplete="off"
            />
            <Button size="sm" variant="outline" className="h-9" onClick={addDraft} disabled={!draft.trim()}>
              <AppIcon name="add" size={14} />
              添加
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            回车或逗号添加，模型名要和控制台上游的写法完全一致。
          </p>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((model) => (
                <span
                  key={model}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 ps-2.5 pe-1 font-mono text-[11px]"
                >
                  {model}
                  <button
                    type="button"
                    aria-label={`移除 ${model}`}
                    onClick={() => onSelected(selected.filter((item) => item !== model))}
                    className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <AppIcon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && !manual && (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/20 p-2.5">
          {selected.map((model) => (
            <span
              key={model}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 ps-2.5 pe-1 font-mono text-[11px]"
            >
              {model}
              <button
                type="button"
                aria-label={`移除 ${model}`}
                onClick={() => onSelected(selected.filter((item) => item !== model))}
                className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <AppIcon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button size="lg" variant="ghost" onClick={onBack}>
          <AppIcon name="chevron_left" size={16} />
          上一步
        </Button>
        <div className="flex items-center gap-3">
          {!manual && (
            <button
              type="button"
              onClick={onManualInput}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              列表里没有？手动填
            </button>
          )}
          <Button size="lg" onClick={onDone} disabled={selected.length === 0}>
            完成配置
            {selected.length > 0 && <span className="text-primary-foreground/70">（{selected.length}）</span>}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DoneStep({
  providerName,
  baseUrl,
  models,
  onReset,
}: {
  readonly providerName: string
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly onReset: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <AppIcon name="check_circle" size={26} />
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">配置完成</h2>
        <p className="mt-1 text-xs text-muted-foreground">hapiy 已经可以转发请求了，接下来可以在控制台继续加供应商或调整拓扑。</p>
      </div>
      <div className="w-full rounded-xl border border-border text-left text-xs">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <span className="text-muted-foreground">供应商</span>
          <span className="font-medium">{providerName || hostOf(baseUrl)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <span className="text-muted-foreground">Base URL</span>
          <span className="truncate font-mono text-[11px]">{baseUrl}</span>
        </div>
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
          <span className="shrink-0 text-muted-foreground">模型</span>
          <div className="flex flex-wrap justify-end gap-1">
            {models.map((model) => (
              <span key={model} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">
                {model}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 pt-1">
        <Button variant="ghost" onClick={onReset}>
          重新体验
        </Button>
        <Button size="lg">
          进入控制台
          <AppIcon name="chevron_right" size={16} />
        </Button>
      </div>
    </div>
  )
}

function PreviewControls({
  mode,
  onMode,
}: {
  readonly mode: PreviewMode
  readonly onMode: (mode: PreviewMode) => void
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-60 rounded-xl border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <AppIcon name="tune" size={13} />
        预览控制（仅本地，不会保存）
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
        {(
          [
            ['success', '获取成功'],
            ['failure', '获取失败'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] transition-colors',
              mode === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => document.documentElement.classList.toggle('dark')}
        className="mt-2 w-full rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        切换深色 / 浅色
      </button>
    </div>
  )
}

function OnboardingPreview() {
  const [step, setStep] = useState<Step>(1)
  const [mode, setMode] = useState<PreviewMode>('success')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [fetched, setFetched] = useState<readonly string[] | null>(null)
  const [manual, setManual] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<readonly string[]>([])

  const providerName = name.trim() || hostOf(baseUrl)

  const reset = () => {
    setStep(1)
    setName('')
    setBaseUrl('')
    setApiKey('')
    setFetched(null)
    setManual(false)
    setError('')
    setSelected([])
  }

  const handleFetched = (models: readonly string[]) => {
    setFetched(models)
    setManual(false)
    setError('')
    setSelected(models.slice(0, 1))
    setStep(2)
  }

  const handleManual = () => {
    setManual(true)
    setStep(2)
  }

  const handleDone = () => setStep(3)

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 0)',
        backgroundSize: '22px 22px',
      }}
    >
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            h
          </span>
          <span className="text-sm font-semibold tracking-tight">hapiy</span>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
            首次配置
          </span>
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={reset}
        >
          跳过，稍后配置
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-28">
        <div className="w-full max-w-xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">把第一个模型接进来</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              hapiy 至少要有一个供应商和一个模型才能开始转发请求。填好这两项，大约一分钟。
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <StepDots step={step} />
              {step < 3 && <span className="text-[11px] text-muted-foreground">第 {step} / 2 步</span>}
            </div>
            <div className="px-6 py-6">
              {step === 1 && (
                <ProviderStep
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  name={name}
                  error={error}
                  onBaseUrl={setBaseUrl}
                  onApiKey={setApiKey}
                  onName={setName}
                  onFetched={handleFetched}
                  onManual={handleManual}
                  onError={setError}
                  mode={mode}
                />
              )}
              {step === 2 && (
                <ModelStep
                  providerName={providerName}
                  baseUrl={baseUrl}
                  fetched={fetched}
                  manual={manual}
                  error={error}
                  selected={selected}
                  onSelected={setSelected}
                  onManualInput={() => setManual(true)}
                  onBack={() => setStep(1)}
                  onDone={handleDone}
                />
              )}
              {step === 3 && (
                <DoneStep
                  providerName={providerName}
                  baseUrl={baseUrl}
                  models={selected}
                  onReset={reset}
                />
              )}
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Key 只保存在本机的 hapiy 配置里，不会上传到任何第三方。
          </p>
        </div>
      </main>

      <PreviewControls mode={mode} onMode={setMode} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnboardingPreview />
  </StrictMode>,
)
