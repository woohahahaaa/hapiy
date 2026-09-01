import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/AppIcon'
import { Badge } from '@/components/ui/badge'
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
import { RemovableTag } from '@/components/tag'
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
  // 接入 Key（令牌）、BaseURL（留空跟随系统）与来源标记选项。
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [autoBaseUrl, setAutoBaseUrl] = useState('')
  const [sourceName, setSourceName] = useState('')
  // 批量套用来源模式：对全部 endpoint 分组生效。
  const [batchMode, setBatchMode] = useState('__prefill__')
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
    setBaseUrl('')
    setSourceName('')
    setBatchMode('__prefill__')
    Promise.all([
      dashboardApi.listManagedProviderOptions(),
      loadModelsDevModels(),
      dashboardApi.listTokens({ limit: 1000, offset: 0 }).catch(() => ({ tokens: [] as readonly Token[], total: 0 })),
      dashboardApi.getSettings().catch(() => [] as ReadonlyArray<{ key: string; value: string }>),
    ])
      .then(([opts, models, tokensRes, settings]) => {
        setOptions(opts)
        setSnapshot(models)
        setTokens(tokensRes.tokens)
        // 系统 BaseURL：当前前端域名 + base_url_suffix 设置（BaseURL 设置页逻辑）
        const suffix = settings.find((s) => s.key === 'base_url_suffix')?.value ?? ''
        const auto = `${window.location.origin}/${(suffix.trim() || 'proxy')}`
        setAutoBaseUrl(auto)
        if (editing) {
          setName(editing.name)
          setChecked(new Set(editing.provider_ids))
          setApiKey(editing.api_key)
          // 存量为空（跟随系统）时直接把自动值填进正文，用户可编辑
          setBaseUrl(editing.base_url || auto)
          setSourceName(editing.source_name)
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
        } else {
          // 新建：直接把系统自动值填进正文，用户可编辑
          setBaseUrl(auto)
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
  // 未配置 endpoint 组手动填写的 endpoint 命中已有分组时，把命中分组的
  // 后缀作为占位提示（留空保存即自动合并进该分组）。
  const manualNoneEndpoint = (manualEndpoint['__none__'] ?? '').trim()
  const noneMergeTarget = manualNoneEndpoint
    ? deferredGroups.find((g) => g.endpoint !== '__none__' && g.endpoint === manualNoneEndpoint)
    : undefined
  const noneMergePlaceholder = noneMergeTarget
    ? `${(suffixByEndpoint[noneMergeTarget.endpoint] ?? '').trim() || noneMergeTarget.endpoint}（匹配到已有相同 endpoint 的分组，此处留空则自动合并）`
    : undefined

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

  // 全部模型中出现的候选来源供应商（批量套用下拉选项）。
  const batchSuppliers = useMemo(() => {
    const names = new Set<string>()
    for (const g of deferredGroups) {
      for (const m of g.modelNames) {
        for (const p of providersForModel(snapshot ?? [], m)) names.add(p.providerName)
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [deferredGroups, snapshot])

  // 批量套用来源：按所选模式一次性作用到全部 endpoint 分组。
  const applyBatchSource = () => {
    if (batchMode === '__prefill__') {
      if (snapshot === null) return
      // 智能匹配：为所有尚未设置来源的模型填入 models.dev 首个供应商
      setSourceByEndpoint((prev) => {
        const next = { ...prev }
        let changed = false
        for (const g of groups) {
          const cur = { ...(next[g.endpoint] ?? {}) }
          for (const m of g.modelNames) {
            if (cur[m] !== undefined) continue
            const c = providersForModel(snapshot, m)
            if (c.length > 0) {
              cur[m] = c[0].providerName
              changed = true
            }
          }
          next[g.endpoint] = cur
        }
        return changed ? next : prev
      })
    } else if (batchMode === '__clear__') {
      // 全部置空（不同步）
      setSourceByEndpoint((prev) => {
        const next = { ...prev }
        let changed = false
        for (const g of groups) {
          const cur = { ...(next[g.endpoint] ?? {}) }
          for (const m of g.modelNames) {
            if (cur[m] !== '') {
              cur[m] = ''
              changed = true
            }
          }
          next[g.endpoint] = cur
        }
        return changed ? next : prev
      })
    } else {
      const supplier = batchMode
      setSourceByEndpoint((prev) => {
        const next = { ...prev }
        let changed = false
        for (const g of groups) {
          const cur: Record<string, string> = {}
          for (const m of g.modelNames) {
            cur[m] = supplier
            if ((prev[g.endpoint] ?? {})[m] !== supplier) changed = true
          }
          next[g.endpoint] = cur
        }
        return changed ? next : prev
      })
    }
    toast('已批量套用来源')
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
    // 未配置 endpoint 组手动填写的 endpoint 与已有分组相同时，自动并入该
    // 分组（保留原分组的后缀与模型来源，仅追加其供应商），避免后端出现
    // 重复 endpoint 条目。
    const payload: ManagedAgentGroup[] = []
    for (const g of groups) {
      const endpoint = g.endpoint === '__none__'
        ? (manualEndpoint['__none__'] ?? '').trim()
        : g.endpoint
      const entry: ManagedAgentGroup = {
        endpoint,
        suffix: (suffixByEndpoint[g.endpoint] ?? '').trim(),
        model_sources: sourceByEndpoint[g.endpoint] ?? {},
        ...(g.endpoint === '__none__' && g.noEndpointProviderIds ? { provider_ids: [...g.noEndpointProviderIds] } : {}),
      }
      const existing = payload.find((p) => p.endpoint === endpoint)
      // 未分配 endpoint 组：手动 endpoint 命中已有分组且未另填后缀时，自动
      // 并入该分组（保留命中分组的后缀与模型来源，仅追加供应商与缺失的
      // 模型来源）；若用户显式填了后缀，则按用户意图保留独立条目。
      if (existing && (g.endpoint !== '__none__' || (suffixByEndpoint['__none__'] ?? '').trim() === '')) {
        const mergedSources: Record<string, string> = { ...existing.model_sources }
        for (const [m, s] of Object.entries(entry.model_sources)) {
          if (mergedSources[m] === undefined) mergedSources[m] = s
        }
        const idx = payload.indexOf(existing)
        payload[idx] = {
          ...existing,
          provider_ids: [...new Set([...(existing.provider_ids ?? []), ...(entry.provider_ids ?? [])])],
          model_sources: mergedSources,
        }
        continue
      }
      payload.push(entry)
    }
    if (payload.length > 1) {
      for (const p of payload) {
        if (!p.suffix) {
          toast.error(`有多个 endpoint 分组，必须为 ${p.endpoint} 填写后缀`)
          return
        }
      }
    }

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
      // BaseURL 与系统自动值一致 → 存空（生成时实时跟随系统设置）
      const storedBaseUrl = baseUrl.trim() === '' || baseUrl.trim() === autoBaseUrl.trim() ? '' : baseUrl.trim()
      const authFields = {
        api_key: apiKey,
        base_url: storedBaseUrl,
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
        className="flex max-h-[70vh] flex-col gap-0"
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
                  <FieldLabel>规则名称</FieldLabel>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：HAPIY"
                  />
                  <p className="text-xs text-muted-foreground">
                    各组最终 provider 名 = 规则名称 + 后缀（只有一个分组时后缀可选）
                  </p>
                </Field>

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
              </div>

              <div className="grid grid-cols-2 items-start gap-4">
                <Field>
                  <FieldLabel>BaseURL</FieldLabel>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://host:port/proxy"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    默认填入系统识别的 BaseURL，可直接编辑；清空则恢复系统默认
                  </p>
                </Field>

                <Field>
                  <FieldLabel>标记来源</FieldLabel>
                  <Input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="可留空"
                  />
                  <p className="text-xs text-muted-foreground">
                    填写后在 BaseURL 后追加 __来源 段；可留空
                  </p>
                </Field>
              </div>

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

              {deferredGroups.length > 0 && (
                <Field>
                  <FieldLabel>
                    endpoint 分组
                    <span className="ml-1 font-normal text-muted-foreground">
                      （完全相同才分到一组；点击行可折叠/展开子表格）
                    </span>
                  </FieldLabel>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                      <span className="text-xs text-muted-foreground">
                        批量套用来源（对全部 endpoint 分组生效）
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Select value={batchMode} onValueChange={setBatchMode} disabled={snapshot === null}>
                          <SelectTrigger className="h-7 w-56 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__prefill__">默认推荐（智能匹配）</SelectItem>
                            {batchSuppliers.map((s) => (
                              <SelectItem key={s} value={s}>全部设为 {s}</SelectItem>
                            ))}
                            <SelectItem value="__clear__">不同步（清空全部）</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={applyBatchSource}
                          disabled={snapshot === null}
                        >
                          应用
                        </Button>
                      </div>
                    </div>
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
                        mergePlaceholder={g.endpoint === '__none__' ? noneMergePlaceholder : undefined}
                        onPrefill={() => ensurePrefill(g.endpoint, g.modelNames)}
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
                <RemovableTag
                  key={o.id}
                  label={<span className="font-medium">{o.name}</span>}
                  onRemove={() => onToggle(o.id)}
                  removeTitle={`移除 ${o.name}`}
                />
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

const SUFFIX_LABEL = '分组后缀（为不同 endpoint 的分组设置不同名称）'

function GroupCard({
  group,
  suffix,
  onSuffixChange,
  snapshot,
  sources,
  onSourceChange,
  manualEndpoint,
  onManualEndpoint,
  mergePlaceholder,
  onPrefill,
}: {
  group: EndpointGroup
  suffix: string
  onSuffixChange: (v: string) => void
  snapshot: readonly ModelsDevModel[] | null
  sources: Record<string, string>
  onSourceChange: (model: string, supplier: string) => void
  manualEndpoint: string
  onManualEndpoint: (v: string) => void
  mergePlaceholder?: string
  onPrefill: () => void
}) {
  const [expanded, setExpanded] = useState(group.endpoint === '__none__')
  const [filter, setFilter] = useState('')
  useEffect(() => {
    onPrefill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.endpoint, group.modelNames.length])
  const isNoEndpoint = group.endpoint === '__none__'
  const filteredModels = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? group.modelNames.filter((m) => m.toLowerCase().includes(q)) : group.modelNames
  }, [group.modelNames, filter])

  const chevronClass =
    'shrink-0 text-muted-foreground transition-transform ' + (expanded ? 'rotate-90' : '')
  const stats = (
    <Badge variant="secondary" className="shrink-0 font-normal">
      {group.providerNames.length} 个供应商 · {group.modelNames.length} 个模型
    </Badge>
  )
  const suffixRow = (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{SUFFIX_LABEL}</span>
      <Input
        value={suffix}
        onChange={(e) => onSuffixChange(e.target.value)}
        placeholder={mergePlaceholder ?? '例如：-C（多个分组时必填）'}
        className="h-7 w-44 text-xs font-mono"
      />
    </div>
  )

  return (
    <div
      className={
        'overflow-hidden rounded-lg border ' +
        (isNoEndpoint ? 'border-warning/40' : 'border-border')
      }
    >
      <div className={'px-2.5 py-2 ' + (isNoEndpoint ? 'bg-warning/10' : 'bg-muted/40')}>
        {isNoEndpoint ? (
          <>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setExpanded(!expanded)}
            >
              <AppIcon name="chevron_right" size={14} className={chevronClass} />
              <AppIcon name="warning" size={14} className="shrink-0 text-warning" />
              <span className="shrink-0 text-xs font-medium text-warning">
                未分配 Endpoint 的供应商
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-warning/80">
                需要补全路径或合并入已有分组
              </span>
              {stats}
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="shrink-0 text-xs text-muted-foreground">endpoint 路径</span>
              <Input
                value={manualEndpoint}
                onChange={(e) => onManualEndpoint(e.target.value)}
                placeholder="该供应商未配置 endpoint，可手动输入，例如 /v1/chat/completions"
                className="h-7 w-72 max-w-full text-xs font-mono"
              />
            </div>
            {suffixRow}
          </>
        ) : (
          <>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setExpanded(!expanded)}
            >
              <AppIcon name="chevron_right" size={14} className={chevronClass} />
              <Badge variant="outline" className="min-w-0 max-w-[55%] truncate font-mono text-xs">
                {group.endpoint}
              </Badge>
              {stats}
            </button>
            {suffixRow}
          </>
        )}
      </div>
      {expanded && (
        <div className="space-y-2 p-2.5">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤当前组内的模型…"
            className="h-7 text-xs"
          />
          <div className="overflow-hidden rounded-md border border-border">
            <div className="flex items-center border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">模型</span>
              <span className="w-[200px] shrink-0 border-l border-border pl-2">
                从 models.dev 同步模型配置
              </span>
            </div>
            <div className="divide-y divide-border">
              {filteredModels.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">没有匹配的模型</p>
              ) : (
                filteredModels.map((m) => (
                  <div key={m} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono" title={m}>{m}</span>
                    <Select
                      value={sources[m] ?? ''}
                      onValueChange={(v) => onSourceChange(m, v)}
                    >
                      <SelectTrigger
                        className="h-7 w-[200px] shrink-0 text-xs"
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
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}