import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Code, AlertTriangle, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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
        retainedIds.add(id)
        if (
          item.inputPrice !== currentMap.get(id)!.inputPrice ||
          item.outputPrice !== currentMap.get(id)!.outputPrice ||
          item.cacheWritePrice !== currentMap.get(id)!.cacheWritePrice ||
          item.cacheReadPrice !== currentMap.get(id)!.cacheReadPrice
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
        title="价格配置"
        subtitle="Model pricing"
        status={state.kind === 'ready' ? `${state.prices.length} 条` : '加载中'}
      />
      <div className="flex-1 p-6">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载价格…
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
                  添加价格
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead className="text-right">输入价格</TableHead>
                    <TableHead className="text-right">输出价格</TableHead>
                    <TableHead className="text-right">缓存写入</TableHead>
                    <TableHead className="text-right">缓存读取</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.prices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        暂无价格配置，点击「添加价格」创建第一条
                      </TableCell>
                    </TableRow>
                  )}
                  {state.prices.map((price) => (
                    <TableRow key={price.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{price.model}</span>
                          {price.cacheWritePrice === 0 && price.cacheReadPrice === 0 && (
                            <Badge variant="secondary" className="text-[10px]">无缓存</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">${price.inputPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">${price.outputPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {price.cacheWritePrice > 0 ? `$${price.cacheWritePrice.toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {price.cacheReadPrice > 0 ? `$${price.cacheReadPrice.toFixed(2)}` : '—'}
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
                  <DialogTitle>{editing ? '编辑价格' : '添加价格'}</DialogTitle>
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

  useEffect(() => {
    setForm(initial ? toInput(initial) : emptyPrice)
  }, [initial])

  const valid = form.model.trim().length > 0 && form.inputPrice >= 0 && form.outputPrice >= 0

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="price-model">模型名称</FieldLabel>
        <Input
          id="price-model"
          value={form.model}
          onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
          placeholder="gpt-4"
          disabled={!!initial}
        />
        {initial && <p className="text-xs text-muted-foreground">模型名称不可修改</p>}
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
  }
}