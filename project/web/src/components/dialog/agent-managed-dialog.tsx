import { useEffect, useMemo, useState } from 'react'
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
  const groups = useMemo<readonly EndpointGroup[]>(() => {
    const byEndpoint = new Map<string, { providers: string[]; models: string[] }>()
    for (const opt of options) {
      if (!checked.has(opt.id) || !opt.status) continue
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
  }, [options, checked])

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
      <DialogContent width="xl" height="lg" className="flex flex-col">
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
                  <span className="ml-1 font-normal text-muted-foreground">（每个 provider 显示名称 / endpoint 数 / 模型数）</span>
                </FieldLabel>
                <div className="max-h-[220px] overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="w-[32px] px-2 py-1.5" />
                        <th className="px-2 py-1.5 text-left font-medium">名称</th>
                        <th className="w-[80px] px-2 py-1.5 text-center font-medium">endpoint</th>
                        <th className="w-[80px] px-2 py-1.5 text-center font-medium">模型</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {options.map((opt) => (
                        <tr
                          key={opt.id}
                          className={
                            'select-none ' +
                            (opt.status ? 'cursor-pointer hover:bg-muted' : 'opacity-40')
                          }
                          onClick={() => opt.status && toggleProvider(opt.id)}
                        >
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={checked.has(opt.id)}
                              disabled={!opt.status}
                              onChange={() => opt.status && toggleProvider(opt.id)}
                            />
                          </td>
                          <td className="px-2 py-1.5 font-medium">
                            {opt.name}
                            {opt.status ? '' : <span className="ml-1 text-muted-foreground">（禁用）</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center">{opt.endpointCount}</td>
                          <td className="px-2 py-1.5 text-center">{opt.modelCount}</td>
                        </tr>
                      ))}
                      {editing &&
                        stale.length > 0 &&
                        stale.map((id) => {
                          const gm = [...(editing.groups ?? []), ...(editing.hidden_groups ?? [])]
                          const linked = editing.provider_ids.includes(id)
                          if (!linked) return null
                          void gm
                          return (
                            <tr key={id} className="opacity-40">
                              <td className="px-2 py-1.5 text-center">
                                <input type="checkbox" checked disabled />
                              </td>
                              <td className="px-2 py-1.5">
                                {id.slice(0, 8)}…
                                <span className="ml-1 text-muted-foreground">（已删除）</span>
                              </td>
                              <td className="px-2 py-1.5 text-center">-</td>
                              <td className="px-2 py-1.5 text-center">-</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </Field>

              {groups.length > 0 && (
                <Field>
                  <FieldLabel>
                    endpoint 分组
                    <span className="ml-1 font-normal text-muted-foreground">
                      （完全相同才分到一组；点击行可折叠/展开子表格）
                    </span>
                  </FieldLabel>
                  <div className="space-y-2">
                    {groups.map((g) => (
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
                        {cands.length === 0 ? (
                          <span className="text-muted-foreground">（无匹配，不填）</span>
                        ) : (
                          <Select
                            value={sources[m] ?? ''}
                            onValueChange={(v) => onSourceChange(m, v)}
                          >
                            <SelectTrigger className="h-7 w-full text-xs">
                              <SelectValue placeholder="选择数据源" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">（不填）</SelectItem>
                              {cands.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.model}
                                  {c.providerId ? ` · ${c.providerId}` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
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