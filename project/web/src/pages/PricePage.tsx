import { useState, useEffect, useCallback, type ReactNode } from 'react'
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
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ModelAutocomplete } from '@/components/ModelAutocomplete'
import type { ModelsDevModel } from '@/lib/models-dev'
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
  const [limit, setLimit] = useState(20)

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
      defaultWidth: { kind: 'pixel', value: 120 },
      defaultAlign: 'right',
      accessor: (row) => (row.contextLength > 0 ? row.contextLength.toLocaleString() : null),
    },
    {
      key: 'price',
      label: '价格',
      defaultWidth: { kind: 'pixel', value: 240 },
      defaultAlign: 'right',
      render: (_, row) => (
        <span className="text-right tabular-nums text-muted-foreground">
          {[
            row.inputPrice.toFixed(2),
            row.outputPrice.toFixed(2),
            row.cacheWritePrice > 0 ? row.cacheWritePrice.toFixed(2) : <span key="w" className="text-muted-foreground/60">--</span>,
            row.cacheReadPrice > 0 ? row.cacheReadPrice.toFixed(2) : <span key="r" className="text-muted-foreground/60">--</span>,
          ].reduce<ReactNode[]>((acc, part, i) => {
            if (i > 0) acc.push(<span key={`s${i}`}> / </span>)
            acc.push(<span key={i}>{part}</span>)
            return acc
          }, [])}
        </span>
      ),
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
            <PriceForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
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
}: {
  initial: EditingPrice
  onSave: (input: PriceConfigInput) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<PriceConfigInput>(initial ? toInput(initial) : emptyPrice)
  const [pickedModel, setPickedModel] = useState<ModelsDevModel | null>(null)
  const [autoFillError, setAutoFillError] = useState<string | null>(null)
  const [existingNames, setExistingNames] = useState<ExistingNamesState>({ kind: 'loading' })

  useEffect(() => {
    setForm(initial ? toInput(initial) : emptyPrice)
  }, [initial])

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

  const applyModelsDevData = () => {
    if (!pickedModel) return
    setAutoFillError(null)
    const supportedTypes = [
      ...new Set([...pickedModel.inputTypes, ...pickedModel.outputTypes]),
    ]
    setForm((current) => ({
      ...current,
      inputPrice: pickedModel.inputPrice,
      outputPrice: pickedModel.outputPrice,
      cacheWritePrice: pickedModel.cacheWritePrice,
      cacheReadPrice: pickedModel.cacheReadPrice,
      contextLength: pickedModel.contextLength,
      maxToken: pickedModel.maxOutput,
      supportedTypes,
    }))
    setPickedModel(null)
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
      <Field>
        <FieldLabel htmlFor="price-model">模型名称</FieldLabel>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ModelAutocomplete
              value={form.model}
              onChange={(model) => setForm((current) => ({ ...current, model }))}
              onPick={setPickedModel}
            />
          </div>
          {pickedModel && (
            <Button type="button" variant="outline" size="sm" onClick={applyModelsDevData}>
              从 models.dev 获取模型信息
            </Button>
          )}
        </div>
        {autoFillError && <p role="alert" className="text-xs text-destructive">{autoFillError}</p>}
        {existingNames.kind === 'loading' && <p className="text-xs text-muted-foreground">正在检查历史模型名称...</p>}
        {existingNames.kind === 'error' && <p role="alert" className="text-xs text-destructive">无法检查历史模型名称，请稍后重试</p>}
        <p className="text-xs text-muted-foreground">大小写不敏感</p>
      </Field>
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
          <FieldLabel htmlFor="price-input">输入价格 ($/1M tokens)</FieldLabel>
          <Input
            id="price-input"
            type="number"
            min={0}
            step={0.01}
            value={form.inputPrice}
            onChange={(e) => setForm((p) => ({ ...p, inputPrice: Number(e.target.value) }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="price-output">输出价格 ($/1M tokens)</FieldLabel>
          <Input
            id="price-output"
            type="number"
            min={0}
            step={0.01}
            value={form.outputPrice}
            onChange={(e) => setForm((p) => ({ ...p, outputPrice: Number(e.target.value) }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="price-cache-write">缓存写入价格</FieldLabel>
          <Input
            id="price-cache-write"
            type="number"
            min={0}
            step={0.01}
            value={form.cacheWritePrice}
            onChange={(e) => setForm((p) => ({ ...p, cacheWritePrice: Number(e.target.value) }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="price-cache-read">缓存读取价格</FieldLabel>
          <Input
            id="price-cache-read"
            type="number"
            min={0}
            step={0.01}
            value={form.cacheReadPrice}
            onChange={(e) => setForm((p) => ({ ...p, cacheReadPrice: Number(e.target.value) }))}
          />
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
        <Button disabled={!valid || saving} onClick={() => onSave({ ...form, model: form.model.trim() })}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>
    </FieldGroup>
  )
}

function toInput(price: PriceConfig): PriceConfigInput {
  return {
    model: price.model,
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
