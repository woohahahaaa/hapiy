import { useState, useEffect, useCallback } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'

import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { RateRulesEditor } from '@/components/RateRulesEditor'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { PriceConfig, PriceConfigInput } from '@/lib/dashboard-api'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly prices: readonly PriceConfig[]; readonly total: number }

type EditingPrice = PriceConfig | null

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

async function diffAndSave(
  data: unknown,
  prices: readonly PriceConfig[],
  fetch: () => Promise<void>,
  setMutating: (v: boolean) => void,
  idMap: JsonEditorIdMap,
): Promise<void> {
  setMutating(true)
  try {
    const parsed = parseJsonEditorArray<PriceConfigInput>(data)
    const currentMap = new Map(prices.map((p) => [p.id, p]))
    const retainedIds = new Set<string>()
    const ops: Promise<unknown>[] = []

    for (const item of parsed) {
      const id = idMap.get(item.id)
      if (id && currentMap.has(id)) {
        const current = currentMap.get(id)!
        retainedIds.add(id)
        if (
          item.inputPrice !== current.inputPrice ||
          item.outputPrice !== current.outputPrice ||
          item.cacheWritePrice !== current.cacheWritePrice ||
          item.cacheReadPrice !== current.cacheReadPrice ||
          item.contextLength !== current.contextLength ||
          item.maxToken !== current.maxToken ||
          JSON.stringify(item.supportedTypes) !== JSON.stringify(current.supportedTypes) ||
          JSON.stringify(item.aliases) !== JSON.stringify(current.aliases) ||
          JSON.stringify(item.endpoints) !== JSON.stringify(current.endpoints) ||
          JSON.stringify(item.thinkingLevels) !== JSON.stringify(current.thinkingLevels) ||
          JSON.stringify(item.rate) !== JSON.stringify(current.rate)
        ) {
          ops.push(dashboardApi.updatePrice(id, item))
        }
      } else {
        ops.push(dashboardApi.createPrice(item))
      }
    }
    for (const id of currentMap.keys()) {
      if (!retainedIds.has(id)) {
        ops.push(dashboardApi.deletePrice(id))
      }
    }
    await Promise.allSettled(ops)
    await fetch()
  } finally {
    setMutating(false)
  }
}

export function PricePage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [mutating, setMutating] = useState(false)
  const [editing, setEditing] = useState<EditingPrice>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
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

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    if (state.kind !== 'ready') return
    try {
      await diffAndSave(data, state.prices, fetch, setMutating, idMap)
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    }
  }

  const columns: ColumnDef<PriceConfig>[] = [
    {
      key: 'model',
      label: '模型',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <span>{row.model}</span>
          {row.rate.length > 0 && (
            <span className="text-xs text-muted-foreground">{row.rate.length} 条规则</span>
          )}
          {row.cacheWritePrice === 0 && row.cacheReadPrice === 0 && (
            <span className="text-xs text-muted-foreground">无缓存</span>
          )}
        </div>
      ),
    },
    {
      key: 'contextLength',
      label: 'context',
      render: (_, row) => (
        <span className="text-right tabular-nums text-muted-foreground">
          {row.contextLength > 0 ? row.contextLength.toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'price',
      label: '价格',
      render: (_, row) => (
        <span className="text-right tabular-nums text-muted-foreground">
          {`${row.inputPrice.toFixed(2)} / ${row.outputPrice.toFixed(2)} / ${row.cacheWritePrice > 0 ? row.cacheWritePrice.toFixed(2) : '—'} / ${row.cacheReadPrice > 0 ? row.cacheReadPrice.toFixed(2) : '—'}`}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
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
              <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
                <AppIcon name="code" data-icon="inline-start" />编辑 JSON
              </Button>
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

        {jsonOpen && state.kind === 'ready' && (
          <JsonEditModal
            data={state.prices}
            onSave={handleJsonSave}
            onClose={() => setJsonOpen(false)}
          />
        )}
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
  const [providerNames, setProviderNames] = useState<readonly string[]>([])

  useEffect(() => {
    setForm(initial ? toInput(initial) : emptyPrice)
  }, [initial])

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .listProviders({ limit: 1000, offset: 0 })
      .then((result) => {
        if (!cancelled) setProviderNames(result.providers.map((p) => p.name))
      })
      .catch(() => {
        if (!cancelled) setProviderNames([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const splitList = (value: string): string[] =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

  const valid =
    form.model.trim().length > 0 &&
    form.inputPrice >= 0 &&
    form.outputPrice >= 0 &&
    form.contextLength >= 0 &&
    form.maxToken >= 0

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="price-model">模型名称</FieldLabel>
        <Input
          id="price-model"
          value={form.model}
          onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
          placeholder="gpt-4"
        />
        <p className="text-xs text-muted-foreground">大小写不敏感</p>
      </Field>
      <Field>
        <FieldLabel htmlFor="price-aliases">匹配更多名称</FieldLabel>
        <Input
          id="price-aliases"
          value={form.aliases.join(', ')}
          onChange={(e) => setForm((p) => ({ ...p, aliases: splitList(e.target.value) }))}
          placeholder="逗号分隔，如 GPT-5.6, gpt5.6"
        />
        <p className="text-xs text-muted-foreground">用于匹配转发时名称有差异的同模型</p>
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
        <FieldLabel htmlFor="price-endpoints">支持的格式</FieldLabel>
        <Input
          id="price-endpoints"
          value={form.endpoints.join(', ')}
          onChange={(e) => setForm((p) => ({ ...p, endpoints: splitList(e.target.value) }))}
          placeholder="逗号分隔，如 /v1/chat/completions, /v1/embeddings"
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
      <Field>
        <FieldLabel>倍率规则</FieldLabel>
        <RateRulesEditor
          rate={form.rate}
          onChange={(rate) => setForm((p) => ({ ...p, rate: [...rate] }))}
          providerNames={providerNames}
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