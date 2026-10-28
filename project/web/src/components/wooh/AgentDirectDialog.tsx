import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/wooh/dialog'
import { dashboardApi } from '@/lib/dashboard-api'
import type { Provider } from '@/lib/dashboard-api'

/** One manually configured upstream channel, chosen in the direct dialog. */
export type AgentDirectChannel = {
  readonly providerId: string
  readonly providerName: string
  readonly baseUrl: string
  readonly endpoint: string
  readonly key: string
}

function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map(normalizePath).filter((path) => path !== ''))]
}

// AgentDirectDialog collects one manual upstream channel: provider (for the
// label and prices), then an editable base URL, endpoint path, key and model.
// Fields are free text with the provider's existing values offered as
// suggestions, so nothing here needs a provider to be configured first.
export function AgentDirectDialog({
  open,
  onOpenChange,
  initial,
  initialModel,
  onConfirm,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly initial: AgentDirectChannel | null
  readonly initialModel: string
  readonly onConfirm: (channel: AgentDirectChannel, model: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DirectForm
          initial={initial}
          initialModel={initialModel}
          onClose={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  )
}

function DirectForm({
  initial,
  initialModel,
  onClose,
  onConfirm,
}: {
  readonly initial: AgentDirectChannel | null
  readonly initialModel: string
  readonly onClose: () => void
  readonly onConfirm: (channel: AgentDirectChannel, model: string) => void
}) {
  const { t } = useTranslation('agentPanel')
  const [providers, setProviders] = useState<readonly Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [providerName, setProviderName] = useState(initial?.providerName ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [model, setModel] = useState(initialModel)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .listProviders({ limit: 500, offset: 0 })
      .then(({ providers: next }) => {
        if (!cancelled) setProviders(next)
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const provider = useMemo(
    () => providers.find((entry) => entry.name === providerName) ?? null,
    [providers, providerName],
  )

  const models = provider?.models.map((entry) => entry.model) ?? []
  const modelEndpoints = provider?.models.find((entry) => entry.model === model)?.endpoints ?? []
  const endpointOptions = uniquePaths([
    ...modelEndpoints,
    ...(provider?.endpoints.map((entry) => entry.pathSuffix) ?? []),
    '/v1/chat/completions',
    '/v1/responses',
    '/v1/messages',
  ])

  const pickProvider = (name: string) => {
    setProviderName(name)
    const next = providers.find((entry) => entry.name === name)
    if (!next) return
    const firstModel = next.models[0]
    setBaseUrl(next.baseUrls[0] ?? '')
    setKey(next.keys[0] ?? '')
    setModel((current) => (current && next.models.some((entry) => entry.model === current) ? current : (firstModel?.model ?? '')))
    setEndpoint(
      normalizePath(firstModel?.endpoints[0] ?? next.endpoints[0]?.pathSuffix ?? '') || '/v1/chat/completions',
    )
  }

  const pickModel = (name: string) => {
    setModel(name)
    const next = provider?.models.find((entry) => entry.model === name)
    if (next && next.endpoints.length > 0 && !next.endpoints.some((path) => normalizePath(path) === endpoint)) {
      setEndpoint(normalizePath(next.endpoints[0]!))
    }
  }

  const urlValid = baseUrl === '' || /^https?:\/\//i.test(baseUrl)
  const complete = providerName.trim() !== '' && baseUrl.trim() !== '' && endpoint.trim() !== '' && key.trim() !== '' && model.trim() !== ''
  const canSubmit = complete && urlValid && !loading

  const submit = () => {
    if (!canSubmit) return
    onConfirm(
      {
        providerId: provider?.id ?? initial?.providerId ?? '',
        providerName: providerName.trim(),
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        endpoint: normalizePath(endpoint),
        key: key.trim(),
      },
      model.trim(),
    )
    onClose()
  }

  return (
    <DialogContent width="sm">
      <DialogHeader>
        <DialogTitle>{t('directDialogTitle')}</DialogTitle>
      </DialogHeader>
      <p className="text-xs leading-5 text-muted-foreground">{t('directDialogHint')}</p>

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('directProvider')}</span>
          <Input
            list="agent-direct-providers"
            value={providerName}
            placeholder={t('directPickProvider')}
            onChange={(event) => pickProvider(event.target.value)}
          />
          <datalist id="agent-direct-providers">
            {providers.map((entry) => (
              <option key={entry.id} value={entry.name} />
            ))}
          </datalist>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('directBaseUrl')}</span>
          <Input
            list="agent-direct-base-urls"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            aria-invalid={!urlValid}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <datalist id="agent-direct-base-urls">
            {(provider?.baseUrls ?? []).map((url) => (
              <option key={url} value={url} />
            ))}
          </datalist>
          {!urlValid && <span className="text-[11px] text-destructive">{t('directInvalidUrl')}</span>}
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('directEndpoint')}</span>
          <Input
            list="agent-direct-endpoints"
            value={endpoint}
            placeholder="/v1/chat/completions"
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <datalist id="agent-direct-endpoints">
            {endpointOptions.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('directKey')}</span>
          <Input
            list="agent-direct-keys"
            value={key}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
          <datalist id="agent-direct-keys">
            {(provider?.keys ?? []).map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">{t('directModel')}</span>
          <Input list="agent-direct-models" value={model} onChange={(event) => pickModel(event.target.value)} />
          <datalist id="agent-direct-models">
            {models.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <AppIcon name="loading_four" size={12} className="animate-spin" />
          {t('directLoading')}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('directCancel')}
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {t('directConfirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
