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
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModelAutocomplete } from '@/components/ModelAutocomplete'
import { cn } from '@/lib/utils'
import {
  findModelsDevModel,
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

  const handleDelete = async (id: string) => {
    setMutating(true)
    try {
      await dashboardApi.deletePrice(id)
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
              void handleDelete(row.id)
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
  // The models.dev switch and provider selection restore from the persisted
  // provider_id: a non-empty provider_id means the last save used models.dev.
  const [modelsDevEnabled, setModelsDevEnabled] = useState(initial?.providerId !== undefined && initial.providerId !== '')
  const [providerId, setProviderId] = useState<string | null>(initial?.providerId ?? null)
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [existingNames, setExistingNames] = useState<ExistingNamesState>({ kind: 'loading' })

  useEffect(() => {
    if (!initial) {
      setForm(emptyPrice)
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

  useEffect(() => {
    if (!modelsDevEnabled) return
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
  }, [modelsDevEnabled])

  const providers = useMemo(
    () => (modelsDevEnabled ? providersForModel(snapshot ?? [], form.model) : []),
    [modelsDevEnabled, snapshot, form.model],
  )

  // Drop a provider selection that no longer belongs to the committed model.
  useEffect(() => {
    if (providerId !== null && !providers.some((provider) => provider.providerId === providerId)) {
      setProviderId(null)
    }
  }, [providerId, providers])

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

  const handleProviderSelect = (pid: string | null) => {
    setProviderId(pid)
    if (pid) fillFromProvider(pid)
  }

  // Model name commits (pick or blur). While the switch is on, an exact
  // case-insensitive match keeps the official casing; otherwise the model
  // field and the provider selection are cleared together.
  const handleModelChange = (model: string) => {
    setForm((current) => ({ ...current, model }))
    if (!modelsDevEnabled || snapshot === null) return
    const match = findModelsDevModel(snapshot, model)
    if (match) {
      setForm((current) => ({ ...current, model: match.id }))
    } else {
      setProviderId(null)
      setForm((current) => ({ ...current, model: '' }))
    }
  }

  const handleSave = () => {
    const payload = {
      ...form,
      model: form.model.trim(),
      inputPrice: toUsd(form.inputPrice),
      outputPrice: toUsd(form.outputPrice),
      cacheWritePrice: toUsd(form.cacheWritePrice),
      cacheReadPrice: toUsd(form.cacheReadPrice),
    }
    if (!modelsDevEnabled) {
      onSave({ ...payload, providerId: undefined })
      return
    }
    if (snapshot === null) {
      setSnapshotError('models.dev 数据加载失败，请检查网络')
      return
    }
    const match = findModelsDevModel(snapshot, form.model)
    if (!match) {
      setProviderId(null)
      setForm((current) => ({ ...current, model: '' }))
      return
    }
    // Keep the provider-id attribution so the switch/provider survive reopening.
    onSave({ ...payload, model: match.id, providerId: providerId ?? undefined })
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
    nameConflicts.length === 0 &&
    (!modelsDevEnabled || providerId !== null)

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="price-model">模型名称</FieldLabel>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ModelAutocomplete
              value={form.model}
              onChange={handleModelChange}
              searchable={modelsDevEnabled}
            />
          </div>
          {form.model.trim() !== '' && (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={modelsDevEnabled}
                onCheckedChange={(checked) => setModelsDevEnabled(checked === true)}
              />
              从 models.dev 获取信息
            </label>
          )}
        </div>
        {snapshotError && <p role="alert" className="text-xs text-destructive">{snapshotError}</p>}
        {existingNames.kind === 'loading' && <p className="text-xs text-muted-foreground">正在检查历史模型名称...</p>}
        {existingNames.kind === 'error' && <p role="alert" className="text-xs text-destructive">无法检查历史模型名称，请稍后重试</p>}
        <p className="text-xs text-muted-foreground">大小写不敏感</p>
      </Field>
      {modelsDevEnabled && (
        <Field>
          <FieldLabel htmlFor="price-provider">供应商</FieldLabel>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ProviderSelect providers={providers} value={providerId} onSelect={handleProviderSelect} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={providerId === null}
              onClick={() => { if (providerId !== null) fillFromProvider(providerId) }}
            >
              <AppIcon name="refresh" data-icon="inline-start" />
              更新模型数据
            </Button>
          </div>
          {providerId === null && (
            <p className="text-xs text-muted-foreground">开启后需选择供应商才能保存</p>
          )}
        </Field>
      )}
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
  readonly value: string | null
  readonly onSelect: (providerId: string | null) => void
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
    const option = providers.find((provider) => provider.providerId === value)
    setDraft(option ? option.providerName : '')
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
      onSelect(option.providerId)
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
