import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'

import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModelAutocomplete } from '@/components/ModelAutocomplete'
import { cn } from '@/lib/utils'
import {
  findModelsDevProviderRow,
  loadModelsDevModels,
  providersForModel,
  type ModelsDevModel,
} from '@/lib/models-dev'
import { getModelNameConflicts } from '@/lib/model-name-validation'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { PriceConfig, PriceConfigInput } from '@/lib/dashboard-api'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly prices: readonly PriceConfig[]; readonly total: number }

type EditingPrice = PriceConfig | null

type ExistingNamesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly prices: readonly PriceConfig[] }
  | { readonly kind: 'error' }

const emptyPrice: PriceConfigInput = {
  model: '',
  inputPrice: 0,
  outputPrice: 0,
  cacheWritePrice: 0,
  cacheReadPrice: 0,
  contextLength: 0,
  maxToken: 0,
  supportedTypes: [],
  aliases: [],
  endpoints: [],
  thinkingLevels: [],
  rate: [],
}

function toErrorMessage(err: unknown): string {
  if (err instanceof DashboardApiError) return err.message
  return err instanceof Error ? err.message : '发生意外错误，请重试'
}


export function PricePage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [mutating, setMutating] = useState(false)
  const [editing, setEditing] = useState<EditingPrice>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [currency, setCurrency] = useState<'USD' | 'CNY'>('CNY')
  const [rate, setRate] = useState(7.2)
  const [deleteTarget, setDeleteTarget] = useState<{ readonly id: string; readonly referenced: boolean; readonly refs: readonly import('@/lib/dashboard-api').PriceReference[] } | null>(null)

  useEffect(() => {
    dashboardApi
      .getSettings()
      .then((settings) => {
        const currencySetting = settings.find((s) => s.key === 'billing_currency')
        setCurrency(currencySetting?.value === 'USD' ? 'USD' : 'CNY')
        const rateSetting = settings.find((s) => s.key === 'exchange_rate_usd_cny')
        const rateValue = Number(rateSetting?.value)
        if (Number.isFinite(rateValue) && rateValue > 0) setRate(rateValue)
      })
      .catch(() => {})
  }, [])

  const symbol = currency === 'CNY' ? '¥' : '$'
  const formatPrice = (usd: number): string => {
    const value = currency === 'CNY' ? usd * rate : usd
    return `${symbol}${value.toFixed(2)}`
  }

  const fetch = useCallback(async () => {
    try {
      const result = await dashboardApi.listPrices({ limit, offset })
      setState({ kind: 'ready', prices: result.prices, total: result.total })
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    }
  }, [limit, offset])

  useEffect(() => {
    void fetch()
  }, [fetch])

  const handleDeleteRequest = async (id: string) => {
    setMutating(true)
    try {
      const refs = await dashboardApi.priceReferences(id)
      setDeleteTarget({ id, referenced: refs.length > 0, refs })
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    } finally {
      setMutating(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setMutating(true)
    try {
      await dashboardApi.deletePrice(deleteTarget.id)
      setDeleteTarget(null)
      await fetch()
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    } finally {
      setMutating(false)
    }
  }

  const handleSave = async (input: PriceConfigInput) => {
    setMutating(true)
    try {
      if (editing) {
        await dashboardApi.updatePrice(editing.id, input)
      } else {
        await dashboardApi.createPrice(input)
      }
      await fetch()
      setEditing(null)
      setIsOpen(false)
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    } finally {
      setMutating(false)
    }
  }

  const columns: ColumnDef<PriceConfig>[] = [
    {
      key: 'model',
      label: '模型',
      defaultWidth: { kind: 'pixel', value: 240 },
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <span>{row.model}</span>
          <span className="text-xs text-muted-foreground">· {row.providerId || '默认'}</span>
          {row.cacheWritePrice === 0 && row.cacheReadPrice === 0 && (
            <span className="text-xs text-muted-foreground">无缓存</span>
          )}
        </div>
      ),
    },
    {
      key: 'contextLength',
      label: 'context',
      defaultWidth: { kind: 'pixel', value: 110 },
      defaultAlign: 'right',
      accessor: (row) => (row.contextLength > 0 ? row.contextLength.toLocaleString() : null),
    },
    {
      key: 'maxToken',
      label: 'max token',
      defaultWidth: { kind: 'pixel', value: 110 },
      defaultAlign: 'right',
      accessor: (row) => (row.maxToken > 0 ? row.maxToken.toLocaleString() : null),
    },
    {
      key: 'supportedTypes',
      label: '支持类型',
      defaultWidth: { kind: 'pixel', value: 150 },
      accessor: (row) => (row.supportedTypes.length > 0 ? row.supportedTypes.join(', ') : null),
    },
    {
      key: 'price',
      label: '价格',
      defaultWidth: { kind: 'pixel', value: 220 },
      defaultAlign: 'right',
      defaultOverflow: 'wrap',
      render: (_, row) => {
        const label = (text: string) => <span className="text-muted-foreground">{text}</span>
const price = (usd: number) =>
            usd > 0 ? (
              <span>{formatPrice(usd)}</span>
            ) : (
              <span>-</span>
            )
        return (
          <div className="text-xs tabular-nums">
            {label('输入')} {price(row.inputPrice)}{' '}
            {label('缓存写入')} {price(row.cacheWritePrice)}{' '}
            {label('缓存读取')} {price(row.cacheReadPrice)}{' '}
            {label('输出')} {price(row.outputPrice)}
          </div>
        )
      },
    },
    {
      key: 'actions',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 100 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            disabled={mutating}
            onClick={(e) => {
              e.stopPropagation()
              setEditing(row)
              setIsOpen(true)
            }}
          >
            <AppIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={mutating}
            onClick={(e) => {
              e.stopPropagation()
              void handleDeleteRequest(row.id)
            }}
          >
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="模型信息"
        description="配置每个模型的输入/输出价格与上下文长度"
        status={
          state.kind === 'ready'
            ? `${state.total} 条`
            : state.kind === 'loading'
              ? '加载中'
              : undefined
        }
      />
      <div className="p-6">
        <DataTable
          id="price"
          columns={columns}
          data={state.kind === 'ready' ? state.prices : []}
          total={state.kind === 'ready' ? state.total : 0}
          loading={state.kind === 'loading'}
          error={state.kind === 'error' ? state.message : null}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText="暂无模型配置，点击「添加模型」创建第一条"
          onRetry={() => void fetch()}
          actions={
            <>
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加模型
              </Button>
            </>
          }
        />

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent width="sm">
            <DialogHeader>
              <DialogTitle>{editing ? '编辑模型' : '添加模型'}</DialogTitle>
            </DialogHeader>
            <PriceForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} currency={currency} rate={rate} />
          </DialogContent>
        </Dialog>

            <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DialogContent width="xs">
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
            </DialogHeader>
            {deleteTarget?.referenced ? (
              <p>
                删除后，以下供应商的模型价格计算将受到影响（共 {deleteTarget.refs.length} 处）：
                {deleteTarget.refs.map((ref) => (
                  <span key={ref.providerId} className="mt-2 block text-muted-foreground">
                    {ref.providerName}（{ref.model}）
                  </span>
                ))}
              </p>
            ) : (
              <p>确定要删除这条模型配置吗？</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="destructive" disabled={mutating} onClick={() => void handleDeleteConfirm()}>
                {mutating ? '删除中...' : '确认删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function PriceForm({
  initial,
  onSave,
  onCancel,
  saving,
  currency,
  rate,
}: {
  initial: EditingPrice
  onSave: (input: PriceConfigInput) => void
  onCancel: () => void
  saving: boolean
  currency: 'USD' | 'CNY'
  rate: number
}) {
  const toDisplay = (usd: number): number => (currency === 'CNY' ? usd * rate : usd)
  const toUsd = (display: number): number => (currency === 'CNY' ? display / rate : display)
  const [form, setForm] = useState<PriceConfigInput>(initial ? toDisplayInput(initial, toDisplay) : emptyPrice)
  // The upstream-supplier text restores from the persisted provider_id; an
  // empty value is normalized to the 默认 sentinel on save.
  const [providerName, setProviderName] = useState<string>(initial?.providerId ?? '')
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [existingNames, setExistingNames] = useState<ExistingNamesState>({ kind: 'loading' })

  useEffect(() => {
    if (!initial) {
      setForm(emptyPrice)
      setProviderName('')
      return
    }
    const convert = (usd: number): number => (currency === 'CNY' ? usd * rate : usd)
    setForm({
      ...toInput(initial),
      inputPrice: convert(initial.inputPrice),
      outputPrice: convert(initial.outputPrice),
      cacheWritePrice: convert(initial.cacheWritePrice),
      cacheReadPrice: convert(initial.cacheReadPrice),
    })
    setProviderName(initial.providerId ?? '')
  }, [initial, currency, rate])

  const symbol = currency === 'CNY' ? '¥' : '$'
  const unitLabel = `(${symbol}/1M tokens)`

  useEffect(() => {
    let cancelled = false
    void dashboardApi.listPrices({ limit: 10000, offset: 0 })
      .then((result) => {
        if (!cancelled) setExistingNames({ kind: 'ready', prices: result.prices })
      })
      .catch(() => {
        if (!cancelled) setExistingNames({ kind: 'error' })
      })
    return () => { cancelled = true }
  }, [initial?.id])

  const splitList = (value: string): string[] =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

  // Preload the models.dev snapshot the moment the dialog opens so the
  // upstream-supplier candidates are ready without any extra interaction.
  useEffect(() => {
    let cancelled = false
    setSnapshotError(null)
    loadModelsDevModels()
      .then((models) => {
        if (!cancelled) setSnapshot(models)
      })
      .catch(() => {
        if (!cancelled) setSnapshotError('models.dev 数据加载失败，请检查网络')
      })
    return () => { cancelled = true }
  }, [])

  // Upstream-supplier candidates: every models.dev provider that carries the
  // committed model name (exact, case-insensitive).
  const providers = useMemo(
    () => providersForModel(snapshot ?? [], form.model),
    [snapshot, form.model],
  )

  const fillFromProvider = (pid: string) => {
    if (snapshot === null) return
    const row = findModelsDevProviderRow(snapshot, form.model, pid)
    if (!row) return
    setForm((current) => ({
      ...current,
      inputPrice: toDisplay(row.inputPrice),
      outputPrice: toDisplay(row.outputPrice),
      cacheWritePrice: toDisplay(row.cacheWritePrice),
      cacheReadPrice: toDisplay(row.cacheReadPrice),
      contextLength: row.contextLength,
      maxToken: row.maxOutput,
      supportedTypes: [...new Set([...row.inputTypes, ...row.outputTypes])],
    }))
  }

  const handleProviderSelect = (name: string | null) => {
    setProviderName(name ?? '')
    if (name) fillFromProvider(name)
  }

  // Model name commits (pick or blur). A pick from the enriched candidate list
  // sets the upstream supplier via onPickProvider; a typed commit only touches
  // the model name.
  const handleModelChange = (model: string) => {
    setForm((current) => ({ ...current, model: model.toLowerCase() }))
  }

  const handlePickProvider = (provider: string) => {
    setProviderName(provider)
    fillFromProvider(provider)
  }

  // 「从 models.dev 获取信息」: query the committed model name + supplier.
  const handleFetchFromModelsDev = () => {
    setFetchError(null)
    const model = form.model.trim().toLowerCase()
    if (!model) {
      setFetchError('请先填写模型名称')
      return
    }
    if (snapshot === null) {
      setFetchError('models.dev 数据加载失败，请检查网络')
      return
    }
    if (!providerName.trim()) {
      setFetchError('请先填写上游供应商')
      return
    }
    // Look up the exact (model, supplier) pair in models.dev; a miss shows the
    // alignment warning instead of guessing on the model name alone.
    const row = findModelsDevProviderRow(snapshot, model, providerName)
    if (!row) {
      setFetchError('没有查到对应的模型信息。请检查模型名称和上游供应商是否填写正确。')
      return
    }
    setForm((current) => ({
      ...current,
      model: row.id.toLowerCase(),
      inputPrice: toDisplay(row.inputPrice),
      outputPrice: toDisplay(row.outputPrice),
      cacheWritePrice: toDisplay(row.cacheWritePrice),
      cacheReadPrice: toDisplay(row.cacheReadPrice),
      contextLength: row.contextLength,
      maxToken: row.maxOutput,
      supportedTypes: [...new Set([...row.inputTypes, ...row.outputTypes])],
    }))
  }

  const handleSave = () => {
    const payload = {
      ...form,
      model: form.model.trim().toLowerCase(),
      inputPrice: toUsd(form.inputPrice),
      outputPrice: toUsd(form.outputPrice),
      cacheWritePrice: toUsd(form.cacheWritePrice),
      cacheReadPrice: toUsd(form.cacheReadPrice),
    }
    const normalizedProvider = providerName.trim() || '默认'
    onSave({ ...payload, providerId: normalizedProvider })
  }

  const nameConflicts = existingNames.kind === 'ready'
    ? getModelNameConflicts(form, existingNames.prices, initial?.id ?? null)
    : []
  const nameValidationMessages = nameConflicts.map((conflict) => (
    conflict.source === 'history'
      ? `「${conflict.name}」已被历史模型或别名占用`
      : `「${conflict.name}」在当前模型名称和别名中重复`
  ))
  const valid =
    form.model.trim().length > 0 &&
    form.inputPrice >= 0 &&
    form.outputPrice >= 0 &&
    form.contextLength >= 0 &&
    form.maxToken >= 0 &&
    existingNames.kind === 'ready' &&
    nameConflicts.length === 0

  return (
    <FieldGroup>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="price-model">模型名称</FieldLabel>
          <ModelAutocomplete
            value={form.model}
            onChange={handleModelChange}
            searchable
            onPickProvider={handlePickProvider}
          />
          <p className="text-xs text-muted-foreground">大小写不敏感，保存后统一转为小写</p>
        </Field>
        <Field>
          <FieldLabel htmlFor="price-provider">上游供应商</FieldLabel>
          <ProviderSelect providers={providers} value={providerName} onSelect={handleProviderSelect} />
          <p className="text-xs text-muted-foreground">选填；不填将保存为「默认」</p>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={snapshot === null}
          onClick={handleFetchFromModelsDev}
        >
          <AppIcon name="refresh" data-icon="inline-start" />
          从 models.dev 获取信息
        </Button>
        {fetchError && <p role="alert" className="text-xs text-destructive">{fetchError}</p>}
      </div>
      {snapshotError && <p role="alert" className="text-xs text-destructive">{snapshotError}</p>}
      {existingNames.kind === 'loading' && <p className="text-xs text-muted-foreground">正在检查历史模型名称...</p>}
      {existingNames.kind === 'error' && <p role="alert" className="text-xs text-destructive">无法检查历史模型名称，请稍后重试</p>}
      <Field>
        <FieldLabel htmlFor="price-aliases">匹配更多名称</FieldLabel>
        <Input
          id="price-aliases"
          value={form.aliases.join(', ')}
          onChange={(e) => setForm((p) => ({ ...p, aliases: splitList(e.target.value) }))}
          placeholder="用逗号分隔，例如：ChatGPT-5.6, ChatGPT 5.6"
        />
        <p className="text-xs text-muted-foreground">
          转发时用于匹配写法有差异的同模型，多个名称之间用逗号分隔，例如「ChatGPT 5.6」可写成 ChatGPT-5.6 或 ChatGPT 5.6
        </p>
        {nameValidationMessages.map((message) => <p key={message} role="alert" className="text-xs text-destructive">{message}</p>)}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="price-input">输入价格 {unitLabel}</FieldLabel>
          <Input
            id="price-input"
            type="number"
            min={0}
            step={0.01}
            value={form.inputPrice}
            onChange={(e) => setForm((p) => ({ ...p, inputPrice: Number(e.target.value) }))}
          />
          {currency === 'CNY' && <ConversionHint display={form.inputPrice} usd={toUsd(form.inputPrice)} rate={rate} />}
        </Field>
        <Field>
          <FieldLabel htmlFor="price-output">输出价格 {unitLabel}</FieldLabel>
          <Input
            id="price-output"
            type="number"
            min={0}
            step={0.01}
            value={form.outputPrice}
            onChange={(e) => setForm((p) => ({ ...p, outputPrice: Number(e.target.value) }))}
          />
          {currency === 'CNY' && <ConversionHint display={form.outputPrice} usd={toUsd(form.outputPrice)} rate={rate} />}
        </Field>
        <Field>
          <FieldLabel htmlFor="price-cache-write">缓存写入价格 {unitLabel}</FieldLabel>
          <Input
            id="price-cache-write"
            type="number"
            min={0}
            step={0.01}
            value={form.cacheWritePrice}
            onChange={(e) => setForm((p) => ({ ...p, cacheWritePrice: Number(e.target.value) }))}
          />
          {currency === 'CNY' && <ConversionHint display={form.cacheWritePrice} usd={toUsd(form.cacheWritePrice)} rate={rate} />}
        </Field>
        <Field>
          <FieldLabel htmlFor="price-cache-read">缓存读取价格 {unitLabel}</FieldLabel>
          <Input
            id="price-cache-read"
            type="number"
            min={0}
            step={0.01}
            value={form.cacheReadPrice}
            onChange={(e) => setForm((p) => ({ ...p, cacheReadPrice: Number(e.target.value) }))}
          />
          {currency === 'CNY' && <ConversionHint display={form.cacheReadPrice} usd={toUsd(form.cacheReadPrice)} rate={rate} />}
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="price-context">context</FieldLabel>
        <Input
          id="price-context"
          type="number"
          min={0}
          value={form.contextLength}
          onChange={(e) => setForm((p) => ({ ...p, contextLength: Number(e.target.value) }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="price-max-token">max token</FieldLabel>
        <Input
          id="price-max-token"
          type="number"
          min={0}
          value={form.maxToken}
          onChange={(e) => setForm((p) => ({ ...p, maxToken: Number(e.target.value) }))}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="price-supported-types">支持的类型</FieldLabel>
        <Input
          id="price-supported-types"
          value={form.supportedTypes.join(', ')}
          onChange={(e) => setForm((p) => ({ ...p, supportedTypes: splitList(e.target.value) }))}
          placeholder="逗号分隔，如 text, image, video"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="price-thinking-levels">thinking levels</FieldLabel>
        <Input
          id="price-thinking-levels"
          value={form.thinkingLevels.join(', ')}
          onChange={(e) => setForm((p) => ({ ...p, thinkingLevels: splitList(e.target.value) }))}
          placeholder="逗号分隔，如 none, low, high"
        />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={!valid || saving} onClick={handleSave}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </FieldGroup>
  )
}

type ProviderOption = {
  readonly providerId: string
  readonly providerName: string
}

type ProviderSelectProps = {
  readonly providers: readonly ProviderOption[]
  readonly value: string
  readonly onSelect: (providerName: string | null) => void
}

// Input-style provider picker (same interaction as ModelAutocomplete, not a
// button+popover): typing only updates the local draft and the candidate
// list; the parent is notified on candidate pick or on blur.
function ProviderSelect({ providers, value, onSelect }: ProviderSelectProps) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  // Reflect the committed selection (official casing) into the input.
  useEffect(() => {
    const option = providers.find((provider) => provider.providerName === value)
    setDraft(option ? option.providerName : value)
  }, [value, providers])

  const candidates = useMemo(() => {
    const needle = draft.trim().toLowerCase()
    if (!needle) return providers
    return providers.filter((provider) =>
      provider.providerName.toLowerCase().includes(needle) ||
      provider.providerId.toLowerCase().includes(needle),
    )
  }, [providers, draft])

  const commit = (option: ProviderOption | null) => {
    if (option) {
      setDraft(option.providerName)
      onSelect(option.providerName)
    } else {
      setDraft('')
      onSelect(null)
    }
    setOpen(false)
  }

  const handleBlur = () => {
    const trimmed = draft.trim()
    const match = providers.find((provider) => provider.providerName.toLowerCase() === trimmed.toLowerCase())
    commit(match ?? null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || candidates.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % candidates.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + candidates.length) % candidates.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(candidates[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={anchorRef} className="relative">
      <Input
        id="price-provider"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !anchorRef.current?.contains(next)) {
            handleBlur()
          }
        }}
        placeholder="请选择供应商"
        autoComplete="off"
      />
      {open && candidates.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
          未找到匹配的供应商
        </div>
      )}
      {open && candidates.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <ScrollArea className="h-72">
            <ul className="py-1">
              {candidates.map((option, index) => (
                <li key={option.providerId}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      commit(option)
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs',
                      index === active ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    )}
                  >
                    <span className="truncate">{option.providerName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

function toInput(price: PriceConfig): PriceConfigInput {
  return {
    model: price.model,
    providerId: price.providerId,
    inputPrice: price.inputPrice,
    outputPrice: price.outputPrice,
    cacheWritePrice: price.cacheWritePrice,
    cacheReadPrice: price.cacheReadPrice,
    contextLength: price.contextLength,
    maxToken: price.maxToken,
    supportedTypes: price.supportedTypes,
    aliases: price.aliases,
    endpoints: price.endpoints,
    thinkingLevels: price.thinkingLevels,
    rate: price.rate,
  }
}

function toDisplayInput(
  price: PriceConfig,
  toDisplay: (usd: number) => number,
): PriceConfigInput {
  return {
    ...toInput(price),
    inputPrice: toDisplay(price.inputPrice),
    outputPrice: toDisplay(price.outputPrice),
    cacheWritePrice: toDisplay(price.cacheWritePrice),
    cacheReadPrice: toDisplay(price.cacheReadPrice),
  }
}

function ConversionHint({ display, usd, rate }: { display: number; usd: number; rate: number }) {
  return (
    <p className="text-xs text-muted-foreground/40">
      原 ${usd.toFixed(4)} × 汇率 {rate} = ¥{display.toFixed(2)}
    </p>
  )
}
