import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Code, AlertTriangle, Loader2, HelpCircle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
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
  | { readonly kind: 'ready'; readonly prices: readonly PriceConfig[] }

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
  rules: [],
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
          JSON.stringify(item.rules) !== JSON.stringify(current.rules)
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

  const fetch = useCallback(async () => {
    try {
      const prices = await dashboardApi.listPrices()
      setState({ kind: 'ready', prices })
    } catch (err) {
      setState({ kind: 'error', message: toErrorMessage(err) })
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const prices = await dashboardApi.listPrices()
        setState({ kind: 'ready', prices })
      } catch (err) {
        setState({ kind: 'error', message: toErrorMessage(err) })
      }
    })()
  }, [])

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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="模型信息"
        status={state.kind === 'ready' ? `${state.prices.length} 条` : '加载中'}
      />
      <div className="flex-1 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载模型…
          </div>
        )}

        {state.kind === 'error' && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-6 text-sm">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              {state.message}
            </div>
            <Button className="mt-3" size="sm" variant="outline" onClick={fetch}>重试</Button>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                按模型配置输入 / 输出价格，缓存读写价格为可选，单位均为「每 1M tokens」
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
                  <Code data-icon="inline-start" />编辑 JSON
                </Button>
                  <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                  <Plus data-icon="inline-start" />
                  添加模型
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead className="text-right">context</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        价格
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={<HelpCircle className="size-3.5 text-muted-foreground" />} />
                            <TooltipContent>
                              <p>1. 输入 / 2. 输出 / 3. 缓存写 / 4. 缓存读</p>
                              <p className="text-muted-foreground">单位：$/1M tokens</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.prices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        暂无模型配置，点击「添加模型」创建第一条
                      </TableCell>
                    </TableRow>
                  )}
                  {state.prices.map((price) => (
                    <TableRow key={price.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{price.model}</span>
                          {price.rules.length > 0 && (
                            <Badge variant="secondary" className="text-[10px]">{price.rules.length} 条规则</Badge>
                          )}
                          {price.cacheWritePrice === 0 && price.cacheReadPrice === 0 && (
                            <Badge variant="secondary" className="text-[10px]">无缓存</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {price.contextLength > 0 ? price.contextLength.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {`${price.inputPrice.toFixed(2)} / ${price.outputPrice.toFixed(2)} / ${price.cacheWritePrice > 0 ? price.cacheWritePrice.toFixed(2) : '—'} / ${price.cacheReadPrice > 0 ? price.cacheReadPrice.toFixed(2) : '—'}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(price); setIsOpen(true); }}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(price.id)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? '编辑模型' : '添加模型'}</DialogTitle>
                </DialogHeader>
                <PriceForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
              </DialogContent>
            </Dialog>

            {jsonOpen && (
              <JsonEditModal
                data={state.prices}
                onSave={handleJsonSave}
                onClose={() => setJsonOpen(false)}
              />
            )}
          </>
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
      .listProviders()
      .then((providers) => {
        if (!cancelled) setProviderNames(providers.map((p) => p.name))
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
          rules={form.rules}
          onChange={(rules) => setForm((p) => ({ ...p, rules: [...rules] }))}
          providerNames={providerNames}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={!valid || saving} onClick={() => onSave({ ...form, model: form.model.trim() })}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
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
    rules: price.rules,
  }
}