import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'

import { Checkbox } from '@/components/checkbox'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Dialog, DialogContent, DialogHeader, DialogScrollBody, DialogTitle } from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/tooltip'
import { toast } from '@/components/ui/toast'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Provider, ProviderDisableStatus, ProviderEndpoint, ProviderInput, ProviderModel, ModelPrices, FetchedModel, ModelReferencePrices } from '@/lib/dashboard-api'
import {
  findModelsDevProviderRow,
  isModelsDevLab,
  labProviderIdForModel,
  loadModelsDevModels,
  providersForModel,
  refreshModelsDevModels,
  type ModelsDevModel,
} from '@/lib/models-dev'

type ProviderFormProps = {
  readonly provider: Provider | null
  readonly onSave: (provider: ProviderInput) => void
  readonly onCancel: () => void
  readonly isSaving: boolean
  readonly useKey: boolean
  readonly onUseKeyChange: (next: boolean) => void
  readonly disableStatus: ProviderDisableStatus | null
  readonly onResetDisableDimension: (dimension: 'provider' | 'base_url' | 'key') => void
}

const emptyProvider: ProviderInput = {
  name: '', baseUrls: [], keys: [], keyNotes: {}, endpoints: [], models: [], status: true, workflowEnabled: true, autoDisabled: false,
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
const PRICE_ERROR_TEXT = '必须以 $ 或 ¥ 开头'
const PRICE_FIELDS: ReadonlyArray<{ readonly key: keyof ModelPrices; readonly placeholder: string }> = [
  { key: 'input', placeholder: '输入' },
  { key: 'cacheWrite', placeholder: '缓存写入' },
  { key: 'cacheRead', placeholder: '缓存读取' },
  { key: 'output', placeholder: '输出' },
]

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : '发生意外错误，请重试'
}

export function ProviderPage() {
  const [providers, setProviders] = useState<readonly Provider[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useKey, setUseKey] = useState(true)
  const [disableStatuses, setDisableStatuses] = useState<ReadonlyMap<string, ProviderDisableStatus>>(new Map())
  const [deleting, setDeleting] = useState<Provider | null>(null)

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
    const saved = await runMutation(() => editing
      ? dashboardApi.updateProvider(editing.id, provider)
      : dashboardApi.createProvider(provider))
    if (saved) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleResetDisableDimension = async (provider: Provider, dimension: 'provider' | 'base_url' | 'key') => {
    const reset = await runMutation(() => dashboardApi.resetProviderDisableDimension(provider.id, dimension))
    if (reset) toast('已恢复故障转移禁用状态')
  }

  const columns: ColumnDef<Provider>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, provider) => <span className="font-medium">{provider.name}</span> },
    { key: 'baseUrls', label: 'Base URLs', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs">{provider.baseUrls.length} URLs</span> },
    { key: 'keys', label: 'Keys', defaultWidth: { kind: 'pixel', value: 100 }, render: (_, provider) => <span className="text-xs">{provider.keys.length} Keys</span> },
    { key: 'endpoints', label: 'Endpoints', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs">{provider.endpoints.length} Endpoints</span> },
    {
      key: 'models',
      label: '模型',
      defaultWidth: { kind: 'pixel', value: 240 },
      render: (_, provider) => (
        <div className="flex flex-wrap gap-1">
          {provider.models.map((model) => <span key={model.model} className="text-xs">{model.model}</span>)}
        </div>
      ),
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, provider) => <span className={provider.status ? 'text-success' : 'text-destructive'}>{provider.status ? '启用' : '禁用'}</span>,
    },
    {
      key: 'autoDisabled',
      label: '故障转移',
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
                  <span>供应商 1/1</span>
                )}
                {urlDisabled > 0 && (
                  <span>base URL {urlDisabled}/{urlTotal}</span>
                )}
                {keyDisabled > 0 && (
                  <span>
                    key {keyDisabled}/{keyTotal}
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
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 220 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, provider) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.toggleProvider(provider.id))}>{provider.status ? '禁用' : '启用'}</Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(provider); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => setDeleting(provider)}><AppIcon name="delete" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="供应商"
        description="管理上游 API 供应商配置"
        status={`${total} 供应商`}
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
          emptyText="暂无供应商。添加一个供应商开始配置。"
          onRetry={() => void loadProviders()}
          actions={(
            <>
              <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving}>
                <AppIcon name="add" data-icon="inline-start" />添加供应商
              </Button>
            </>
          )}
        />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent width="md" scrollFooter>
            <DialogHeader><DialogTitle>{editing ? '编辑供应商' : '添加供应商'}</DialogTitle></DialogHeader>
            <ProviderForm provider={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} isSaving={isSaving} useKey={useKey} onUseKeyChange={setUseKey} disableStatus={editing ? disableStatuses.get(editing.id) ?? null : null} onResetDisableDimension={(dimension) => { if (editing) void handleResetDisableDimension(editing, dimension) }} />
          </DialogContent>
        </Dialog>

        <ConfirmDeleteDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title="确认删除"
          description={`将删除供应商「${deleting?.name ?? ''}」及其全部渠道配置，删除后不可恢复。`}
          busy={isSaving}
          onConfirm={() => {
            if (deleting) {
              const provider = deleting
              setDeleting(null)
              void runMutation(() => dashboardApi.deleteProvider(provider.id))
            }
          }}
        />
      </div>
    </div>
  )
}

function ProviderForm({ provider, onSave, onCancel, isSaving, useKey, onUseKeyChange, disableStatus, onResetDisableDimension }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderInput>(provider ?? emptyProvider)
  // Per-key remarks as a parallel array aligned with form.keys (array instead
  // of a key→note map so editing a key text keeps its note). Converted back to
  // the stored key→note map on save.
  const [keyNotes, setKeyNotes] = useState<readonly string[]>(() =>
    provider ? provider.keys.map((key) => provider.keyNotes[key] ?? '') : [],
  )
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const [globalDefaultEndpoint, setGlobalDefaultEndpoint] = useState<string | null>(null)
  const [endpointOverride, setEndpointOverride] = useState<string | null>(null)
  const [isEndpointDialogOpen, setIsEndpointDialogOpen] = useState(false)
  const [endpointDraft, setEndpointDraft] = useState('')
  const [isEndpointSaving, setIsEndpointSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
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
  const [allProviders, setAllProviders] = useState<readonly Provider[]>([])
  const [refRefreshing, setRefRefreshing] = useState(false)
  const [refSyncing, setRefSyncing] = useState(false)
  const [bulkRefSetting, setBulkRefSetting] = useState(false)
  const [syncTarget, setSyncTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRefSnapshotError(null)
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) setRefSnapshot(models)
      })
      .catch(() => {
        if (!cancelled) setRefSnapshotError('models.dev 数据加载失败，请检查网络')
      })
    void dashboardApi.listProviders({ limit: 10000, offset: 0 })
      .then((result) => {
        if (!cancelled) setAllProviders(result.providers)
      })
      .catch(() => {
        if (!cancelled) setAllProviders([])
      })
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

  const refreshReference = async (index: number) => {
    const model = form.models[index]
    if (!model || model.referenceProvider === null) return
    if (model.referenceProvider.trim() === '') {
      setRefSnapshotError('尚未选择参考供应商，请先在下拉中指定')
      return
    }
    setRefRefreshing(true)
    setRefSnapshotError(null)
    try {
      const fresh = await refreshModelsDevModels()
      setRefSnapshot(fresh)
      const row = findModelsDevProviderRow(fresh, model.model, model.referenceProvider)
      if (!row) {
        setRefSnapshotError(`参考供应商「${model.referenceProvider}」已不在 models.dev 的「${model.model}」供应商列表中，价格快照未更新`)
        return
      }
      patchModel(index, {
        referencePrices: refPricesOf(row),
        referenceAt: new Date().toISOString(),
      })
      toast('已从 models.dev 更新价格快照')
    } catch {
      setRefSnapshotError('models.dev 数据拉取失败，价格快照未被覆盖')
    } finally {
      setRefRefreshing(false)
    }
  }

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
      setRefSnapshotError(`models.dev 中未查到「${model.model}」在「${providerName}」下的价格，请点刷新重试`)
    }
  }

  // 一键为所有可从 models.dev 定价的模型（按弹窗当前 UI 状态判断，未保存
  // 也生效）拉取最新价格快照并填充：已处于「从 models.dev 参考」的按当前
  // 厂商（空则推断官方 lab 厂商）；「不设置」的自动推断官方 lab 厂商并升级
  // 为参考模式。手动「单独设置价格」的模型不覆盖，尊重用户自定义。
  const applyModelsDevPricesForAll = async () => {
    setBulkRefSetting(true)
    setRefSnapshotError(null)
    try {
      const fresh = await refreshModelsDevModels()
      setRefSnapshot(fresh)
      let filled = 0
      let vendorlessKept = 0
      const next = form.models.map((model) => {
        // 手动设置了价格（prices 模式）的模型不覆盖。
        if (model.prices !== null) return model
        // reference 有厂商直接用；reference 空厂商 / unset 推断官方 lab 厂商。
        const vendor = model.referenceProvider !== null && model.referenceProvider.trim() !== ''
          ? model.referenceProvider
          : labProviderIdForModel(model.model) ?? ''
        if (vendor === '') {
          // 推断不出官方厂商：保留现状（参考模式或按 0 计费）。
          vendorlessKept++
          return model
        }
        const row = findModelsDevProviderRow(fresh, model.model, vendor)
        if (!row) return model
        filled++
        return {
          ...model,
          prices: null,
          referenceProvider: row.providerName,
          referencePrices: refPricesOf(row),
          referenceAt: new Date().toISOString(),
        }
      })
      setForm((current) => ({ ...current, models: next }))
      if (filled > 0) {
        toast(`已为 ${filled} 个模型从 models.dev 设置价格`)
      } else if (vendorlessKept > 0) {
        toast(`${vendorlessKept} 个模型未在 models.dev 找到官方参考厂商，未自动设置`)
      } else {
        toast('没有可自动设置的模型')
      }
    } catch {
      setRefSnapshotError('models.dev 数据拉取失败，价格未设置')
    } finally {
      setBulkRefSetting(false)
    }
  }

  const syncReference = async () => {
    if (!syncTarget) return
    const src = form.models.find((m) => m.model.trim() === syncTarget.trim())
    if (!src) return
    setRefSyncing(true)
    setRefSnapshotError(null)
    try {
      const needle = src.model.trim().toLowerCase()
      let applied = 0
      for (const target of allProviders) {
        if (provider && target.id === provider.id) continue
        if (target.models.every((m) => m.model.trim().toLowerCase() !== needle)) continue
        const nextModels = target.models.map((m) =>
          m.model.trim().toLowerCase() === needle
            ? { ...m, rate: src.rate, referenceProvider: src.referenceProvider, referencePrices: src.referencePrices, referenceAt: src.referenceAt, prices: src.prices }
            : m,
        )
        await dashboardApi.updateProvider(target.id, { ...target, models: nextModels })
        applied++
      }
      const reloaded = await dashboardApi.listProviders({ limit: 10000, offset: 0 })
      setAllProviders(reloaded.providers)
      setSyncTarget(null)
      toast(`已同步到 ${applied} 个其他供应商的同名模型`)
    } catch (err) {
      setRefSnapshotError(`同步失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setRefSyncing(false)
    }
  }

  const syncTargetsFor = (modelName: string): number =>
    allProviders.filter((p) =>
      !(provider && p.id === provider.id) &&
      p.models.some((m) => m.model.trim().toLowerCase() === modelName.trim().toLowerCase()),
    ).length

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

  const handleFetchModels = async () => {
    if (!effectiveEndpoint) {
      setFetchError('请先在系统设置中配置默认模型列表接口，或点击齿轮设置接口地址')
      return
    }
    if (!effectiveEndpoint.startsWith('/')) {
      setFetchError('路径必须以斜杠开头（/）')
      return
    }
    const baseUrl = form.baseUrls[0]
    if (!baseUrl) {
      setFetchError('请先在上方填写 Base URLs')
      return
    }
    const fullUrl = `${baseUrl.replace(/\/+$/, '')}${effectiveEndpoint}`
    setFetchError(null)
    setIsFetching(true)
    try {
      const models = await dashboardApi.fetchModelsFromEndpoint(fullUrl, useKey ? form.keys[0] : undefined)
      const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
      setFetchedModels(sorted)
    } catch (error) {
      setFetchError(toErrorMessage(error))
    } finally {
      setIsFetching(false)
    }
  }

  const handleSaveEndpoint = async () => {
    setIsEndpointSaving(true)
    try {
      const trimmed = endpointDraft.trim()
      setEndpointOverride(trimmed === '' ? null : trimmed)
      setIsEndpointDialogOpen(false)
    } finally {
      setIsEndpointSaving(false)
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

  const updateEndpoints = (updater: (current: readonly ProviderEndpoint[]) => readonly ProviderEndpoint[]) => {
    setForm((current) => ({ ...current, endpoints: updater(current.endpoints) }))
  }

  const handleEndpointChange = (index: number, value: string) => {
    setForm((current) => {
      if (current.endpoints.length === 0) {
        return { ...current, endpoints: [{ pathSuffix: value }] }
      }
      return {
        ...current,
        endpoints: current.endpoints.map((endpoint, i) => (i === index ? { pathSuffix: value } : endpoint)),
      }
    })
  }

  // Normalize on blur: prepend "/" to non-empty paths, reject duplicates.
  const handleEndpointBlur = (index: number) => {
    if (form.endpoints.length === 0) return
    const raw = form.endpoints[index]?.pathSuffix ?? ''
    const trimmed = raw.trim()
    if (trimmed === '') {
      setEndpointError(null)
      return
    }
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    const isDuplicate = form.endpoints.some(
      (endpoint, i) => i !== index && endpoint.pathSuffix.trim() === normalized,
    )
    if (isDuplicate) {
      setEndpointError('该路径已添加')
      return
    }
    setEndpointError(null)
    if (normalized !== raw) {
      updateEndpoints((current) => current.map((endpoint, i) => (i === index ? { pathSuffix: normalized } : endpoint)))
    }
  }

  // Deleting an endpoint also strips that path from every model's endpoints.
  const handleEndpointDelete = (index: number) => {
    setForm((current) => {
      const path = current.endpoints[index]?.pathSuffix
      if (path === undefined) return current
      return {
        ...current,
        endpoints: current.endpoints.filter((_, i) => i !== index),
        models: current.models.map((item) =>
          item.endpoints.includes(path)
            ? { ...item, endpoints: item.endpoints.filter((endpoint) => endpoint !== path) }
            : item,
        ),
      }
    })
  }

  // One phantom editable row while the array is empty.
  const endpointRows = form.endpoints.length === 0 ? [{ pathSuffix: '' }] : form.endpoints
  const modelRows = form.models.length === 0
    ? [emptyProviderModel()]
    : form.models

  const handleSave = () => {
    const endpoints = form.endpoints
      .map((endpoint) => ({ pathSuffix: endpoint.pathSuffix.trim() }))
      .filter((endpoint) => endpoint.pathSuffix !== '')
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
  }

  // 内容区滚动 + 固定底部按钮栏：交给标准组件 DialogScrollBody。

  return (
    <>
      <DialogScrollBody footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>取消</Button>
          <Button disabled={isSaving || !form.name.trim()} onClick={handleSave}>{isSaving ? '保存中...' : '保存'}</Button>
        </>
      }>
        <FieldGroup>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="provider-name">名称</FieldLabel>
          <Input id="provider-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="OpenAI" />
        </Field>
      </div>
      {disableStatus && (() => {
        const rows = [
          {
            label: 'Provider',
            count: disableStatus.provider ? 1 : 0,
            dimension: 'provider' as const,
          },
          {
            label: 'Base URL',
            count: Object.values(disableStatus.baseUrls).filter(Boolean).length,
            dimension: 'base_url' as const,
          },
          {
            label: 'Key',
            count: Object.values(disableStatus.keys).filter(Boolean).length,
            dimension: 'key' as const,
          },
        ].filter((row) => row.count > 0)
        if (rows.length === 0) return null
        return (
          <div className="rounded-none border border-border bg-muted p-3">
            <div className="mb-2 text-xs font-medium">故障转移</div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs">
              {rows.map((row) => (
                <div key={row.dimension} className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {row.label} 禁用 {row.count} 个
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onResetDisableDimension(row.dimension)}
                  >
                    <AppIcon name="refresh" data-icon="inline-start" />
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
      <ProviderValueList label="Base URLs" placeholder="https://api.openai.com/v1" values={form.baseUrls} onChange={(baseUrls) => setForm((current) => ({ ...current, baseUrls }))} stripTrailingSlash />
      <ProviderValueList
        label="API Keys"
        placeholder="sk-xxx"
        values={form.keys}
        onChange={(keys) => setForm((current) => ({ ...current, keys }))}
        notes={keyNotes}
        onNotesChange={setKeyNotes}
        notesPlaceholder="备注（可选）"
      />
      <Field>
        <FieldLabel>Endpoints</FieldLabel>
        <div className="flex flex-col gap-2">
          <div className="space-y-2">
            {endpointRows.map((endpoint, index) => {
              const isPhantom = form.endpoints.length === 0
              return (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={endpoint.pathSuffix}
                    onChange={(event) => handleEndpointChange(index, event.target.value)}
                    onBlur={() => handleEndpointBlur(index)}
                    placeholder="如 /chat/completions 或 /responses"
                  />
                  <Button type="button" variant="ghost" size="icon" disabled={isPhantom} onClick={() => handleEndpointDelete(index)} aria-label="删除 Endpoint">
                    <AppIcon name="delete" />
                  </Button>
                </div>
              )
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => updateEndpoints((current) => [...current, { pathSuffix: '' }])}>
              <AppIcon name="add" data-icon="inline-start" />添加一行
            </Button>
          </div>
          {endpointError && <p role="alert" className="text-xs text-destructive">{endpointError}</p>}
          <p className="text-xs text-muted-foreground">
            填写请求允许访问的路径（必须以 / 开头）；不填写任何 endpoint 表示不限制请求路径
          </p>
        </div>
      </Field>
      <Field>
        <FieldLabel>模型</FieldLabel>
        <div className="flex flex-col gap-2">
          <div ref={listRef} className="relative flex flex-col gap-2">
            {priceError && (
              <div role="alert" className="pointer-events-none absolute z-10 -translate-y-full translate-x-0 rounded-md border border-destructive/30 bg-background px-2.5 py-1 text-xs text-destructive shadow-md animate-in fade-in-0"
                style={priceErrorPos ? { left: priceErrorPos.left + 4, top: priceErrorPos.top - 8 } : undefined}>
                {PRICE_ERROR_TEXT}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_12rem_2rem] items-center gap-2 px-1 text-xs text-muted-foreground">
              <span>模型名称</span>
              <span>价格</span>
              <span>Endpoint</span>
              <span />
            </div>
            {modelRows.map((model, index) => {
              const endpointValue = model.endpoints[0] && form.endpoints.some((item) => item.pathSuffix === model.endpoints[0]) ? model.endpoints[0] : '__unset__'
              const isPhantom = form.models.length === 0
              const referenceCandidates = referenceCandidatesFor(model.model)
              return (
                <div key={index} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_12rem_2rem] items-center gap-2">
                  <Input value={model.model} onChange={(event) => patchModel(index, { model: event.target.value })} className="w-full" placeholder="模型名称" />
                  <ModelPriceCell
                    model={model}
                    onPatch={(patch) => patchModel(index, patch)}
                    onInvalid={(anchor) => showPriceError(anchor)}
                    referenceCandidates={referenceCandidates}
                    stale={referenceStaleFor(model)}
                    snapshotLoading={refSnapshot === null}
                    syncing={refSyncing}
                    refreshing={refRefreshing}
                    syncable={syncTargetsFor(model.model) > 0}
                    onPickReference={(name) => pickReference(index, name)}
                    onRefresh={() => void refreshReference(index)}
                    onSync={() => setSyncTarget(model.model)}
                  />
                  <Select
                    value={endpointValue}
                    onValueChange={(value) => patchModel(index, { endpoints: value === '__unset__' ? [] : [value] })}
                  >
                    <SelectTrigger className="w-full"><SelectPrimitive.Value placeholder="未设置" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem key="__unset__" value="__unset__">未设置</SelectItem>
                      {form.endpoints.map((endpoint) => (
                        <SelectItem key={endpoint.pathSuffix} value={endpoint.pathSuffix}>{endpoint.pathSuffix}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" disabled={isPhantom} onClick={() => removeModel(index)}><AppIcon name="delete" /></Button>
                </div>
              )
            })}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, models: [...current.models, emptyProviderModel()] }))}>
                <AppIcon name="add" data-icon="inline-start" />添加一行
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void handleFetchModels()}>
                {isFetching ? <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" /> : <AppIcon name="refresh" data-icon="inline-start" />}
                从上游获取模型
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="一键从 models.dev 设置价格：参考模式的模型按参考厂商更新；未设置价格的模型自动匹配官方（lab）参考厂商。手动单独设置价格的模型不覆盖。"
                disabled={bulkRefSetting}
                onClick={() => void applyModelsDevPricesForAll()}
              >
                {bulkRefSetting ? <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" /> : <AppIcon name="refresh" data-icon="inline-start" />}
                一键设置 models.dev 供应商
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => { setEndpointDraft(effectiveEndpoint ?? ''); setIsEndpointDialogOpen(true) }}>
                <AppIcon name="settings" />
              </Button>
            </div>
          </div>
          {fetchError && (
            <p role="alert" className="text-xs text-destructive">{fetchError}</p>
          )}
          {refSnapshotError && (
            <p role="alert" className="text-xs text-destructive">{refSnapshotError}</p>
          )}
        </div>
      </Field>
        </FieldGroup>
      </DialogScrollBody>
      <Dialog open={isEndpointDialogOpen} onOpenChange={setIsEndpointDialogOpen}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader><DialogTitle>模型列表接口</DialogTitle></DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={() => setIsEndpointDialogOpen(false)}>取消</Button>
              <Button onClick={() => void handleSaveEndpoint()} disabled={isEndpointSaving}>{isEndpointSaving ? '保存中...' : '保存'}</Button>
            </>
          }>
          <div className="flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="model-list-endpoint">模型列表接口路径</FieldLabel>
              <Input id="model-list-endpoint" value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="/v1/models" />
              <p className="text-xs text-muted-foreground">路径必须以斜杠开头（/），将拼接在 Base URL 之后</p>
            </Field>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={useKey} onCheckedChange={(checked) => onUseKeyChange(checked === true)} />
              <span className="text-foreground">是否传入 Key</span>
            </label>
            <p className="text-xs text-muted-foreground">将使用当前供应商的第一个 Key 作为 Bearer 凭证</p>
          </div>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
      {fetchedModels && (
        <FetchModelDialog
          models={fetchedModels}
          existingIds={new Set(form.models.map((model) => model.model))}
          onClose={() => setFetchedModels(null)}
          onConfirm={handleConfirmAddModels}
        />
      )}
      <Dialog open={syncTarget !== null} onOpenChange={(open) => { if (!open) setSyncTarget(null) }}>
        <DialogContent width="xs" scrollFooter>
          <DialogHeader><DialogTitle>同步价格设置</DialogTitle></DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="outline" onClick={() => setSyncTarget(null)} disabled={refSyncing}>取消</Button>
              <Button onClick={() => void syncReference()} disabled={refSyncing}>{refSyncing ? '同步中...' : '确认同步'}</Button>
            </>
          }>
          <p>
            确认将模型「{syncTarget ?? ''}」的当前价格设置同步到其他供应商的同名模型？
          </p>
          <p className="text-xs text-muted-foreground">
            会将价格模式、参考供应商、价格快照和倍率一起写入其他供应商的同名模型。
          </p>
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
}

function ProviderValueList({ label, placeholder, values, onChange, stripTrailingSlash = false, notes, onNotesChange, notesPlaceholder = '备注' }: ProviderValueListProps) {
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
          const apply = (next: string) => {
            if (isPhantom) {
              onChange([next])
            } else {
              onChange(values.map((item, i) => (i === index ? next : item)))
            }
          }
          return (
            <div key={index} className="flex items-center gap-2">
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
                  placeholder={notesPlaceholder}
                  aria-label={`${label} 备注`}
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
                aria-label={`删除${label}`}
              >
                <AppIcon name="delete" />
              </Button>
            </div>
          )
        })}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ''])}>
          <AppIcon name="add" data-icon="inline-start" />添加一行
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
  readonly refreshing: boolean
  readonly syncing: boolean
  readonly syncable: boolean
  readonly onPickReference: (providerName: string) => void
  readonly onRefresh: () => void
  readonly onSync: () => void
}

type PriceMode = 'prices' | 'reference' | 'unset'

// Price cell: a dropdown choosing between 单独设置价格 (four per-1M-token
// price inputs), 模型价格参考供应商 (a models.dev reference supplier whose
// price snapshot is read-only, with an editable multiplier) and 不设置
// (legacy rows fall here and bill as 0). The row's right side carries 刷新
// (re-check the reference supplier upstream and re-snapshot) and 同步
// (copy this model's pricing to the same-named models of the other
// providers). Both icons are hidden in 不设置 mode since the row carries no
// price data to act on. When the dialog opens and a reference supplier no
// longer exists on models.dev for the model, the dropdown turns red (stale)
// while the stored data stays untouched.
function ModelPriceCell({
  model,
  onPatch,
  onInvalid,
  referenceCandidates,
  stale,
  snapshotLoading,
  refreshing,
  syncing,
  syncable,
  onPickReference,
  onRefresh,
  onSync,
}: ModelPriceCellProps) {
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
            `输入 ${fmt(ref.input)} · 缓存写 ${fmt(ref.cacheWrite)} · 缓存读 ${fmt(ref.cacheRead)} · 输出 ${fmt(ref.output)}`,
            `倍率 ${model.rate || '1'}`,
          ]
        : ['尚未获取价格快照，请点刷新'])
    : []
  const refTooltip = model.referenceProvider ? [model.referenceProvider, ...refTooltipLines].join('\n') : ''

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select value={mode} onValueChange={(value) => setMode(value as PriceMode)}>
        <SelectTrigger className="w-36 px-2 text-xs"><SelectPrimitive.Value /></SelectTrigger>
        <SelectContent>
          <SelectItem value="prices">单独设置价格</SelectItem>
          <SelectItem value="reference">从 models.dev 同步</SelectItem>
          <SelectItem value="unset">不设置</SelectItem>
        </SelectContent>
      </Select>
      {mode === 'prices' ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {PRICE_FIELDS.map(({ key, placeholder }) => (
            <Input
              key={key}
              value={model.prices?.[key] ?? ''}
              onChange={(event) => handlePriceChange(key, event.target.value)}
              onBlur={(event) => handlePriceBlur(event.currentTarget)}
              className="min-w-0 flex-1 px-2 text-xs"
              placeholder={placeholder}
              title="以 $ 或 ¥ 开头"
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
              <TooltipTrigger asChild>
                <SelectTrigger
                  className={`min-w-0 flex-1 overflow-hidden px-2 text-xs ${stale ? 'border-destructive ring-1 ring-destructive/30' : ''}`}
                >
                  <span className="sr-only">
                    <SelectPrimitive.Value>
                      {model.referenceProvider ?? ''}
                    </SelectPrimitive.Value>
                  </span>
                  {model.referenceProvider === null || model.referenceProvider === '' ? (
                    <span className="text-muted-foreground">选择参考厂商</span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                      <span className="min-w-[10px] shrink truncate">{model.referenceProvider}</span>
                      {ref ? (
                        <span className="shrink-0 text-muted-foreground tabular-nums">{num(ref.input)}·{num(ref.cacheWrite)}·{num(ref.cacheRead)}·{num(ref.output)}</span>
                      ) : (
                        <span className="shrink-0 text-destructive">尚未获取快照</span>
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
                <SelectItem value={model.referenceProvider}>参考供应商已从 models.dev 下架</SelectItem>
              )}
              {snapshotLoading ? (
                <SelectItem value="__none__" disabled>加载中…</SelectItem>
              ) : referenceCandidates.length === 0 ? (
                <SelectItem value="__none__" disabled>未在 models.dev 查到该模型</SelectItem>
              ) : referenceCandidates.map((provider) => (
                <SelectItem key={provider.providerId} value={provider.providerName}>
                  {provider.providerName}{isModelsDevLab(model.model, provider.providerId) ? '（官方）' : ''}
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
            title="倍率，支持分数，如 1/2"
          />
        </div>
      ) : (
        <Input
          value="未设置价格，计费按 0"
          disabled
          readOnly
          title="不设置价格，计费按 0"
          className="min-w-0 flex-1 px-2 text-xs"
        />
      )}
      {mode !== 'unset' && (
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={model.referenceProvider === null || refreshing || snapshotLoading} onClick={onRefresh} aria-label="刷新参考价格">
            {refreshing ? <AppIcon name="progress_activity" className="animate-spin" /> : <AppIcon name="refresh" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={syncing || !syncable} onClick={onSync} aria-label="同步到其他供应商">
            {syncing ? <AppIcon name="progress_activity" className="animate-spin" /> : <AppIcon name="sync" />}
          </Button>
        </div>
      )}
    </div>
  )
}

type FetchModelDialogProps = {
  readonly models: readonly FetchedModel[]
  readonly existingIds: ReadonlySet<string>
  readonly onClose: () => void
  readonly onConfirm: (ids: readonly string[], replace?: boolean) => void
}

function FetchModelDialog({ models, existingIds, onClose, onConfirm }: FetchModelDialogProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(models.filter((model) => existingIds.has(model.id)).map((model) => model.id)),
  )
  const [saving, setSaving] = useState(false)

  const allSelected = models.length > 0 && models.every((model) => selected.has(model.id))

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleToggleSelectAll = () => {
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
        <DialogHeader><DialogTitle>从上游获取模型</DialogTitle></DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" disabled={saving} onClick={handleToggleSelectAll}>{allSelected ? '全不选' : '全选'}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button disabled={selected.size === 0 || saving} onClick={() => void handleReplaceAndAdd()}>{saving ? '添加中...' : '清空已有并添加'}</Button>
              <Button disabled={selected.size === 0 || saving} onClick={() => void handleConfirm()}>{saving ? '添加中...' : '添加'}</Button>
            </div>
          </>
        }>
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {models.map((model) => (
            <label key={model.id} className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox checked={selected.has(model.id)} onCheckedChange={(checked) => toggle(model.id, checked === true)} />
              <span className="text-foreground">{model.id}{model.name !== model.id && <span className="text-muted-foreground">（{model.name}）</span>}</span>
            </label>
          ))}
        </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  )
}
