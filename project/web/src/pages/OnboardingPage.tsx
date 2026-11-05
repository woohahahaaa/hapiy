import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dashboardApi,
  DashboardApiError,
  type FetchedModel,
  type ProviderModel,
} from '@/lib/dashboard-api'
import { joinModelListUrl } from '@/lib/provider-fetch'
import {
  ONBOARDING_SKIPPED_SETTING_KEY,
  shouldShowOnboarding,
} from '@/lib/onboarding'
import { cn } from '@/lib/utils'

type Step = 1 | 2 | 3

const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
] as const

const DEFAULT_MODEL_LIST_ENDPOINT = '/v1/models'

function hostOf(baseUrl: string, fallback: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0] || fallback
  }
}

function emptyModel(model: string): ProviderModel {
  return {
    model,
    endpoints: [],
    rate: '1',
    ratePriceConfigId: null,
    referenceProvider: null,
    referencePrices: null,
    referenceAt: null,
    prices: null,
  }
}

function StepDots({ step }: { readonly step: Step }) {
  const { t } = useTranslation('onboarding')
  const items = [
    { id: 1, label: t('steps.provider') },
    { id: 2, label: t('steps.models') },
  ]
  return (
    <div className="flex items-center gap-3">
      {items.map((item, index) => {
        const done = step > item.id
        const active = step === item.id
        return (
          <div key={item.id} className="flex items-center gap-2">
            {index > 0 && (
              <span
                className={cn(
                  'h-px w-10',
                  step > index ? 'bg-primary' : 'bg-border'
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border text-[11px] font-medium transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary text-primary',
                !done && !active && 'border-border text-muted-foreground'
              )}
            >
              {done ? <AppIcon name="check" size={13} /> : item.id}
            </span>
            <span
              className={cn(
                'text-xs',
                active ? 'font-medium text-foreground' : 'text-muted-foreground'
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
  readonly children?: ReactNode
}) {
  const error = tone === 'error'
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs',
        error
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-warning/30 bg-warning/5 text-warning'
      )}
    >
      <AppIcon
        name={error ? 'error' : 'warning'}
        size={15}
        className="mt-px shrink-0"
      />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {children && (
          <div className="mt-0.5 leading-5 opacity-90">{children}</div>
        )}
      </div>
    </div>
  )
}

function ProviderStep({
  baseUrl,
  apiKey,
  name,
  error,
  busy,
  onBaseUrl,
  onApiKey,
  onName,
  onFetch,
  onManual,
}: {
  readonly baseUrl: string
  readonly apiKey: string
  readonly name: string
  readonly error: string
  readonly busy: boolean
  readonly onBaseUrl: (value: string) => void
  readonly onApiKey: (value: string) => void
  readonly onName: (value: string) => void
  readonly onFetch: () => void
  readonly onManual: () => void
}) {
  const { t } = useTranslation('onboarding')
  const [showKey, setShowKey] = useState(false)

  const canFetch =
    baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !busy

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          className="text-xs font-medium"
          htmlFor="onboarding-provider-name"
        >
          {t('form.nameLabel')}{' '}
          <span className="font-normal text-muted-foreground">
            {t('form.optional')}
          </span>
        </label>
        <Input
          id="onboarding-provider-name"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder={
            baseUrl
              ? hostOf(baseUrl, t('unnamedProvider'))
              : t('form.namePlaceholder')
          }
          className="h-10 text-sm"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          className="text-xs font-medium"
          htmlFor="onboarding-provider-base-url"
        >
          {t('form.baseUrlLabel')}
        </label>
        <Input
          id="onboarding-provider-base-url"
          value={baseUrl}
          onChange={(event) => onBaseUrl(event.target.value)}
          placeholder={t('form.baseUrlPlaceholder')}
          className="h-10 font-mono text-sm"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t('form.presets')}</span>
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
        <label
          className="text-xs font-medium"
          htmlFor="onboarding-provider-key"
        >
          {t('form.apiKeyLabel')}
        </label>
        <div className="relative">
          <Input
            id="onboarding-provider-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => onApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFetch()
            }}
            placeholder={t('form.keyPlaceholder')}
            className="h-10 pr-16 font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            className="absolute inset-y-0 right-2 my-auto h-6 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showKey ? t('form.hide') : t('form.show')}
          </button>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t('form.keyHint')}
        </p>
      </div>

      {error && (
        <Alert title={t('fetch.errorTitle')}>
          {t('fetch.errorHint', { message: error })}
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button size="lg" variant="ghost" onClick={onManual} disabled={busy}>
          {t('actions.manual')}
        </Button>
        <Button size="lg" onClick={onFetch} disabled={!canFetch}>
          {busy ? (
            <>
              <AppIcon
                name="progress_activity"
                size={16}
                className="animate-spin"
              />
              {t('actions.fetching')}
            </>
          ) : (
            <>
              {t('actions.fetch')}
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
  fetchError,
  createError,
  saving,
  selected,
  onSelected,
  onManualInput,
  onBack,
  onDone,
}: {
  readonly providerName: string
  readonly baseUrl: string
  readonly fetched: readonly FetchedModel[] | null
  readonly manual: boolean
  readonly fetchError: string
  readonly createError: string
  readonly saving: boolean
  readonly selected: readonly string[]
  readonly onSelected: (models: readonly string[]) => void
  readonly onManualInput: () => void
  readonly onBack: () => void
  readonly onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const draftRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const list = fetched ?? []
    const q = query.trim().toLowerCase()
    return q ? list.filter((model) => model.id.toLowerCase().includes(q)) : list
  }, [fetched, query])

  const toggle = (model: string) => {
    onSelected(
      selected.includes(model)
        ? selected.filter((item) => item !== model)
        : [...selected, model]
    )
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
        <span className="font-medium">{providerName}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {baseUrl}
        </span>
        <span className="ms-auto rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
          {t('models.providerBadge')}
        </span>
      </div>

      {fetchError && (
        <Alert title={t('fetch.manualTitle')} tone="warning">
          {t('fetch.manualHint', { message: fetchError })}
        </Alert>
      )}

      {createError && (
        <Alert title={t('errors.createFailed')}>{createError}</Alert>
      )}

      {!manual ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t('models.fetchedCount', { count: (fetched ?? []).length })}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelected(filtered.map((model) => model.id))}
              >
                {t('actions.selectAll')}
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onSelected([])}
              >
                {t('actions.clear')}
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
              placeholder={t('models.searchPlaceholder')}
              className="h-9 ps-8 text-xs"
              autoComplete="off"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('models.empty')}
              </div>
            )}
            {filtered.map((model) => {
              const checked = selected.includes(model.id)
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => toggle(model.id)}
                  aria-pressed={checked}
                  className={cn(
                    'flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left text-xs transition-colors last:border-b-0',
                    checked ? 'bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {checked && <AppIcon name="check" size={11} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {model.id}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    chat
                  </span>
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
              placeholder={t('models.manualPlaceholder')}
              className="h-9 font-mono text-xs"
              autoComplete="off"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              onClick={addDraft}
              disabled={!draft.trim()}
            >
              <AppIcon name="add" size={14} />
              {t('actions.add')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('models.manualHint')}
          </p>
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
                aria-label={t('models.remove', { model })}
                onClick={() =>
                  onSelected(selected.filter((item) => item !== model))
                }
                className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <AppIcon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {selected.length > 0 && manual && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((model) => (
            <span
              key={model}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 ps-2.5 pe-1 font-mono text-[11px]"
            >
              {model}
              <button
                type="button"
                aria-label={t('models.remove', { model })}
                onClick={() =>
                  onSelected(selected.filter((item) => item !== model))
                }
                className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <AppIcon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button size="lg" variant="ghost" onClick={onBack} disabled={saving}>
          <AppIcon name="chevron_left" size={16} />
          {t('actions.back')}
        </Button>
        <div className="flex items-center gap-3">
          {!manual && (
            <button
              type="button"
              onClick={onManualInput}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('actions.manualAdd')}
            </button>
          )}
          <Button
            size="lg"
            onClick={onDone}
            disabled={selected.length === 0 || saving}
          >
            {selected.length > 0
              ? t('actions.doneCount', { count: selected.length })
              : t('actions.done')}
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
  onEnter,
}: {
  readonly providerName: string
  readonly baseUrl: string
  readonly models: readonly string[]
  readonly onEnter: () => void
}) {
  const { t } = useTranslation('onboarding')
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <AppIcon name="check_circle" size={26} />
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t('done.title')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('done.description')}
        </p>
      </div>
      <div className="w-full rounded-xl border border-border text-left text-xs">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <span className="text-muted-foreground">{t('done.provider')}</span>
          <span className="font-medium">{providerName}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <span className="text-muted-foreground">{t('done.baseUrl')}</span>
          <span className="truncate font-mono text-[11px]">{baseUrl}</span>
        </div>
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
          <span className="shrink-0 text-muted-foreground">
            {t('done.models')}
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            {models.map((model) => (
              <span
                key={model}
                className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]"
              >
                {model}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex w-full justify-end pt-1">
        <Button size="lg" onClick={onEnter}>
          {t('actions.enter')}
          <AppIcon name="chevron_right" size={16} />
        </Button>
      </div>
    </div>
  )
}

export function OnboardingPage() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelListEndpoint, setModelListEndpoint] = useState(
    DEFAULT_MODEL_LIST_ENDPOINT
  )
  const [fetched, setFetched] = useState<readonly FetchedModel[] | null>(null)
  const [manual, setManual] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [fetchError, setFetchError] = useState('')
  const [createError, setCreateError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [createdName, setCreatedName] = useState('')
  const [createdId, setCreatedId] = useState('')

  const providerName = name.trim() || hostOf(baseUrl, t('unnamedProvider'))
  const toErrorMessage = useCallback(
    (error: unknown) =>
      error instanceof DashboardApiError
        ? error.message
        : t('errors.unexpected'),
    [t]
  )

  // 直接访问 /onboarding 时也先确认条件：已有供应商或已经跳过就回控制台。
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      dashboardApi.listProviders({ limit: 1, offset: 0 }),
      dashboardApi.getSettings(),
    ])
      .then(([providers, settings]) => {
        if (cancelled) return
        if (!shouldShowOnboarding(providers.total, settings)) {
          navigate('/', { replace: true })
          return
        }
        const endpoint = settings
          .find((item) => item.key === 'default_model_list_endpoint')
          ?.value.trim()
        if (endpoint && endpoint.startsWith('/')) setModelListEndpoint(endpoint)
        setChecking(false)
      })
      .catch(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  const runFetch = async () => {
    const base = baseUrl.trim()
    const key = apiKey.trim()
    if (base === '' || key === '' || busy) return
    setBusy(true)
    setFetchError('')
    setCreateError('')
    try {
      const endpoint = modelListEndpoint.trim() || DEFAULT_MODEL_LIST_ENDPOINT
      const fullUrl = joinModelListUrl(
        base,
        endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
        true
      )
      const models = await dashboardApi.fetchModelsFromEndpoint(fullUrl, key)
      const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
      setFetched(sorted)
      setManual(false)
      setSelected(sorted.length > 0 ? [sorted[0].id] : [])
      setStep(2)
    } catch (error) {
      setFetchError(toErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleManual = () => {
    setManual(true)
    setStep(2)
  }

  const handleBack = () => {
    setCreateError('')
    setStep(1)
  }

  const handleCreate = async () => {
    if (selected.length === 0 || saving) return
    setSaving(true)
    setCreateError('')
    try {
      const provider = await dashboardApi.createProvider({
        name: providerName,
        baseUrls: [baseUrl.trim()],
        keys: [apiKey.trim()],
        keyNotes: {},
        endpoints: [],
        models: selected.map((model) => emptyModel(model)),
        status: true,
        workflowEnabled: true,
        autoDisabled: false,
        dedupeV1Suffix: true,
      })
      setCreatedName(provider.name)
      setCreatedId(provider.id)
      setStep(3)
    } catch (error) {
      setCreateError(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    if (skipping) return
    setSkipping(true)
    try {
      await dashboardApi.updateSetting(ONBOARDING_SKIPPED_SETTING_KEY, 'true')
    } catch {
      // 保存失败也先回控制台；下次进入会再次提示。
    }
    navigate('/', { replace: true })
  }

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <AppIcon name="progress_activity" size={20} className="animate-spin" />
        <span className="ml-2 text-sm">{t('checking')}</span>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-svh flex-col bg-background text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 0)',
        backgroundSize: '22px 22px',
      }}
    >
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="font-hapiy-logo text-2xl leading-none text-foreground">hapiy</span>
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => void handleSkip()}
          disabled={skipping || saving}
        >
          {skipping ? t('skipping') : t('skip')}
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-28">
        <div className="w-full max-w-xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('description')}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <StepDots step={step} />
              {step < 3 && (
                <span className="text-[11px] text-muted-foreground">
                  {t('steps.progress', { current: step })}
                </span>
              )}
            </div>
            <div className="px-6 py-6">
              {step === 1 && (
                <ProviderStep
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  name={name}
                  error={fetchError}
                  busy={busy}
                  onBaseUrl={setBaseUrl}
                  onApiKey={setApiKey}
                  onName={setName}
                  onFetch={() => void runFetch()}
                  onManual={handleManual}
                />
              )}
              {step === 2 && (
                <ModelStep
                  providerName={providerName}
                  baseUrl={baseUrl.trim()}
                  fetched={fetched}
                  manual={manual}
                  fetchError={fetchError}
                  createError={createError}
                  saving={saving}
                  selected={selected}
                  onSelected={setSelected}
                  onManualInput={() => setManual(true)}
                  onBack={handleBack}
                  onDone={() => void handleCreate()}
                />
              )}
              {step === 3 && (
                <DoneStep
                  providerName={createdName}
                  baseUrl={baseUrl.trim()}
                  models={selected}
                  onEnter={() =>
                    navigate('/', {
                      replace: true,
                      state: createdId
                        ? { addProviderId: createdId, addProviderName: createdName }
                        : null,
                    })
                  }
                />
              )}
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            {t('footer')}
          </p>
        </div>
      </main>
    </div>
  )
}
