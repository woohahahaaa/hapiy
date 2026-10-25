import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/wooh/AppIcon'
import { PageHeader } from '@/components/wooh/PageHeader'
import { Button } from '@/components/ui/button'

import { Checkbox } from '@/components/wooh/checkbox'
import { DataTable, type ColumnDef } from '@/components/wooh/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/wooh/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { collectDeclaredEndpoints, seedModelEndpointsFromProvider } from '@/lib/provider-endpoints'
import { joinModelListUrl, pickFetchModelKey } from '@/lib/provider-fetch'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/wooh/tooltip'
import { toast } from '@/components/ui/toast'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { useUIAction } from '@/lib/ui-actions'
import { i18n } from '@/i18n/i18n'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Provider, ProviderDisableStatus, ProviderInput, ProviderModel, ModelPrices, FetchedModel, ModelReferencePrices } from '@/lib/dashboard-api'
import {
  findModelsDevProviderRow,
  isModelsDevLab,
  loadModelsDevModels,
  providersForModel,
  refreshModelsDevModels,
  resolveModelsDevReference,
  type ModelsDevModel,
} from '@/lib/models-dev'

type ProviderFormProps = {
  readonly provider: Provider | null
  // draft pre-fills a create (provider === null) with agent-supplied fields.
  readonly draft: ProviderInput | null
  readonly onSave: (provider: ProviderInput) => void
  readonly isSaving: boolean
  readonly useKey: boolean
  readonly onUseKeyChange: (next: boolean) => void
  readonly disableStatus: ProviderDisableStatus | null
  readonly onResetDisableDimension: (dimension: 'provider' | 'base_url' | 'key') => void
  // 恢复单条被自动禁用的 base URL / key（只恢复这一条，不碰同维度的其他条目）。
  readonly onResetDisableValue: (dimension: 'base_url' | 'key', value: string) => void
  // 获取模型弹窗里切换 /v1 去重后，同步外层 providers 列表，保证重新打开
  // 弹窗时读到的是刚保存的值（而不是打开页面的旧快照）。
  readonly onProviderPreferenceUpdated: (id: string, dedupeV1Suffix: boolean) => void
}

const emptyProvider: ProviderInput = {
  name: '', baseUrls: [], keys: [], keyNotes: {}, endpoints: [], models: [], status: true, workflowEnabled: true, autoDisabled: false, dedupeV1Suffix: true,
}

// providerDraftFromUIAction turns the agent's create-provider payload into the
// form's starting value. Only the name comes from the agent: keys and upstream
// addresses stay for the operator to type.
export function providerDraftFromUIAction(payload: Readonly<Record<string, unknown>>): ProviderInput | null {
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (name === '') return null
  return { ...emptyProvider, name }
}

// emptyProviderModel builds the serializable form of a model row with all
// price-mode fields nulled out; the 模型价格参考供应商 mode gets its supplier
// and price snapshot filled on demand when the user picks a reference.
function emptyProviderModel(model = ''): ProviderModel {
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

// refPricesOf converts a models.dev row's per-1M-token USD prices into the
// stored read-only snapshot shape.
function refPricesOf(row: { readonly inputPrice: number; readonly outputPrice: number; readonly cacheWritePrice: number; readonly cacheReadPrice: number }): ModelReferencePrices {
  return {
    input: row.inputPrice,
    cacheWrite: row.cacheWritePrice,
    cacheRead: row.cacheReadPrice,
    output: row.outputPrice,
  }
}

// Prices in 单独设置价格 mode are strings that must start with "$", "¥" or
// "￥"; the prefix also selects the billing currency for the model.
const PRICE_PREFIX = /^[$¥￥]/
const PRICE_FIELDS: ReadonlyArray<{ readonly key: keyof ModelPrices }> = [
  { key: 'input' },
  { key: 'cacheWrite' },
  { key: 'cacheRead' },
  { key: 'output' },
]

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : i18n.t('provider:errors.unexpected')
}

export function ProviderPage() {
  const { t } = useTranslation('provider')
  const navigate = useNavigate()
  const [providers, setProviders] = useState<readonly Provider[]>([])
  const [total, setTotal] = useState(0)
  // 分页状态缓存（usePersistedState）：刷新保留，切走本页即清除。
  const [offset, setOffset] = usePersistedState('providers.offset', 0)
  const [limit, setLimit] = usePersistedState('providers.limit', 50)
  const [editing, setEditing] = useState<Provider | null>(null)
  // Draft is the pre-filled form for a provider that does not exist yet. It is
  // separate from `editing` because only `editing` decides create vs update.
  const [draft, setDraft] = useState<ProviderInput | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  // Row the agent just touched; flashes briefly so the change is visible even
  // when the operator is looking at the chat panel.
  const [highlightId, setHighlightId] = useState('')
  const highlightTimer = useRef<number | null>(null)
  // 新建成功后询问是否接入转发拓扑；非空即弹窗。
  const [createdProvider, setCreatedProvider] = useState<Provider | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useKey, setUseKey] = useState(true)
  const [disableStatuses, setDisableStatuses] = useState<ReadonlyMap<string, ProviderDisableStatus>>(new Map())
  const [deleting, setDeleting] = useState<Provider | null>(null)

  // Console-chat agent: open the provider editor with the requested fields
  // pre-filled. The agent never saves on its own; the operator confirms here.
  useUIAction('open_provider_dialog', (payload) => {
    const targetId = typeof payload.provider_id === 'string' ? payload.provider_id.trim() : ''
    const targetName = typeof payload.provider_name === 'string' ? payload.provider_name.trim() : ''
    const matches = (provider: Provider) =>
      (targetId !== '' && provider.id === targetId) ||
      (targetName !== '' && provider.name === targetName)
    void (async () => {
      let target = providers.find(matches)
      if (!target) {
        try {
          const all = await dashboardApi.listProviders({ limit: 500, offset: 0 })
          target = all.providers.find(matches)
        } catch {
          return
        }
      }
      if (!target) return
      setDraft(null)
      setEditing(target)
      setIsDialogOpen(true)
    })()
  })

  // Console-chat agent: open the create dialog with the name pre-filled. Used
  // when the operator still has to fill the sensitive fields.
  useUIAction('create_provider_dialog', (payload) => {
    const next = providerDraftFromUIAction(payload)
    if (!next) return
    setEditing(null)
    setDraft(next)
    setIsDialogOpen(true)
  })

  // Console-chat agent: mirror a provider write it already performed. Create
  // and edit open the editor on the saved record (the operator sees exactly
  // what the agent wrote); toggles and resets refresh and flash the row.
  useUIAction('provider_changed', (payload) => {
    const providerId = typeof payload.provider_id === 'string' ? payload.provider_id : ''
    const name = typeof payload.name === 'string' ? payload.name : ''
    const created = payload.created === true
    const showEditor = created || payload.edited === true
    if (name !== '') {
      toast(created ? t('toast.agentCreated', { name }) : t('toast.agentUpdated', { name }))
    }
    void (async () => {
      await loadProviders()
      if (providerId === '') return
      flashProvider(providerId)
      if (!showEditor) return
      try {
        const all = await dashboardApi.listProviders({ limit: 500, offset: 0 })
        const target = all.providers.find((item) => item.id === providerId)
        if (!target) return
        setEditing(target)
        setDraft(null)
        setIsDialogOpen(true)
      } catch {
        // The refreshed table still shows the saved row.
      }
    })()
  })

  useUIAction('provider_deleted', (payload) => {
    const name = typeof payload.name === 'string' ? payload.name : ''
    if (name !== '') toast(t('toast.agentDeleted', { name }))
    void loadProviders()
  })

  const flashProvider = useCallback((providerId: string) => {
    setHighlightId(providerId)
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightId(''), 2500)
  }, [])

  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
  }, [])

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [result, statuses] = await Promise.all([
        dashboardApi.listProviders({ limit, offset }),
        dashboardApi.listProviderDisableStatuses(),
      ])
      setProviders(result.providers)
      setTotal(result.total)
      setDisableStatuses(new Map(statuses.map((status) => [status.providerId, status])))
    } catch (error) {
      setError(toErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [offset, limit])

  useEffect(() => { void loadProviders() }, [loadProviders])

  const runMutation = async (operation: () => Promise<unknown>) => {
    setIsSaving(true)
    setError(null)
    try {
      await operation()
      await loadProviders()
      return true
    } catch (error) {
      setError(toErrorMessage(error))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async (provider: ProviderInput) => {
    const target = editing
    setIsSaving(true)
    setError(null)
    try {
      const saved = target
        ? await dashboardApi.updateProvider(target.id, provider)
        : await dashboardApi.createProvider(provider)
      await loadProviders()
      setEditing(null)
      setDraft(null)
      setIsDialogOpen(false)
      // 新建的供应商默认不在拓扑里，只有接入拓扑后请求才会真的路由到它。
      if (!target) setCreatedProvider(saved)
    } catch (error) {
      setError(toErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddToTopology = () => {
    const provider = createdProvider
    if (!provider) return
    setCreatedProvider(null)
    navigate('/', { state: { addProviderId: provider.id, addProviderName: provider.name } })
  }

  // 获取模型弹窗切换 /v1 去重后会立即写回后端；同步列表快照，保证关闭
  // 再打开供应商时读到刚保存的值。
  const handleProviderPreferenceUpdated = (id: string, dedupeV1Suffix: boolean) => {
    setProviders((current) => current.map((provider) => (
      provider.id === id ? { ...provider, dedupeV1Suffix } : provider
    )))
  }

  const handleResetDisableDimension = async (provider: Provider, dimension: 'provider' | 'base_url' | 'key') => {
    const reset = await runMutation(() => dashboardApi.resetProviderDisableDimension(provider.id, dimension))
    if (reset) toast(t('toast.disableReset'))
  }

  const handleResetDisableValue = async (provider: Provider, dimension: 'base_url' | 'key', value: string) => {
    const reset = await runMutation(() => dashboardApi.resetProviderDisableStatus(provider.id, { dimension, value }))
    if (reset) toast(t('toast.disableReset'))
  }

  const columns: ColumnDef<Provider>[] = [
    { key: 'name', label: t('columns.name'), defaultWidth: { kind: 'pixel', value: 160 }, render: (_, provider) => <span className="font-medium">{provider.name}</span> },
    { key: 'baseUrls', label: t('columns.baseUrls'), defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs">{t('list.urls', { count: provider.baseUrls.length })}</span> },
    { key: 'keys', label: t('columns.keys'), defaultWidth: { kind: 'pixel', value: 100 }, render: (_, provider) => <span className="text-xs">{t('list.keys', { count: provider.keys.length })}</span> },
    { key: 'endpoints', label: t('columns.endpoints'), defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs">{t('list.endpoints', { count: collectDeclaredEndpoints(provider).length })}</span> },
    {
      key: 'models',
      label: t('columns.models'),
      defaultWidth: { kind: 'pixel', value: 240 },
      render: (_, provider) => (
        <div className="flex flex-wrap gap-1">
          {provider.models.map((model) => <span key={model.model} className="text-xs">{model.model}</span>)}
        </div>
      ),
    },
    {
      key: 'status',
      label: t('columns.status'),
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, provider) => <span className={provider.status ? 'text-success' : 'text-destructive'}>{provider.status ? t('common:action.enable') : t('common:action.disable')}</span>,
    },
    {
      key: 'autoDisabled',
      label: t('columns.failover'),
      defaultWidth: { kind: 'pixel', value: 160 },
      defaultOverflow: 'wrap',
      render: (_, provider) => {
        // 与拓扑节点卡片的故障转移展示保持一致：分数形式 + warning 色。
        const status = disableStatuses.get(provider.id)
        const providerDisabled = status?.provider || provider.autoDisabled
        const urlFlags = status?.baseUrls ?? {}
        const keyFlags = status?.keys ?? {}
        const urlDisabled = Object.values(urlFlags).filter(Boolean).length
        const keyDisabled = Object.values(keyFlags).filter(Boolean).length
        const urlTotal = Math.max(provider.baseUrls.length, Object.keys(urlFlags).length)
        const keyTotal = Math.max(provider.keys.length, Object.keys(keyFlags).length)
        const none = !providerDisabled && urlDisabled === 0 && keyDisabled === 0
        return (
          <div className="text-xs">
            {none ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-medium text-warning">
                {providerDisabled && (
                  <span>{t('failoverStatus.provider', { disabled: 1, total: 1 })}</span>
                )}
                {urlDisabled > 0 && (
                  <span>{t('failoverStatus.baseUrl', { disabled: urlDisabled, total: urlTotal })}</span>
                )}
                {keyDisabled > 0 && (
                  <span>
                    {t('failoverStatus.key', { disabled: keyDisabled, total: keyTotal })}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'id',
      label: t('columns.actions'),
      defaultWidth: { kind: 'pixel', value: 220 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, provider) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.toggleProvider(provider.id))}>{provider.status ? t('common:action.disable') : t('common:action.enable')}</Button>
          <Button variant="ghost" size="icon-sm" disabled={isSaving} onClick={() => { setEditing(provider); setDraft(null); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
          <Button variant="ghost" size="icon-sm" disabled={isSaving} onClick={() => setDeleting(provider)}><AppIcon name="delete" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={t('description')}
        status={t('list.statusCount', { count: total })}
      />
      <div className="p-6">
        <DataTable
          id="providers"
          columns={columns}
          data={providers}
          total={total}
          loading={isLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText={t('list.empty')}
          rowClassName={(provider) => (provider.id === highlightId ? 'bg-primary/10' : '')}
          onRetry={() => void loadProviders()}
          actions={(
            <>
              <Button size="sm" onClick={() => { setEditing(null); setDraft(null); setIsDialogOpen(true) }} disabled={isSaving}>
                <AppIcon name="add" data-icon="inline-start" />{t('list.add')}
              </Button>
            </>
          )}
        />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent width="md" scrollFooter>
            <DialogHeader><DialogTitle>{editing ? t('dialog.editProvider') : t('list.add')}</DialogTitle></DialogHeader>
             <ProviderForm
               key={editing?.id ?? (draft ? `new:${draft.name}` : 'new')}
               provider={editing}
               draft={draft}
               onSave={handleSave}
               isSaving={isSaving}
               useKey={useKey}
               onUseKeyChange={setUseKey}
               disableStatus={editing ? disableStatuses.get(editing.id) ?? null : null}
               onResetDisableDimension={(dimension) => { if (editing) void handleResetDisableDimension(editing, dimension) }}
               onResetDisableValue={(dimension, value) => { if (editing) void handleResetDisableValue(editing, dimension, value) }}
               onProviderPreferenceUpdated={handleProviderPreferenceUpdated}
             />
          </DialogContent>
        </Dialog>

        <ConfirmDeleteDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title={t('dialog.deleteTitle')}
          description={t('dialog.deleteDescription', { name: deleting?.name ?? '' })}
          busy={isSaving}
          onConfirm={() => {
            if (deleting) {
              const provider = deleting
              setDeleting(null)
              void runMutation(() => dashboardApi.deleteProvider(provider.id))
            }
          }}
        />

        <Dialog
          open={createdProvider !== null}
          onOpenChange={(open) => {
            if (!open) setCreatedProvider(null)
          }}
        >
          <DialogContent width="sm" scrollFooter>
            <DialogHeader>
              <DialogTitle>{t('addToTopology.title')}</DialogTitle>
              <DialogDescription>
                {t('addToTopology.description', { name: createdProvider?.name ?? '' })}
              </DialogDescription>
            </DialogHeader>
            <DialogScrollBody
              footer={
                <>
                  <Button variant="outline" onClick={() => setCreatedProvider(null)}>
                    {t('addToTopology.later')}
                  </Button>
                  <Button onClick={handleAddToTopology}>{t('addToTopology.confirm')}</Button>
                </>
              }
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

// ModelEndpointEditor edits a model's allowed request paths as a single
// combobox value: clicking the field opens a dropdown of the paths already
// used by this provider's models (merged and deduped), typing filters them,
// clicking one switches the model to that path, and leaving the field (blur)
// commits whatever was typed — no Enter needed. Enter commits too (for
// keyboard users), Escape discards, and an empty value means unrestricted.
function ModelEndpointEditor({ values, candidates, onChange }: {
  readonly values: readonly string[]
  readonly candidates: readonly string[]
  readonly onChange: (values: readonly string[]) => void
}) {
  const { t } = useTranslation('provider')
  const display = values.join(', ')
  const [text, setText] = useState(display)
  const [open, setOpen] = useState(false)
  // query === null means "nothing typed yet": show every candidate.
  const [query, setQuery] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // Swallow the first mouseup so the select-all applied on focus survives the
  // click that opened the field (the browser would collapse it otherwise).
  const keepSelection = useRef(false)
  // The anchor input; the popover must ignore outside-interactions that target
  // it, because the click that focuses the field is reported as an outside
  // interaction once the content mounts and would close the dropdown at once.
  const anchorRef = useRef<HTMLInputElement | null>(null)
  const needle = (query ?? '').trim().toLowerCase()
  const options = needle === '' ? candidates : candidates.filter((path) => path.toLowerCase().includes(needle))
  // close dismisses the dropdown without touching the typed text: blur
  // commits, so the close path must not restore the previous value first
  // (that would leave blur with nothing to commit).
  const close = () => {
    setOpen(false)
    setQuery(null)
    setError(false)
  }
  // reset discards the edit (Escape) and restores the committed value.
  const reset = () => {
    close()
    setText(display)
  }
  const commit = (raw: string) => {
    const path = raw.trim()
    if (path !== '' && !path.startsWith('/')) {
      setError(true)
      return
    }
    onChange(path === '' ? [] : [path])
    setText(path)
    setQuery(null)
    setError(false)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(next) => { if (next) { setOpen(true) } else { close() } }}>
      <PopoverAnchor asChild>
        <Input
          ref={anchorRef}
          value={text}
          title={display || undefined}
          placeholder={t('price.endpointUnset')}
          aria-invalid={error || undefined}
          onFocus={(event) => {
            keepSelection.current = true
            event.currentTarget.select()
            setOpen(true)
            setQuery(null)
            setError(false)
          }}
          onMouseUp={(event) => {
            if (!keepSelection.current) return
            keepSelection.current = false
            event.preventDefault()
          }}
          onChange={(event) => {
            setText(event.target.value)
            setQuery(event.target.value)
            setOpen(true)
            setError(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(text)
            } else if (event.key === 'Escape') {
              reset()
            }
          }}
          onBlur={() => {
            // Leaving the field commits; only an unchanged value just closes.
            if (text.trim() === display.trim()) {
              close()
            } else {
              commit(text)
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="flex w-80 flex-col gap-2 p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => { if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault() }}
        onFocusOutside={(event) => { if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault() }}
      >
        {error && <p role="alert" className="text-xs text-destructive">{t('errors.pathMustStartSlash')}</p>}
        <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {options.map((path) => (
            <Button key={path} type="button" variant="ghost" size="sm" className="justify-start font-normal" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(path)}>
              <span className="truncate">{path}</span>
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('form.endpointHint')}</p>
      </PopoverContent>
    </Popover>
  )
}

function ProviderForm({ provider, draft, onSave, isSaving, useKey, onUseKeyChange, disableStatus, onResetDisableDimension, onResetDisableValue, onProviderPreferenceUpdated }: ProviderFormProps) {
  const { t } = useTranslation('provider')
  const [form, setForm] = useState<ProviderInput>(() => provider
    ? { ...provider, models: seedModelEndpointsFromProvider(provider.endpoints, provider.models) }
    : draft ?? emptyProvider)
  // Per-key remarks as a parallel array aligned with form.keys (array instead
  // of a key→note map so editing a key text keeps its note). Converted back to
  // the stored key→note map on save.
  const [keyNotes, setKeyNotes] = useState<readonly string[]>(() =>
    provider ? provider.keys.map((key) => provider.keyNotes[key] ?? '') : [],
  )
  const endpointCandidates = collectDeclaredEndpoints(form)
  const [globalDefaultEndpoint, setGlobalDefaultEndpoint] = useState<string | null>(null)
  const [endpointOverride, setEndpointOverride] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState('')
  const [isFetchDialogOpen, setIsFetchDialogOpen] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [dedupeSaving, setDedupeSaving] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<readonly FetchedModel[] | null>(null)
  const [priceError, setPriceError] = useState(false)
  const [priceErrorPos, setPriceErrorPos] = useState<{ left: number; top: number } | null>(null)
  const priceErrorTimer = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // models.dev snapshot backing 模型价格参考供应商: candidates for the
  // reference-supplier dropdown, snapshot fill on pick, and the on-open
  // liveness check (stale supplier → red borders, data untouched).
  const [refSnapshot, setRefSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [refSnapshotError, setRefSnapshotError] = useState<string | null>(null)
  // All providers are loaded once so the per-model 同步 action can rewrite
  // the equal-named models of the other providers in the same dialog flow.
  // 同步到其他供应商功能暂时注释，相关状态一并停用。
  // const [allProviders, setAllProviders] = useState<readonly Provider[]>([])
  // const [refSyncing, setRefSyncing] = useState(false)
  const [bulkRefSetting, setBulkRefSetting] = useState(false)
  const [bulkScopeOpen, setBulkScopeOpen] = useState(false)
  // const [syncTarget, setSyncTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRefSnapshotError(null)
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) setRefSnapshot(models)
      })
      .catch(() => {
        if (!cancelled) setRefSnapshotError(t('errors.modelsDevLoad'))
      })
    // 同步到其他供应商功能暂时注释：不再加载全部供应商。
    // void dashboardApi.listProviders({ limit: 10000, offset: 0 })
    //   .then((result) => {
    //     if (!cancelled) setAllProviders(result.providers)
    //   })
    //   .catch(() => {
    //     if (!cancelled) setAllProviders([])
    //   })
    return () => { cancelled = true }
  }, [])

  // Reference-supplier candidates for a model: the distinct models.dev
  // providers that carry the model name (case-insensitive).
  const referenceCandidatesFor = (modelName: string): ReadonlyArray<{ readonly providerId: string; readonly providerName: string }> =>
    providersForModel(refSnapshot ?? [], modelName)

  // Liveness check: shown only when the snapshot is available AND the row is
  // in reference mode AND it picked a concrete supplier AND that supplier no
  // longer appears for the model. A reference mode without a picked supplier
  // (vendor-less) is never "stale".
  const referenceStaleFor = (model: ProviderModel): boolean =>
    refSnapshot !== null &&
    model.referenceProvider !== null &&
    model.referenceProvider.trim() !== '' &&
    !providersForModel(refSnapshot, model.model)
      .some((p) => p.providerName.toLowerCase() === model.referenceProvider!.toLowerCase())

  const pickReference = (index: number, providerName: string) => {
    const model = form.models[index]
    if (!model) return
    const snapshot = refSnapshot ?? []
    const row = findModelsDevProviderRow(snapshot, model.model, providerName)
    setRefSnapshotError(null)
    patchModel(index, {
      referenceProvider: providerName,
      prices: null,
      referencePrices: row ? refPricesOf(row) : null,
      referenceAt: row ? new Date().toISOString() : null,
    })
    if (!row) {
      setRefSnapshotError(t('errors.priceNotFound', { model: model.model, provider: providerName }))
    }
  }

  // 一键把模型匹配到参考供应商并同步价格（按弹窗当前 UI 状态判断，未保存
  // 也生效）。参考厂商顺序全系统统一为：当前供应商 → 官方（lab）→ 已保存
  // → 候选。scope='reference' 只处理价格模式为「从 models.dev 同步」的
  // 模型；scope='all' 处理全部模型（含手动单独设置价格的模型）。
  const applyModelsDevPricesForAll = async (scope: 'all' | 'reference') => {
    setBulkRefSetting(true)
    setRefSnapshotError(null)
    try {
      const fresh = await refreshModelsDevModels()
      setRefSnapshot(fresh)
      const ownProviderNames = form.name.trim() ? [form.name] : []
      let filled = 0
      let vendorlessKept = 0
      const next = form.models.map((model) => {
        // 参考模式以外（手动价格 / 不设置）的模型在 reference 范围下跳过。
        if (scope === 'reference' && model.referenceProvider === null) return model
        const picked = resolveModelsDevReference(fresh, model.model, {
          ownProviderNames,
          storedSupplier: model.referenceProvider,
        })
        if (!picked) {
          // 当前供应商 / 官方 / 已保存 / 候选都没有：保留现状。
          vendorlessKept++
          return model
        }
        filled++
        return {
          ...model,
          prices: null,
          referenceProvider: picked.supplier,
          referencePrices: refPricesOf(picked.row),
          referenceAt: new Date().toISOString(),
        }
      })
      setForm((current) => ({ ...current, models: next }))
      if (filled > 0) {
        toast(t('toast.bulkFilled', { count: filled }))
      } else if (vendorlessKept > 0) {
        toast(t('toast.bulkVendorless', { count: vendorlessKept }))
      } else {
        toast(t('toast.noAutoModels'))
      }
    } catch {
      setRefSnapshotError(t('errors.bulkRefreshFailed'))
    } finally {
      setBulkRefSetting(false)
    }
  }

  // 同步到其他供应商功能暂时注释：生效逻辑与可同步目标判定。
  // const syncReference = async () => {
  //   if (!syncTarget) return
  //   const src = form.models.find((m) => m.model.trim() === syncTarget.trim())
  //   if (!src) return
  //   setRefSyncing(true)
  //   setRefSnapshotError(null)
  //   try {
  //     const needle = src.model.trim().toLowerCase()
  //     let applied = 0
  //     for (const target of allProviders) {
  //       if (provider && target.id === provider.id) continue
  //       if (target.models.every((m) => m.model.trim().toLowerCase() !== needle)) continue
  //       const nextModels = target.models.map((m) =>
  //         m.model.trim().toLowerCase() === needle
  //           ? { ...m, rate: src.rate, referenceProvider: src.referenceProvider, referencePrices: src.referencePrices, referenceAt: src.referenceAt, prices: src.prices }
  //           : m,
  //       )
  //       await dashboardApi.updateProvider(target.id, { ...target, models: nextModels })
  //       applied++
  //     }
  //     const reloaded = await dashboardApi.listProviders({ limit: 10000, offset: 0 })
  //     setAllProviders(reloaded.providers)
  //     setSyncTarget(null)
  //     toast(t('toast.synced', { count: applied }))
  //   } catch (err) {
  //     setRefSnapshotError(t('errors.syncFailed', { message: err instanceof Error ? err.message : t('errors.unknown') }))
  //   } finally {
  //     setRefSyncing(false)
  //   }
  // }

  // const syncTargetsFor = (modelName: string): number =>
  //   allProviders.filter((p) =>
  //     !(provider && p.id === provider.id) &&
  //     p.models.some((m) => m.model.trim().toLowerCase() === modelName.trim().toLowerCase()),
  //   ).length

  // Floating tooltip near the offending input, auto-dismissed after ~4 seconds.
  const showPriceError = (anchor?: HTMLElement | null) => {
    if (anchor && listRef.current) {
      const anchorRect = anchor.getBoundingClientRect()
      const listRect = listRef.current.getBoundingClientRect()
      setPriceErrorPos({ left: anchorRect.left - listRect.left, top: anchorRect.top - listRect.top })
    }
    setPriceError(true)
    if (priceErrorTimer.current !== null) window.clearTimeout(priceErrorTimer.current)
    priceErrorTimer.current = window.setTimeout(() => setPriceError(false), 4000)
  }

  useEffect(() => {
    return () => {
      if (priceErrorTimer.current !== null) window.clearTimeout(priceErrorTimer.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void dashboardApi.getSettings()
      .then((settings) => {
        if (cancelled) return
        const setting = settings.find((item) => item.key === 'default_model_list_endpoint')
        setGlobalDefaultEndpoint(setting ? setting.value : null)
      })
      .catch(() => {
        if (!cancelled) setGlobalDefaultEndpoint(null)
      })
    return () => { cancelled = true }
  }, [])

  const effectiveEndpoint = endpointOverride ?? globalDefaultEndpoint

  // 打开「从上游获取模型」弹窗：以当前生效的模型列表接口预填输入框。
  const openFetchDialog = () => {
    setEndpointDraft(effectiveEndpoint ?? '')
    setFetchError(null)
    setFetchedModels(null)
    setIsFetchDialogOpen(true)
  }

  const handleFetchModels = async () => {
    const draft = endpointDraft.trim()
    const endpoint = draft === '' ? globalDefaultEndpoint : draft
    if (!endpoint) {
      setFetchError(t('errors.noDefaultEndpoint'))
      return
    }
    if (!endpoint.startsWith('/')) {
      setFetchError(t('errors.pathMustStartSlash'))
      return
    }
    const baseUrl = form.baseUrls[0]
    if (!baseUrl) {
      setFetchError(t('errors.baseUrlRequired'))
      return
    }
    setEndpointOverride(draft === '' ? null : draft)
    const fullUrl = joinModelListUrl(baseUrl, endpoint, form.dedupeV1Suffix)
    const key = useKey ? pickFetchModelKey(form.keys, disableStatus?.keys) : undefined
    setFetchError(null)
    setIsFetching(true)
    try {
      const models = await dashboardApi.fetchModelsFromEndpoint(fullUrl, key)
      const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
      setFetchedModels(sorted)
    } catch (error) {
      setFetchError(toErrorMessage(error))
    } finally {
      setIsFetching(false)
    }
  }

  // 弹窗里的 /v1 去重开关：已有供应商立即写回后端（只改这一个字段），
  // 新建供应商先改本地表单、随「保存」一起落库。
  const handleDedupeV1SuffixChange = async (next: boolean) => {
    if (form.dedupeV1Suffix === next) return
    const previous = form.dedupeV1Suffix
    setForm((current) => ({ ...current, dedupeV1Suffix: next }))
    if (!provider) return
    setDedupeSaving(true)
    try {
      await dashboardApi.setProviderDedupeV1Suffix(provider.id, next)
      onProviderPreferenceUpdated(provider.id, next)
    } catch (error) {
      setForm((current) => ({ ...current, dedupeV1Suffix: previous }))
      setFetchError(toErrorMessage(error))
    } finally {
      setDedupeSaving(false)
    }
  }

  // Index-based model updates: rows render in array order (no re-sorting per
  // keystroke) so editing a name never remounts the row.
  const patchModel = (index: number, patch: Partial<ProviderModel>) => {
    setForm((current) => {
      if (current.models.length === 0 && index === 0) {
        return { ...current, models: [{ ...emptyProviderModel(), ...patch }] }
      }
      return {
        ...current,
        models: current.models.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      }
    })
  }

  const removeModel = (index: number) => {
    setForm((current) => ({ ...current, models: current.models.filter((_, i) => i !== index) }))
  }

  // One phantom editable row while the array is empty.
  const modelRows = form.models.length === 0
    ? [emptyProviderModel()]
    : form.models

  const handleSave = () => {
    const endpoints: ProviderInput['endpoints'] = []
    const baseUrls = form.baseUrls.map((value) => value.trim()).filter((value) => value !== '')
    const keys = form.keys.map((value) => value.trim()).filter((value) => value !== '')
    const notes: Record<string, string> = {}
    form.keys.forEach((raw, index) => {
      const key = raw.trim()
      if (key === '') return
      const note = (keyNotes[index] ?? '').trim()
      if (note !== '') notes[key] = note
    })
    const models = form.models
      .map((item) => {
        const model = item.model.trim()
        if (!item.prices) return { ...item, model }
        const prices: ModelPrices = {
          input: item.prices.input.replace(/\s+/g, ''),
          cacheWrite: item.prices.cacheWrite.replace(/\s+/g, ''),
          cacheRead: item.prices.cacheRead.replace(/\s+/g, ''),
          output: item.prices.output.replace(/\s+/g, ''),
        }
        return { ...item, model, prices }
      })
      .filter((item) =>
        !(item.model === '' && (item.rate === '' || item.rate === '1') && item.prices === null && item.endpoints.length === 0),
      )
    for (const item of models) {
      if (item.prices && PRICE_FIELDS.some(({ key }) => {
        const value = item.prices![key].trim()
        return value !== '' && !PRICE_PREFIX.test(value)
      })) {
        showPriceError()
        return
      }
    }
    onSave({ ...form, name: form.name.trim(), baseUrls, keys, keyNotes: notes, endpoints, models })
  }

  const handleConfirmAddModels = (ids: readonly string[], replace?: boolean) => {
    const additions: ProviderModel[] = ids.map((id) => ({ ...emptyProviderModel(id) }))
    if (replace) {
      setForm((current) => ({ ...current, models: additions }))
    } else {
      const existingIds = new Set(form.models.map((model) => model.model))
      const filtered = additions.filter((a) => !existingIds.has(a.model))
      if (filtered.length > 0) {
        setForm((current) => ({ ...current, models: [...current.models, ...filtered] }))
      }
    }
    setFetchedModels(null)
    setIsFetchDialogOpen(false)
  }

  // 内容区滚动 + 固定底部按钮栏：交给标准组件 DialogScrollBody。

  return (
    <>
      <DialogScrollBody footer={
        <>
          <Button disabled={isSaving || !form.name.trim()} onClick={handleSave}>{isSaving ? t('actions.saving') : t('common:action.save')}</Button>
        </>
      }>
        <FieldGroup>
      {disableStatus?.provider && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <div className="flex items-center gap-1.5 text-xs text-warning">
            <AppIcon name="caution" size={14} />
            <span>{t('failoverStatus.providerDisabledNote')}</span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto shrink-0 px-0 text-xs text-warning underline"
              onClick={() => onResetDisableDimension('provider')}
            >
              {t('failoverStatus.restoreDirect')}
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="provider-name">{t('columns.name')}</FieldLabel>
          <Input id="provider-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="OpenAI" />
        </Field>
      </div>
      <ProviderValueList label={t('columns.baseUrls')} placeholder="https://api.openai.com/v1" values={form.baseUrls} onChange={(baseUrls) => setForm((current) => ({ ...current, baseUrls }))} stripTrailingSlash disabledValues={disableStatus?.baseUrls} disabledNote={t('failoverStatus.disabledNote', { label: 'Base URL' })} onRestore={(value) => onResetDisableValue('base_url', value)} />
      <ProviderValueList
        label={t('form.apiKeys')}
        placeholder="sk-xxx"
        values={form.keys}
        onChange={(keys) => setForm((current) => ({ ...current, keys }))}
        notes={keyNotes}
        onNotesChange={setKeyNotes}
        notesPlaceholder={t('form.notesPlaceholder')}
        disabledValues={disableStatus?.keys}
        disabledNote={t('failoverStatus.disabledNote', { label: 'Key' })}
        onRestore={(value) => onResetDisableValue('key', value)}
      />
      <Field>
        <FieldLabel>{t('columns.models')}</FieldLabel>
        <div className="flex flex-col gap-2">
          <div ref={listRef} className="relative flex flex-col gap-2">
            {priceError && (
              <div role="alert" className="pointer-events-none absolute z-10 -translate-y-full translate-x-0 rounded-md border border-destructive/30 bg-background px-2.5 py-1 text-xs text-destructive shadow-md animate-in fade-in-0"
                style={priceErrorPos ? { left: priceErrorPos.left + 4, top: priceErrorPos.top - 8 } : undefined}>
                {t('price.errorPrefix')}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_12rem_calc(var(--spacing)*8)] items-center gap-2 px-1 text-xs text-muted-foreground">
              <span>{t('form.modelNamePlaceholder')}</span>
              <span>{t('price.columnPrice')}</span>
              <span>{t('price.columnEndpoint')}</span>
              <span />
            </div>
            {modelRows.map((model, index) => {
              const isPhantom = form.models.length === 0
              const referenceCandidates = referenceCandidatesFor(model.model)
              return (
                <div key={index} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_12rem_calc(var(--spacing)*8)] items-center gap-2">
                  <Input value={model.model} onChange={(event) => patchModel(index, { model: event.target.value })} className="w-full" placeholder={t('form.modelNamePlaceholder')} />
                  <ModelPriceCell
                    model={model}
                    onPatch={(patch) => patchModel(index, patch)}
                    onInvalid={(anchor) => showPriceError(anchor)}
                    referenceCandidates={referenceCandidates}
                    stale={referenceStaleFor(model)}
                    snapshotLoading={refSnapshot === null}
                    onPickReference={(name) => pickReference(index, name)}
                  />
                  <ModelEndpointEditor values={model.endpoints} candidates={endpointCandidates} onChange={(endpoints) => patchModel(index, { endpoints })} />
                  <Button type="button" variant="ghost" size="icon" disabled={isPhantom} onClick={() => removeModel(index)}><AppIcon name="delete" /></Button>
                </div>
              )
            })}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={openFetchDialog}>
                <AppIcon name="refresh" data-icon="inline-start" />{t('actions.fetchModels')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={t('actions.bulkPriceTitle')}
                disabled={bulkRefSetting}
                onClick={() => setBulkScopeOpen(true)}
              >
                {bulkRefSetting ? <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" /> : <AppIcon name="refresh" data-icon="inline-start" />}
                {t('actions.bulkPrice')}
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setForm((current) => ({ ...current, models: [...current.models, emptyProviderModel()] }))}>
              <AppIcon name="add" data-icon="inline-start" />{t('actions.addRow')}
            </Button>
          </div>
          {refSnapshotError && (
            <p role="alert" className="text-xs text-destructive">{refSnapshotError}</p>
          )}
        </div>
      </Field>
        </FieldGroup>
      </DialogScrollBody>
      {isFetchDialogOpen && (
        <FetchModelDialog
          endpoint={endpointDraft}
          onEndpointChange={setEndpointDraft}
          useKey={useKey}
          onUseKeyChange={onUseKeyChange}
          dedupeV1Suffix={form.dedupeV1Suffix}
          dedupeSaving={dedupeSaving}
          onDedupeV1SuffixChange={(next) => void handleDedupeV1SuffixChange(next)}
          fetching={isFetching}
          error={fetchError}
          models={fetchedModels}
          existingIds={new Set(form.models.map((model) => model.model))}
          onFetch={() => void handleFetchModels()}
          onClose={() => { setIsFetchDialogOpen(false); setFetchedModels(null) }}
          onConfirm={handleConfirmAddModels}
        />
      )}
      {/* 同步到其他供应商确认弹窗暂时注释：
      <Dialog open={syncTarget !== null} onOpenChange={(open) => { if (!open) setSyncTarget(null) }}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader><DialogTitle>{t('dialog.syncTitle')}</DialogTitle></DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button onClick={() => void syncReference()} disabled={refSyncing}>{refSyncing ? t('dialog.syncing') : t('dialog.syncConfirm')}</Button>
            </>
          }>
          <p>
            {t('dialog.syncQuestion', { model: syncTarget ?? '' })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('dialog.syncDetail')}
          </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
      */}
      <Dialog open={bulkScopeOpen} onOpenChange={(open) => { if (!open) setBulkScopeOpen(false) }}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader><DialogTitle>{t('dialog.bulkScopeTitle')}</DialogTitle></DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" disabled={bulkRefSetting} onClick={() => { setBulkScopeOpen(false); void applyModelsDevPricesForAll('reference') }}>{t('dialog.bulkScopeReference')}</Button>
              <Button disabled={bulkRefSetting} onClick={() => { setBulkScopeOpen(false); void applyModelsDevPricesForAll('all') }}>{t('dialog.bulkScopeAll')}</Button>
            </>
          }>
          <p className="text-sm text-muted-foreground">{t('dialog.bulkScopeQuestion')}</p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
    </>
  )
}

type ProviderValueListProps = {
  readonly label: string
  readonly placeholder: string
  readonly values: readonly string[]
  readonly onChange: (values: readonly string[]) => void
  readonly stripTrailingSlash?: boolean
  // When onNotesChange is provided, each row gets an optional remark input on
  // its right side; remarks live in a parallel array and are never validated.
  readonly notes?: readonly string[]
  readonly onNotesChange?: (notes: readonly string[]) => void
  readonly notesPlaceholder?: string
  // 被自动禁用（故障转移）的条目：值为 true 的行在下方追加一行备注
  // （disabledNote，如「当前 Key 已禁用」），右侧带「直接恢复」文字按钮，
  // 点击只恢复这一条。
  readonly disabledValues?: Readonly<Record<string, boolean>>
  readonly disabledNote?: string
  readonly onRestore?: (value: string) => void
}

export function ProviderValueList({ label, placeholder, values, onChange, stripTrailingSlash = false, notes, onNotesChange, notesPlaceholder, disabledValues, disabledNote, onRestore }: ProviderValueListProps) {
  const { t } = useTranslation('provider')
  const rows = values.length === 0 ? [''] : [...values]
  const withNotes = onNotesChange !== undefined
  const applyNote = (index: number, next: string) => {
    if (!onNotesChange) return
    const padded = [...(notes ?? [])]
    while (padded.length <= index) padded.push('')
    padded[index] = next
    onNotesChange(padded)
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {rows.map((value, index) => {
          const isPhantom = values.length === 0
          const trimmedValue = value.trim()
          const isAutoDisabled = !isPhantom && disabledValues?.[trimmedValue] === true
          const apply = (next: string) => {
            if (isPhantom) {
              onChange([next])
            } else {
              onChange(values.map((item, i) => (i === index ? next : item)))
            }
          }
          return (
            <Fragment key={index}>
              <div className="flex items-center gap-2">
                <Input
                  value={value}
                  onChange={(event) => apply(event.target.value)}
                  onBlur={stripTrailingSlash ? () => {
                    const trimmed = value.replace(/\/+$/, '')
                    if (trimmed !== value) apply(trimmed)
                  } : undefined}
                  placeholder={placeholder}
                  className={withNotes ? 'min-w-0 flex-1' : undefined}
                />
                {withNotes && (
                  <Input
                    value={notes?.[index] ?? ''}
                    onChange={(event) => applyNote(index, event.target.value)}
                    placeholder={notesPlaceholder ?? t('form.note')}
                    aria-label={t('form.noteAria', { label })}
                    className="w-40 shrink-0"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPhantom}
                  onClick={() => {
                    onChange(values.filter((_, i) => i !== index))
                    onNotesChange?.((notes ?? []).filter((_, i) => i !== index))
                  }}
                  aria-label={t('form.deleteValueAria', { label })}
                >
                  <AppIcon name="delete" />
                </Button>
              </div>
              {isAutoDisabled && (
                <div className="flex items-center gap-1.5 px-1 text-xs text-warning">
                  <AppIcon name="caution" size={14} />
                  <span>{disabledNote}</span>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto shrink-0 px-0 text-xs text-warning underline"
                    onClick={() => onRestore?.(trimmedValue)}
                  >
                    {t('failoverStatus.restoreDirect')}
                  </Button>
                </div>
              )}
            </Fragment>
          )
        })}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ''])}>
          <AppIcon name="add" data-icon="inline-start" />{t('actions.addRow')}
        </Button>
      </div>
    </Field>
  )
}

type ModelPriceCellProps = {
  readonly model: ProviderModel
  readonly onPatch: (patch: Partial<ProviderModel>) => void
  readonly onInvalid: (anchor: HTMLElement | null) => void
  readonly referenceCandidates: ReadonlyArray<{ readonly providerId: string; readonly providerName: string }>
  readonly stale: boolean
  readonly snapshotLoading: boolean
  // 同步到其他供应商：按钮与功能已暂时注释，相关 props 一并停用。
  // readonly syncing: boolean
  // readonly syncable: boolean
  readonly onPickReference: (providerName: string) => void
  // readonly onSync: () => void
}

type PriceMode = 'prices' | 'reference' | 'unset'

// Price cell: a dropdown choosing between 单独设置价格 (four per-1M-token
// price inputs), 模型价格参考供应商 (a models.dev reference supplier whose
// price snapshot is read-only, with an editable multiplier) and 不设置
// (legacy rows fall here and bill as 0). The row's right side carries 同步
// (copy this model's pricing to the same-named models of the other
// providers), hidden in 不设置 mode since the row carries no price data to act
// on. When the dialog opens and a reference supplier no longer exists on
// models.dev for the model, the dropdown turns red (stale) while the stored
// data stays untouched.
function ModelPriceCell({
  model,
  onPatch,
  onInvalid,
  referenceCandidates,
  stale,
  snapshotLoading,
  onPickReference,
}: ModelPriceCellProps) {
  const { t } = useTranslation('provider')
  const mode: PriceMode = model.referenceProvider !== null ? 'reference' : model.prices !== null ? 'prices' : 'unset'
  const setMode = (next: PriceMode) => {
    if (next === 'prices') {
      onPatch({ prices: { input: '', cacheWrite: '', cacheRead: '', output: '' }, referenceProvider: null, referencePrices: null, referenceAt: null, ratePriceConfigId: null })
    } else if (next === 'reference') {
      onPatch({ prices: null, referenceProvider: model.referenceProvider ?? '', referencePrices: model.referencePrices ?? null, referenceAt: model.referenceAt ?? null, ratePriceConfigId: null })
    } else {
      onPatch({ prices: null, referenceProvider: null, referencePrices: null, referenceAt: null, ratePriceConfigId: null })
    }
  }
  const handlePriceChange = (key: keyof ModelPrices, raw: string) => {
    const prices = model.prices ?? { input: '', cacheWrite: '', cacheRead: '', output: '' }
    const next = PRICE_PREFIX.test(raw) ? raw.replace(/\s+/g, '') : raw
    onPatch({ prices: { ...prices, [key]: next } })
  }
  const handlePriceBlur = (anchor: HTMLElement | null) => {
    const prices = model.prices
    if (!prices) return
    if (PRICE_FIELDS.some(({ key }) => {
      const value = prices[key].trim()
      return value !== '' && !PRICE_PREFIX.test(value)
    })) {
      onInvalid(anchor)
    }
  }

  const ref = model.referencePrices
  const fmt = (v: number): string => (Number.isFinite(v) && v > 0 ? `$${Number(v.toFixed(4)).toString()}` : '$0')
  const num = (v: number): string => (Number.isFinite(v) && v > 0 ? Number(v.toFixed(4)).toString() : '0')
  const refTooltipLines: string[] = model.referenceProvider !== null
    ? (ref
        ? [
            t('price.tooltip', { input: fmt(ref.input), cacheWrite: fmt(ref.cacheWrite), cacheRead: fmt(ref.cacheRead), output: fmt(ref.output) }),
            t('price.rateTooltip', { rate: model.rate || '1' }),
          ]
        : [t('price.noSnapshotRefresh')])
    : []
  const refTooltip = model.referenceProvider ? [model.referenceProvider, ...refTooltipLines].join('\n') : ''

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select value={mode} onValueChange={(value) => setMode(value as PriceMode)}>
        <SelectTrigger className="w-36 px-2 text-xs"><SelectPrimitive.Value /></SelectTrigger>
        <SelectContent>
          <SelectItem value="prices">{t('price.modePrices')}</SelectItem>
          <SelectItem value="reference">{t('price.modeReference')}</SelectItem>
          <SelectItem value="unset">{t('price.modeUnset')}</SelectItem>
        </SelectContent>
      </Select>
      {mode === 'prices' ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {PRICE_FIELDS.map(({ key }) => (
            <Input
              key={key}
              value={model.prices?.[key] ?? ''}
              onChange={(event) => handlePriceChange(key, event.target.value)}
              onBlur={(event) => handlePriceBlur(event.currentTarget)}
              className="min-w-0 flex-1 px-2 text-xs"
              placeholder={t(`price.fields.${key}`)}
              title={t('price.prefixTitle')}
            />
          ))}
        </div>
      ) : mode === 'reference' ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          title={refTooltip || undefined}
        >
          <Select
            value={model.referenceProvider ?? '__none__'}
            disabled={snapshotLoading}
            onValueChange={(value) => {
              if (value !== '__none__') onPickReference(value)
            }}
          >
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
                <SelectTrigger
                  className={`min-w-0 flex-1 overflow-hidden px-2 text-xs ${stale ? 'border-destructive ring-1 ring-destructive/30' : ''}`}
                >
                  <span className="sr-only">
                    <SelectPrimitive.Value>
                      {model.referenceProvider ?? ''}
                    </SelectPrimitive.Value>
                  </span>
                  {model.referenceProvider === null || model.referenceProvider === '' ? (
                    <span className="text-muted-foreground">{t('price.selectReference')}</span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                      <span className="min-w-[10px] shrink truncate">{model.referenceProvider}</span>
                      {ref ? (
                        <span className="shrink-0 text-muted-foreground tabular-nums">{num(ref.input)}·{num(ref.cacheWrite)}·{num(ref.cacheRead)}·{num(ref.output)}</span>
                      ) : (
                        <span className="shrink-0 text-destructive">{t('price.noSnapshot')}</span>
                      )}
                    </span>
                  )}
                </SelectTrigger>
              </TooltipTrigger>
              {refTooltip && (
                <TooltipContent side="bottom" align="start" className="max-w-none flex-col items-start gap-0.5">
                  <span className="font-medium">{model.referenceProvider}</span>
                  {refTooltipLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
            <SelectContent>
              {stale && model.referenceProvider !== null && model.referenceProvider.trim() !== '' && (
                <SelectItem value={model.referenceProvider}>{t('price.stale')}</SelectItem>
              )}
              {snapshotLoading ? (
                <SelectItem value="__none__" disabled>{t('common:state.loading')}</SelectItem>
              ) : referenceCandidates.length === 0 ? (
                <SelectItem value="__none__" disabled>{t('price.notFound')}</SelectItem>
              ) : referenceCandidates.map((provider) => (
                <SelectItem key={provider.providerId} value={provider.providerName}>
                  {provider.providerName}{isModelsDevLab(model.model, provider.providerId) ? t('price.official') : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={model.rate}
            onChange={(event) => onPatch({ rate: event.target.value })}
            disabled={model.referenceProvider === null}
            className="w-14 shrink-0 px-2 text-xs"
            placeholder="1"
            title={t('price.rateTitle')}
          />
        </div>
      ) : (
        <Input
          value={t('price.unsetPrice')}
          disabled
          readOnly
          title={t('price.unsetPriceTitle')}
          className="min-w-0 flex-1 px-2 text-xs"
        />
      )}
      {/* 同步到其他供应商按钮暂时注释：
      {mode !== 'unset' && (
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={syncing || !syncable} onClick={onSync} aria-label={t('price.syncAria')}>
                  {syncing ? <AppIcon name="progress_activity" className="animate-spin" /> : <AppIcon name="sync" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('price.syncAria')}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}
      */}
    </div>
  )
}

type FetchModelDialogProps = {
  readonly endpoint: string
  readonly onEndpointChange: (value: string) => void
  readonly useKey: boolean
  readonly onUseKeyChange: (next: boolean) => void
  readonly dedupeV1Suffix: boolean
  readonly dedupeSaving: boolean
  readonly onDedupeV1SuffixChange: (next: boolean) => void
  readonly fetching: boolean
  readonly error: string | null
  readonly models: readonly FetchedModel[] | null
  readonly existingIds: ReadonlySet<string>
  readonly onFetch: () => void
  readonly onClose: () => void
  readonly onConfirm: (ids: readonly string[], replace?: boolean) => void
}

function FetchModelDialog({ endpoint, onEndpointChange, useKey, onUseKeyChange, dedupeV1Suffix, dedupeSaving, onDedupeV1SuffixChange, fetching, error, models, existingIds, onFetch, onClose, onConfirm }: FetchModelDialogProps) {
  const { t } = useTranslation('provider')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)
  // 拉取结果到达后按「已存在的模型预先勾选」播种一次；existingIds 走 ref
  // （仅在 effect 中同步）避免表单每次输入生成新 Set 时重置用户的选择。
  const existingRef = useRef(existingIds)
  useEffect(() => { existingRef.current = existingIds }, [existingIds])
  useEffect(() => {
    if (!models) return
    setSelected(new Set(models.filter((model) => existingRef.current.has(model.id)).map((model) => model.id)))
  }, [models])

  const allSelected = !!models && models.length > 0 && models.every((model) => selected.has(model.id))

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleToggleSelectAll = () => {
    if (!models) return
    setSelected(allSelected ? new Set() : new Set(models.map((model) => model.id)))
  }

  const handleConfirm = () => {
    setSaving(true)
    onConfirm([...selected])
  }

  const handleReplaceAndAdd = () => {
    setSaving(true)
    onConfirm([...selected], true)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent width="xs" scrollFooter>
        <DialogHeader><DialogTitle>{t('actions.fetchModels')}</DialogTitle></DialogHeader>
        <DialogScrollBody footer={
          models ? (
            <>
              <Button variant="outline" disabled={saving} onClick={handleToggleSelectAll}>{allSelected ? t('fetchDialog.deselectAll') : t('fetchDialog.selectAll')}</Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button disabled={selected.size === 0 || saving} onClick={() => void handleReplaceAndAdd()}>{saving ? t('fetchDialog.adding') : t('fetchDialog.replaceAndAdd')}</Button>
                <Button disabled={selected.size === 0 || saving} onClick={() => void handleConfirm()}>{saving ? t('fetchDialog.adding') : t('fetchDialog.add')}</Button>
              </div>
            </>
          ) : (
            <Button disabled={fetching || dedupeSaving} onClick={onFetch}>
              {fetching ? <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" /> : <AppIcon name="refresh" data-icon="inline-start" />}
              {t('actions.fetchModels')}
            </Button>
          )
        }>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="model-list-endpoint">{t('dialog.endpointPathLabel')}</FieldLabel>
            <Input id="model-list-endpoint" value={endpoint} onChange={(event) => onEndpointChange(event.target.value)} placeholder="/v1/models" />
          </Field>
          <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={dedupeV1Suffix}
                disabled={dedupeSaving}
                onCheckedChange={(checked) => onDedupeV1SuffixChange(checked === true)}
              />
              <span className="text-foreground">{t('dialog.dedupeV1Suffix')}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('dialog.dedupeV1SuffixHint')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={useKey} onCheckedChange={(checked) => onUseKeyChange(checked === true)} />
              <span className="text-foreground">{t('dialog.endpointUseKey')}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('dialog.endpointUseKeyHint')}</p>
          </div>
          <Separator />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {models && (
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {models.map((model) => (
                <label key={model.id} className="flex cursor-pointer items-center gap-2 py-1">
                  <Checkbox checked={selected.has(model.id)} onCheckedChange={(checked) => toggle(model.id, checked === true)} />
                  <span className="text-foreground">{model.id}{model.name !== model.id && <span className="text-muted-foreground">（{model.name}）</span>}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}
