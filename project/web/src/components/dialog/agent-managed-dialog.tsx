import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { dashboardApi, type AgentConfigFile, type ManagedAgentGroup, type ManagedProviderOption, type ManagedProviderView, type Token } from '@/lib/dashboard-api'
import { loadModelsDevModels, providersForModel, type ModelsDevModel } from '@/lib/models-dev'

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
  readonly noEndpointProviderIds?: readonly string[] // 未配置 endpoint 组成员 app provider ids
}

export function ManagedProviderDialog({
  open,
  onOpenChange,
  record,
  editing,
  onSaved,
}: ManagedProviderDialogProps) {
  const [options, setOptions] = useState<readonly ManagedProviderOption[]>([])
  const [snapshot, setSnapshot] = useState<readonly ModelsDevModel[] | null>(null)
  const [tokens, setTokens] = useState<readonly Token[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // 接入 Key（令牌）与 BaseURL 来源标记选项。
  const [apiKey, setApiKey] = useState('')
  const [useSourceMark, setUseSourceMark] = useState(false)
  const [sourceName, setSourceName] = useState('')
  // suffixByEndpoint / sourceByEndpoint persist user input per endpoint
  // so re-derivation (e.g. after toggling a supplier) keeps their edits.
  const [suffixByEndpoint, setSuffixByEndpoint] = useState<Record<string, string>>({})
  const [sourceByEndpoint, setSourceByEndpoint] = useState<Record<string, Record<string, string>>>({})
  // endpointByEndpoint lets the 未配置 endpoint group accept a manual
  // endpoint that replaces the sentinel on submit.
  const [manualEndpoint, setManualEndpoint] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || !record) return
    setLoading(true)
    setName('')
    setChecked(new Set())
    setSuffixByEndpoint({})
    setSourceByEndpoint({})
    setManualEndpoint({})
    setApiKey('')
    setUseSourceMark(false)
    setSourceName('')
    Promise.all([
      dashboardApi.listManagedProviderOptions(),
      loadModelsDevModels(),
      dashboardApi.listTokens({ limit: 1000, offset: 0 }).catch(() => ({ tokens: [] as readonly Token[], total: 0 })),
    ])
      .then(([opts, models, tokensRes]) => {
        setOptions(opts)
        setSnapshot(models)
        setTokens(tokensRes.tokens)
        if (editing) {
          setName(editing.name)
          setChecked(new Set(editing.provider_ids))
          setApiKey(editing.api_key)
          setUseSourceMark(editing.use_source_mark)
          setSourceName(editing.source_name || editing.name)
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
  // Providers without any endpoint form a special 未配置 endpoint group;
  // a model whose endpoints list is empty (不限) is matched against the
  // supplier's first endpoint.
  const deriveGroups = (checkedValue: ReadonlySet<string>): readonly EndpointGroup[] => {
    interface Acc {
      providers: string[]
      models: string[]
    }
    const byEndpoint = new Map<string, Acc>()
    const noEndpoint: Acc = { providers: [], models: [] }
    const noEndpointIds: string[] = []
    for (const opt of options) {
      if (!checkedValue.has(opt.id) || !opt.status) continue
      if (opt.endpoints.length === 0) {
        for (const m of opt.models) {
          if (!noEndpoint.models.includes(m)) noEndpoint.models.push(m)
        }
        if (!noEndpoint.providers.includes(opt.name)) noEndpoint.providers.push(opt.name)
        if (!noEndpointIds.includes(opt.id)) noEndpointIds.push(opt.id)
        continue
      }
      for (const ep of opt.endpoints) {
        const cur = byEndpoint.get(ep) ?? { providers: [], models: [] }
        if (!cur.providers.includes(opt.name)) cur.providers.push(opt.name)
        const mep = opt.model_endpoints ?? {}
        for (const m of opt.models) {
          const modelEps = mep[m] ?? []
          // 模型设了明确 endpoint 才进对应组；空（不限）归入供应商第一个 endpoint
          if (modelEps.length > 0) {
            if (!modelEps.includes(ep)) continue
          } else if (ep !== opt.endpoints[0]) {
            continue
          }
          if (!cur.models.includes(m)) cur.models.push(m)
        }
        byEndpoint.set(ep, cur)
      }
    }
    const groups: EndpointGroup[] = [...byEndpoint.entries()].map(([endpoint, v]) => ({
      endpoint,
      providerNames: v.providers,
      modelNames: v.models,
    }))
    if (noEndpoint.providers.length > 0) {
      groups.push({
        endpoint: '__none__',
        providerNames: noEndpoint.providers,
        modelNames: noEndpoint.models,
        noEndpointProviderIds: noEndpointIds,
      })
    }
    return groups
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

  // First candidate prefilled once a group's model sources are empty:
  // the first models.dev supplier for the model, else nothing.
  const ensurePrefill = (endpoint: string, modelNames: readonly string[]) => {
    setSourceByEndpoint((prev) => {
      const cur = prev[endpoint] ?? {}
      let changed = false
      const next = { ...cur }
      for (const m of modelNames) {
        if (next[m] !== undefined) continue
        const c = providersForModel(snapshot ?? [], m)
        if (c.length > 0) {
          next[m] = c[0].providerName
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
    const payload: ManagedAgentGroup[] = groups.map((g) => {
      const endpoint = g.endpoint === '__none__'
        ? (manualEndpoint['__none__'] ?? '').trim()
        : g.endpoint
      return {
        endpoint,
        suffix: (suffixByEndpoint[g.endpoint] ?? '').trim(),
        model_sources: sourceByEndpoint[g.endpoint] ?? {},
        ...(g.endpoint === '__none__' && g.noEndpointProviderIds ? { provider_ids: [...g.noEndpointProviderIds] } : {}),
      }
    })

    // 供应商字段保留逻辑：比较「本次可用的供应商集合」与「编辑前可用的
    // 供应商集合」。两者相等（例如用户把 D 改成了不可用，但只是重新保存）
    // 时保持 DB 里的原始 provider_ids 不动，这样被删除供应商的记录依然
    // 保留 —— 万一同一个 ID 日后复用能自动带回来。集合不同（增/减）才
    // 全量重写，旧的已删记录随之消失。
    let providerIds: readonly string[] = [...checked]
    if (editing) {
      const usableOf = (ids: readonly string[]): string[] =>
        ids
          .filter((id) => options.some((o) => o.id === id && o.status))
          .sort()
      const before = usableOf(editing.provider_ids)
      const now = [...checked].sort()
      const same = before.length === now.length && before.every((id, i) => id === now[i])
      if (same) {
        providerIds = editing.provider_ids
      }
    }

    try {
      const authFields = {
        api_key: apiKey,
        use_source_mark: useSourceMark,
        source_name: sourceName.trim(),
      }
      if (editing) {
        await dashboardApi.updateManagedProvider(record.id, editing.id, {
          name: trimmed,
          provider_ids: [...providerIds],
          groups: payload,
          ...authFields,
        })
        toast('已保存托管 provider')
      } else {
        await dashboardApi.createManagedProvider(record.id, {
          name: trimmed,
          provider_ids: [...checked],
          groups: payload,
          ...authFields,
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
        className="flex max-h-[70vh] flex-col"
      >
        <DialogHeader>
          <DialogTitle>{editing ? '修改托管 provider' : '添加托管 provider'}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载供应商列表…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 items-start gap-4">
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
                    <span className="ml-1 font-normal text-muted-foreground">（显示名称 / 模型数 / endpoint 数）</span>
                  </FieldLabel>
                  <ProviderMultiSelect
                    loading={loading}
                    options={options}
                    checked={checked}
                    onToggle={toggleProvider}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 items-start gap-4">
                <Field>
                  <FieldLabel>
                    接入 Key
                    <span className="ml-1 font-normal text-muted-foreground">（令牌页创建的 Key）</span>
                  </FieldLabel>
                  <Select value={apiKey} onValueChange={setApiKey}>
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder="选择接入用的令牌 Key" />
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.length === 0 ? (
                        <SelectItem value="__none__" disabled>暂无令牌，请先到令牌页创建</SelectItem>
                      ) : (
                        tokens.map((t) => (
                          <SelectItem key={t.id} value={t.key}>
                            {t.name}
                            {!t.status && '（已禁用）'}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    写入生成配置的 apiKey，Agent 用它接入本系统
                  </p>
                </Field>

                <Field>
                  <FieldLabel>BaseURL 标记来源</FieldLabel>
                  <label className="flex cursor-pointer items-center gap-2 py-1.5">
                    <Checkbox
                      checked={useSourceMark}
                      onCheckedChange={(v) => setUseSourceMark(v === true)}
                    />
                    <span className="text-foreground">在 BaseURL 后追加 __来源 段</span>
                  </label>
                  <Input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    disabled={!useSourceMark}
                    placeholder={name.trim() || '来源名，默认为托管名字'}
                  />
                  <p className="text-xs text-muted-foreground">
                    与 BaseURL 设置页的标记来源逻辑一致；不开启则直接使用最终 BaseURL
                  </p>
                </Field>
              </div>

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
                        snapshot={snapshot}
                        sources={sourceByEndpoint[g.endpoint] ?? {}}
                        onSourceChange={(model, supplier) => {
                          setSourceByEndpoint((prev) => ({
                            ...prev,
                            [g.endpoint]: { ...(prev[g.endpoint] ?? {}), [model]: supplier },
                          }))
                        }}
                        manualEndpoint={manualEndpoint[g.endpoint] ?? ''}
                        onManualEndpoint={(v) =>
                          setManualEndpoint((prev) => ({ ...prev, [g.endpoint]: v }))
                        }
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
  onToggle,
}: {
  loading: boolean
  options: readonly ManagedProviderOption[]
  checked: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const inFloat = (target: EventTarget | null): boolean => {
      const node = target as Node | null
      if (!node) return false
      return Boolean(rootRef.current?.contains(node) || panelRef.current?.contains(node))
    }
    const onDocMousedown = (e: MouseEvent) => {
      // 面板经 createPortal 渲染到 body，不包含在 rootRef 内；点击面板
      // 内选项不能当成“点击外部”而关闭。
      if (!inFloat(e.target)) setOpen(false)
    }
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (e: Event) => {
      // 面板/触发器内部的滚动（尤其触屏设备点击选项 / 滚动列表）不能把
      // 下拉关掉；只有外部页面滚动才关闭。
      if (!inFloat(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMousedown)
    document.addEventListener('keydown', onDocKeydown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDocMousedown)
      document.removeEventListener('keydown', onDocKeydown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const toggleOpen = () => {
    if (open) {
      setOpen(false)
      return
    }
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({ top: r.bottom, left: r.left, width: r.width })
    setOpen(true)
  }

  const checkedOptions = options.filter((o) => checked.has(o.id))

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className={
          'flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 ' +
          (open ? 'border-ring ring-1 ring-ring/50' : 'hover:bg-muted/40')
        }
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {checkedOptions.length === 0 ? (
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
            </>
          )}
        </span>
        <AppIcon
          name="expand_more"
          size={16}
          className={'shrink-0 text-muted-foreground transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: anchor.top + 4, left: anchor.left, width: anchor.width }}
            className="z-[70] max-h-[220px] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          >
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
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

function GroupCard({
  group,
  suffix,
  onSuffixChange,
  snapshot,
  sources,
  onSourceChange,
  manualEndpoint,
  onManualEndpoint,
  onPrefill,
  hidden,
}: {
  group: EndpointGroup
  suffix: string
  onSuffixChange: (v: string) => void
  snapshot: readonly ModelsDevModel[] | null
  sources: Record<string, string>
  onSourceChange: (model: string, supplier: string) => void
  manualEndpoint: string
  onManualEndpoint: (v: string) => void
  onPrefill: () => void
  hidden: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    onPrefill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.endpoint, group.modelNames.length])
  const isNoEndpoint = group.endpoint === '__none__'
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
        <span className="flex-1 truncate font-mono font-medium">
          {isNoEndpoint ? (
            <span className="text-warning">未配置 endpoint</span>
          ) : (
            group.endpoint
          )}
        </span>
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
          {isNoEndpoint && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">endpoint</span>
              <Input
                value={manualEndpoint}
                onChange={(e) => onManualEndpoint(e.target.value)}
                placeholder="该供应商未配置 endpoint，可手动输入，例如 /v1/chat/completions"
                className="h-7 flex-1 text-xs font-mono"
              />
            </div>
          )}
          <div className="rounded-md border border-border">
            <div className="grid grid-cols-2 gap-x-4 px-2 py-1 text-[11px] text-muted-foreground">
              <span>模型</span>
              <span>从 models.dev 同步模型配置</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border p-1 text-xs">
              {group.modelNames.map((m) => (
                <div key={m} className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono">{m}</span>
                  <Select
                    value={sources[m] ?? ''}
                    onValueChange={(v) => onSourceChange(m, v)}
                  >
                    <SelectTrigger
                      className="h-7 w-[210px] shrink-0 text-xs"
                      disabled={snapshot === null}
                    >
                      <SelectValue placeholder={snapshot === null ? '加载中…' : '模型配置参考供应商'} />
                    </SelectTrigger>
                    <SelectContent>
                      {snapshot !== null && (
                        <>
                          <SelectItem value="">不同步</SelectItem>
                          {providersForModel(snapshot, m).map((p) => (
                            <SelectItem key={p.providerId} value={p.providerName}>
                              {p.providerName}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}