import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import {
  dashboardApi,
  type AgentConfigFile,
  type ManagedAgentGroup,
  type ManagedProviderOption,
  type ManagedProviderView,
  type PriceConfig,
} from '@/lib/dashboard-api'

interface ManagedProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  editing: ManagedProviderView | null
  onSaved: () => void
}

// EndpointGroup is the live-derived grouping state: one row per unique
// endpoint among the checked suppliers, with merged model names.
interface EndpointGroup {
  readonly endpoint: string
  readonly providerNames: readonly string[]
  readonly modelNames: readonly string[]
}

export function ManagedProviderDialog({
  open,
  onOpenChange,
  record,
  editing,
  onSaved,
}: ManagedProviderDialogProps) {
  const [options, setOptions] = useState<readonly ManagedProviderOption[]>([])
  const [prices, setPrices] = useState<readonly PriceConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // suffixByEndpoint / sourceByEndpoint persist user input per endpoint
  // so re-derivation (e.g. after toggling a supplier) keeps their edits.
  const [suffixByEndpoint, setSuffixByEndpoint] = useState<Record<string, string>>({})
  const [sourceByEndpoint, setSourceByEndpoint] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    if (!open || !record) return
    setLoading(true)
    setName('')
    setChecked(new Set())
    setSuffixByEndpoint({})
    setSourceByEndpoint({})
    Promise.all([dashboardApi.listManagedProviderOptions(), dashboardApi.listPrices({ limit: 1000, offset: 0 })])
      .then(([opts, pricesRes]) => {
        setOptions(opts)
        setPrices(pricesRes.prices)
        if (editing) {
          setName(editing.name)
          setChecked(new Set(editing.provider_ids))
          const suffix: Record<string, string> = {}
          const sources: Record<string, Record<string, string>> = {}
          for (const g of editing.groups) {
            suffix[g.endpoint] = g.suffix
            sources[g.endpoint] = { ...g.model_sources }
          }
          for (const hg of editing.hidden_groups ?? []) {
            suffix[hg.endpoint] = hg.suffix
            sources[hg.endpoint] = { ...hg.model_sources }
          }
          setSuffixByEndpoint(suffix)
          setSourceByEndpoint(sources)
        }
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [open, record, editing])

  // Derived groups: identical endpoints merge; models union by name.
  const deriveGroups = (checkedValue: ReadonlySet<string>): readonly EndpointGroup[] => {
    const byEndpoint = new Map<string, { providers: string[]; models: string[] }>()
    for (const opt of options) {
      if (!checkedValue.has(opt.id) || !opt.status) continue
      if (opt.endpoints.length === 0) continue
      for (const ep of opt.endpoints) {
        const cur = byEndpoint.get(ep) ?? { providers: [], models: [] }
        if (!cur.providers.includes(opt.name)) cur.providers.push(opt.name)
        for (const m of opt.models) {
          if (!cur.models.includes(m)) cur.models.push(m)
        }
        byEndpoint.set(ep, cur)
      }
    }
    return [...byEndpoint.entries()].map(([endpoint, v]) => ({
      endpoint,
      providerNames: v.providers,
      modelNames: v.models,
    }))
  }

  // groups (from `checked`) is authoritative for submit; deferredGroups is for
  // rendering only, so toggling suppliers updates tags immediately and the
  // heavier endpoint/模型 sub-tables below catch up without blocking the clicks.
  const groups = useMemo(() => deriveGroups(checked), [options, checked])
  const deferredChecked = useDeferredValue(checked)
  const deferredGroups = useMemo(
    () => deriveGroups(deferredChecked),
    [options, deferredChecked],
  )

  const stale = useMemo(() => {
    if (!editing) return []
    const live = new Set(options.map((o) => o.id))
    return (editing.stale_provider_ids ?? []).filter((id) => !live.has(id))
  }, [editing, options])

  // candidates for model info source: price rows matching the model name
  const priceCandidates = (model: string): readonly PriceConfig[] => {
    const needle = model.toLowerCase()
    return prices.filter((p) => {
      const id = p.model.toLowerCase()
      const alias = p.aliases.some((a) => a.toLowerCase() === needle)
      return id === needle || id.includes(needle) || needle.includes(id) || alias
    })
  }
  // first candidate prefilled once a group's model sources are empty
  const ensurePrefill = (endpoint: string, modelNames: readonly string[]) => {
    setSourceByEndpoint((prev) => {
      const cur = prev[endpoint] ?? {}
      let changed = false
      const next = { ...cur }
      for (const m of modelNames) {
        if (next[m] !== undefined) continue
        const c = priceCandidates(m)
        if (c.length > 0) {
          next[m] = c[0].id
          changed = true
        }
      }
      return changed ? { ...prev, [endpoint]: next } : prev
    })
  }

  const toggleProvider = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!record) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('请填写供应商名字')
      return
    }
    if (groups.length === 0) {
      toast.error('请至少勾选一个有 endpoint 的供应商')
      return
    }
    if (groups.length > 1) {
      for (const g of groups) {
        if (!(suffixByEndpoint[g.endpoint] ?? '').trim()) {
          toast.error(`有多个 endpoint 分组，必须为 ${g.endpoint} 填写后缀`)
          return
        }
      }
    }
    const payload: ManagedAgentGroup[] = groups.map((g) => ({
      endpoint: g.endpoint,
      suffix: (suffixByEndpoint[g.endpoint] ?? '').trim(),
      model_sources: sourceByEndpoint[g.endpoint] ?? {},
    }))
    try {
      if (editing) {
        await dashboardApi.updateManagedProvider(record.id, editing.id, {
          name: trimmed,
          provider_ids: [...checked],
          groups: payload,
        })
        toast('已保存托管 provider')
      } else {
        await dashboardApi.createManagedProvider(record.id, {
          name: trimmed,
          provider_ids: [...checked],
          groups: payload,
        })
        toast('已创建托管 provider')
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="lg"
        height="auto"
        minHeight={420}
        className="flex max-h-[85vh] flex-col"
      >
        <DialogHeader>
          <DialogTitle>{editing ? '修改托管 provider' : '添加托管 provider'}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载供应商列表…</p>
          ) : (
            <>
              <Field>
                <FieldLabel>供应商名字</FieldLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：HAPIY"
                />
                <p className="text-xs text-muted-foreground">
                  各组最终 provider 名 = 供应商名字 + 后缀（只有一个分组时后缀可选）
                </p>
              </Field>

              <Field>
                <FieldLabel>
                  选择要托管的供应商
                  <span className="ml-1 font-normal text-muted-foreground">（每个 provider 显示名称 / 模型数 / endpoint 数）</span>
                </FieldLabel>
                <ProviderMultiSelect
                  loading={loading}
                  options={options}
                  checked={checked}
                  staleChecked={editing ? stale.filter((id) => editing.provider_ids.includes(id)) : []}
                  onToggle={toggleProvider}
                />
              </Field>

              {deferredGroups.length > 0 && (
                <Field>
                  <FieldLabel>
                    endpoint 分组
                    <span className="ml-1 font-normal text-muted-foreground">
                      （完全相同才分到一组；点击行可折叠/展开子表格）
                    </span>
                  </FieldLabel>
                  <div className="space-y-2">
                    {deferredGroups.map((g) => (
                      <GroupCard
                        key={g.endpoint}
                        group={g}
                        suffix={suffixByEndpoint[g.endpoint] ?? ''}
                        onSuffixChange={(v) =>
                          setSuffixByEndpoint((prev) => ({ ...prev, [g.endpoint]: v }))
                        }
                        prices={prices}
                        sources={sourceByEndpoint[g.endpoint] ?? {}}
                        onSourceChange={(model, priceId) => {
                          setSourceByEndpoint((prev) => ({
                            ...prev,
                            [g.endpoint]: { ...(prev[g.endpoint] ?? {}), [model]: priceId },
                          }))
                        }}
                        onPrefill={() => ensurePrefill(g.endpoint, g.modelNames)}
                        hidden={false}
                      />
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderMultiSelect({
  loading,
  options,
  checked,
  staleChecked,
  onToggle,
}: {
  loading: boolean
  options: readonly ManagedProviderOption[]
  checked: ReadonlySet<string>
  staleChecked: readonly string[]
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMousedown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMousedown)
    document.addEventListener('keydown', onDocKeydown)
    return () => {
      document.removeEventListener('mousedown', onDocMousedown)
      document.removeEventListener('keydown', onDocKeydown)
    }
  }, [open])

  const checkedOptions = options.filter((o) => checked.has(o.id))

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={
          'flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 ' +
          (open ? 'border-ring ring-1 ring-ring/50' : 'hover:bg-muted/40')
        }
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {checkedOptions.length === 0 && staleChecked.length === 0 ? (
            <span className="text-muted-foreground">点击展开选择要托管的供应商</span>
          ) : (
            <>
              {checkedOptions.map((o) => (
                <span
                  key={o.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5"
                >
                  <span className="truncate font-medium">{o.name}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${o.name}`}
                    title="移除"
                    onClick={() => onToggle(o.id)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <AppIcon name="close" size={12} />
                  </button>
                </span>
              ))}
              {staleChecked.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 opacity-40"
                >
                  <span className="truncate">{id.slice(0, 8)}…</span>
                  <span className="text-muted-foreground">（已删除）</span>
                </span>
              ))}
            </>
          )}
        </span>
        <AppIcon
          name="expand_more"
          size={16}
          className={'shrink-0 text-muted-foreground transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 max-h-[220px] w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {loading ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">加载供应商列表…</p>
          ) : (
            <ul role="listbox" aria-multiselectable="true">
              {options.map((opt) => {
                const selected = checked.has(opt.id)
                const disabled = !opt.status
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggle(opt.id)}
                      role="option"
                      aria-selected={selected}
                      className={
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs select-none ' +
                        (disabled
                          ? 'cursor-not-allowed opacity-40'
                          : selected
                            ? 'bg-muted/60'
                            : 'hover:bg-muted/40')
                      }
                    >
                      <span
                        className={
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ' +
                          (selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input')
                        }
                      >
                        {selected && <AppIcon name="check" size={12} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={'truncate ' + (selected ? 'font-medium' : '')}>{opt.name}</span>
                        {disabled && <span className="ml-1 text-muted-foreground">（禁用）</span>}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {opt.modelCount} 模型 · {opt.endpointCount} endpoint
                      </span>
                    </button>
                  </li>
                )
              })}
              {staleChecked.map((id) => (
                <li key={id} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs opacity-40">
                  <span className="h-4 w-4 shrink-0 rounded-sm border border-input">
                    <AppIcon name="check" size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {id.slice(0, 8)}…
                    <span className="ml-1 text-muted-foreground">（已删除）</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function GroupCard({
  group,
  suffix,
  onSuffixChange,
  prices,
  sources,
  onSourceChange,
  onPrefill,
  hidden,
}: {
  group: EndpointGroup
  suffix: string
  onSuffixChange: (v: string) => void
  prices: readonly PriceConfig[]
  sources: Record<string, string>
  onSourceChange: (model: string, priceId: string) => void
  onPrefill: () => void
  hidden: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    onPrefill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.endpoint, group.modelNames.length])
  const priceCandidates = (model: string): readonly PriceConfig[] => {
    const needle = model.toLowerCase()
    return prices.filter((p) => {
      const id = p.model.toLowerCase()
      const alias = p.aliases.some((a) => a.toLowerCase() === needle)
      return id === needle || id.includes(needle) || needle.includes(id) || alias
    })
  }
  return (
    <div className={'rounded-md border border-border ' + (hidden ? 'opacity-40' : '')}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
        onClick={() => setExpanded(!expanded)}
      >
        <AppIcon
          name="chevron_right"
          size={12}
          className={'shrink-0 text-muted-foreground transition-transform ' + (expanded ? 'rotate-90' : '')}
        />
        <span className="flex-1 truncate font-mono font-medium">{group.endpoint}</span>
        <span className="shrink-0 text-muted-foreground">
          {group.modelNames.length} 个合并模型 · {group.providerNames.join('、')}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border p-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">后缀</span>
            <Input
              value={suffix}
              onChange={(e) => onSuffixChange(e.target.value)}
              placeholder="例如：-C（多个分组时必填）"
              className="h-7 flex-1 text-xs font-mono"
            />
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">模型</th>
                  <th className="w-[46%] px-2 py-1 text-left font-medium">模型信息数据源</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {group.modelNames.map((m) => {
                  const cands = priceCandidates(m)
                  return (
                    <tr key={m}>
                      <td className="px-2 py-1 font-mono">{m}</td>
                      <td className="px-2 py-1">
                        <Select
                          value={sources[m] ?? ''}
                          onValueChange={cands.length === 0 ? undefined : (v) => onSourceChange(m, v)}
                        >
                          <SelectTrigger className="h-7 w-full text-xs" disabled={cands.length === 0}>
                            <SelectValue placeholder={cands.length === 0 ? '无数据' : '选择数据源'} />
                          </SelectTrigger>
                          <SelectContent>
                            {cands.length === 0 ? (
                              <SelectItem value="" disabled>无数据</SelectItem>
                            ) : (
                              <>
                                <SelectItem value="">（不填）</SelectItem>
                                {cands.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.model}
                                    {c.providerId ? ` · ${c.providerId}` : ''}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}