import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Checkbox } from '@/components/checkbox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import { isModelsDevLab, loadModelsDevModels, providersForModel, type ModelsDevModel } from '@/lib/models-dev'

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

// 命名后缀默认值：endpoint 原样把斜杠换成下划线（/v1/chat/completions → _v1_chat_completions）。
const defaultSuffixOf = (endpoint: string): string =>
  endpoint === '__none__' ? '' : endpoint.replaceAll('/', '_')

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
  // 批量套用来源：按所选模式一次性作用到全部 endpoint 分组。
  // suffixByEndpoint / sourceByEndpoint persist user input per endpoint
  // so re-derivation (e.g. after toggling a supplier) keeps their edits.
  const [suffixByEndpoint, setSuffixByEndpoint] = useState<Record<string, string>>({})
  const [sourceByEndpoint, setSourceByEndpoint] = useState<Record<string, Record<string, string>>>({})
  // endpointByEndpoint lets the 未配置 endpoint group accept a manual
  // endpoint that replaces the sentinel on submit.
  const [manualEndpoint, setManualEndpoint] = useState<Record<string, string>>({})
  // 二次确认：是否显示「删除该托管 provider」确认框。
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
    Promise.all([
      dashboardApi.listManagedProviderOptions(),
      loadModelsDevModels(),
      dashboardApi.listTokens({ limit: 1000, offset: 0 }).catch(() => ({ tokens: [] as readonly Token[], total: 0 })),
      dashboardApi.getSettings().catch(() => [] as ReadonlyArray<{ key: string; value: string }>),
    ])
      .then(([{ options, systemBaseUrl: systemBaseUrlFromBackend }, models, tokensRes, settings]) => {
        setOptions(options)
        setSnapshot(models)
        setTokens(tokensRes.tokens)
        // 系统 BaseURL：优先取后端暴露的 system_base_url —— 与生成 JSON 用的是
        // 同一个值（systemBaseURLPrefix），隧道/反代改掉请求 Host 也不偏差；
        // 未配置时才退回当前前端域名 + base_url_suffix 设置。
        const suffix = settings.find((s) => s.key === 'base_url_suffix')?.value ?? ''
        const auto = (systemBaseUrlFromBackend.trim() || `${window.location.origin}/${(suffix.trim() || 'proxy')}`).replace(/\/+$/, '')
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
          // 手填 endpoint 组恢复：endpoint 无法从当前勾选的供应商派生出来的
          // 分组必然是手动填写的，回填到手动输入框 —— 否则保存过的 endpoint
          // 在重新打开后看起来像丢了（数据其实还在）。
          const checkedIds = new Set(editing.provider_ids)
          const derivable = new Set<string>()
          for (const o of options) {
            if (!checkedIds.has(o.id) || !o.status) continue
            for (const ep of o.endpoints) derivable.add(ep)
          }
          const manualGroup = [...editing.groups, ...(editing.hidden_groups ?? [])]
            .find((g) => g.endpoint && g.endpoint !== '__none__' && !derivable.has(g.endpoint))
          if (manualGroup) {
            setManualEndpoint({ __none__: manualGroup.endpoint })
            suffix['__none__'] = manualGroup.suffix
            sources['__none__'] = { ...manualGroup.model_sources }
          } else {
            // 显式重复组恢复：用户给手填组填了与已有分组相同的 endpoint +
            // 相同后缀，保存后是两条分组记录（写入 JSON 时才合成一个块）。
            // 同一 endpoint 出现两条即视为有一条是手填的重复组，回填显示，
            // 弹窗里依旧呈现为独立两组。
            const endpointCount = new Map<string, number>()
            for (const g of editing.groups) {
              endpointCount.set(g.endpoint, (endpointCount.get(g.endpoint) ?? 0) + 1)
            }
            const dup = editing.groups.find((g) => (endpointCount.get(g.endpoint) ?? 0) > 1)
            if (dup) {
              setManualEndpoint({ __none__: dup.endpoint })
              suffix['__none__'] = dup.suffix
              sources['__none__'] = { ...dup.model_sources }
            } else {
              // 合并态恢复：手填 endpoint 在保存时并入了某个已有分组（该
              // 分组的 endpoint 可从勾选供应商派生），把它的 endpoint 回填进
              // 手动输入框 —— 否则重开后输入框是空的，看起来像没保存。
              const noEpIds = options
                .filter((o) => checkedIds.has(o.id) && o.status && o.endpoints.length === 0)
                .map((o) => o.id)
              const mergedGroup = noEpIds.length
                ? editing.groups.find((g) => (g.provider_ids ?? []).some((pid) => noEpIds.includes(pid)))
                : undefined
              if (mergedGroup) {
                setManualEndpoint({ __none__: mergedGroup.endpoint })
              }
            }
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
  // 命中已有分组时，显示在命名后缀输入框下方的合并提示。
  const noneMergeHint = noneMergeTarget
    ? `已匹配到同名分组「${noneMergeTarget.endpoint}」${(suffixByEndpoint[noneMergeTarget.endpoint] ?? '').trim()
        ? `（命名后缀 ${(suffixByEndpoint[noneMergeTarget.endpoint] ?? '').trim()}）`
        : ''}，此处留空保存将自动合并`
    : undefined

  // 命中已有分组时，后缀输入框的占位符直接显示命中分组的后缀
  // （留空保存即继承该后缀并合并进该分组）。
  const noneSuffixPlaceholder = noneMergeTarget
    ? (suffixByEndpoint[noneMergeTarget.endpoint] ?? defaultSuffixOf(noneMergeTarget.endpoint)).trim()
    : undefined

  // 每个分组的模型来源为空时预填首个候选（models.dev 智能匹配）。
  useEffect(() => {
    for (const g of deferredGroups) ensurePrefill(g.endpoint, g.modelNames)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredGroups])

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

  // 一键官方：所有模型设为官方（lab）参考厂商；模型没有官方来源时
  // 取其候选列表第一个（官方优先排序后的首位，即字母序第一个）。
  const applyOfficialToAll = () => {
    if (snapshot === null) return
    setSourceByEndpoint((prev) => {
      const next = { ...prev }
      let changed = false
      for (const g of groups) {
        const cur: Record<string, string> = {}
        for (const m of g.modelNames) {
          const c = providersForModel(snapshot, m)
          if (c.length === 0) continue
          cur[m] = c[0].providerName
          if ((prev[g.endpoint] ?? {})[m] !== cur[m]) changed = true
        }
        next[g.endpoint] = cur
      }
      return changed ? next : prev
    })
    toast('已把全部模型设为官方参考厂商（无官方的取候选第一个）')
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
    if (apiKey.trim() === '') {
      toast.error('请选择接入用的令牌 Key（必填）')
      return
    }
    // 未配置 endpoint 组：手填 endpoint 的提交语义 ——
    // · 留空：提示并中止（否则会产生空 endpoint 的坏分组，保存必然失败）；
    // · 命中已有分组且未另填后缀：并入该分组，后缀/来源继承命中分组；
    // · 未命中：后缀自动取 endpoint 派生默认值（与普通分组一致），无需手填。
    const manualNoneEp = (manualEndpoint['__none__'] ?? '').trim()
    const noneTarget = manualNoneEp
      ? groups.find((g) => g.endpoint !== '__none__' && g.endpoint === manualNoneEp)
      : undefined
    const noneSuffix = (
      suffixByEndpoint['__none__'] ?? (noneTarget ? '' : defaultSuffixOf(manualNoneEp))
    ).trim()
    const payload: ManagedAgentGroup[] = []
    const mergeInto = (existing: ManagedAgentGroup, entry: ManagedAgentGroup) => {
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
    }
    for (const g of groups) {
      if (g.endpoint === '__none__') {
        if (!manualNoneEp) {
          toast.error('有未配置 endpoint 的供应商：请手动填写 endpoint，或取消勾选它们')
          return
        }
        const entry: ManagedAgentGroup = {
          endpoint: manualNoneEp,
          suffix: noneSuffix,
          model_sources: sourceByEndpoint['__none__'] ?? {},
          ...(g.noEndpointProviderIds ? { provider_ids: [...g.noEndpointProviderIds] } : {}),
        }
        const existing = payload.find((p) => p.endpoint === manualNoneEp)
        if (existing && noneSuffix === '') {
          mergeInto(existing, entry)
          toast(`未配置 endpoint 的供应商已并入分组「${existing.endpoint}」`)
          continue
        }
        payload.push(entry)
        continue
      }
      const entry: ManagedAgentGroup = {
        endpoint: g.endpoint,
        suffix: (suffixByEndpoint[g.endpoint] ?? defaultSuffixOf(g.endpoint)).trim(),
        model_sources: sourceByEndpoint[g.endpoint] ?? {},
      }
      const existing = payload.find((p) => p.endpoint === g.endpoint)
      if (existing) {
        mergeInto(existing, entry)
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
      // 与系统自动值一致 → 存空（跟随系统：系统 BaseURL 改这里自动跟）；
      // 不一致 → 存用户设置的值，生成 JSON 强制用弹窗里这个值。
      const normalized = baseUrl.trim().replace(/\/+$/, '')
      const auto = autoBaseUrl.trim().replace(/\/+$/, '')
      const storedBaseUrl = normalized === '' || normalized === auto ? '' : normalized
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

  // 删除当前编辑的托管 provider（二次确认后再执行）。
  const handleDelete = async () => {
    if (!record || !editing) return
    setDeleting(true)
    try {
      await dashboardApi.deleteManagedProvider(record.id, editing.id)
      toast('已删除托管 provider')
      setConfirmDelete(false)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="lg"
        height="auto"
        minHeight={840}
        scrollFooter
      >
        <DialogHeader>
          <DialogTitle>{editing ? '修改托管 provider' : '添加托管 provider'}</DialogTitle>
        </DialogHeader>

        <DialogScrollBody className="space-y-4" footer={
          <>
            {editing && (
              <Button
                variant="destructive"
                className="mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
              >
                <AppIcon name="delete" size={14} data-icon="inline-start" />
                删除
              </Button>
            )}
            <Button onClick={() => void submit()}>保存</Button>
          </>
        }>
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
                    <span className="ml-1 font-normal text-muted-foreground">（令牌页创建的 Key，必填）</span>
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
                    必填：写入生成配置的 apiKey，Agent 用它接入本系统；留空不再自动借用所勾选供应商的 key
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
从系统配置的供应商中选择
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
                    根据 Endpoint 自动生成多组 provider 配置
                    <span className="ml-1 font-normal text-muted-foreground">
                      （一个 provider 只允许一种 Endpoint）
                    </span>
                  </FieldLabel>
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-md border border-border">
                      <div className="flex items-center border-b border-border bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground">
                        <div className="w-[24%]">Endpoint</div>
                        <div className="w-[14%] border-l border-border pl-2">命名后缀</div>
                        <div className="w-[26%] border-l border-border pl-2">模型</div>
                        <div className="flex w-[36%] items-center justify-between gap-1 border-l border-border pl-2">
                          <span>从 models.dev 同步模型配置</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            title="把全部模型设为官方（lab）参考厂商；没有官方来源的模型取其候选列表第一个"
                            onClick={applyOfficialToAll}
                            disabled={snapshot === null}
                          >
                            <AppIcon name="auto_fix_high" data-icon="inline-start" />
                            批量设置参考厂商
                          </Button>
                        </div>
                      </div>
                      <div className="divide-y divide-border">
                        {deferredGroups.map((g) => {
                          const isNone = g.endpoint === '__none__'
                          const rows = g.modelNames.length > 0 ? g.modelNames : ['']
                          return (
                            <table key={g.endpoint} className="w-full table-fixed text-xs">
                              <tbody>
                                {rows.map((m, idx) => (
                                  <tr key={m || '__empty__'} className={idx > 0 ? 'border-t border-border/50' : undefined}>
                                    {idx === 0 && (
                                      <td rowSpan={rows.length} className="w-[24%] border-r border-border px-2 py-2 align-middle">
                                        {isNone ? (
                                          <Input
                                            value={manualEndpoint[g.endpoint] ?? ''}
                                            onChange={(e) =>
                                              setManualEndpoint((prev) => ({ ...prev, [g.endpoint]: e.target.value }))
                                            }
                                            placeholder="手动输入，例如 /v1/chat/completions"
                                            className="h-7 w-full text-xs font-mono"
                                          />
                                        ) : (
                                          <span className="block truncate font-mono" title={g.endpoint}>{g.endpoint}</span>
                                        )}
                                      </td>
                                    )}
                                    {idx === 0 && (
                                      <td rowSpan={rows.length} className="w-[14%] border-r border-border px-2 py-2 align-middle">
                                        <Input
                                          value={
                                            isNone
                                              ? (suffixByEndpoint[g.endpoint] ?? (noneMergeTarget ? '' : defaultSuffixOf(manualNoneEndpoint)))
                                              : (suffixByEndpoint[g.endpoint] ?? defaultSuffixOf(g.endpoint))
                                          }
                                          onChange={(e) =>
                                            setSuffixByEndpoint((prev) => ({ ...prev, [g.endpoint]: e.target.value }))
                                          }
                                          placeholder={isNone && noneSuffixPlaceholder ? noneSuffixPlaceholder : '填写命名后缀'}
                                          className="h-7 w-full text-xs font-mono"
                                        />
                                        {isNone && noneMergeHint && (
                                          <p className="mt-1 text-[11px] leading-tight break-all text-warning">{noneMergeHint}</p>
                                        )}
                                      </td>
                                    )}
                                    {m ? (
                                      <>
                                        <td className="w-[26%] border-r border-border px-2 py-1.5">
                                          <span className="block truncate font-mono" title={m}>{m}</span>
                                        </td>
                                        <td className="w-[36%] px-2 py-1.5">
                                          <Select
                                            value={sourceByEndpoint[g.endpoint]?.[m] ?? ''}
                                            onValueChange={(v) =>
                                              setSourceByEndpoint((prev) => ({
                                                ...prev,
                                                [g.endpoint]: { ...(prev[g.endpoint] ?? {}), [m]: v },
                                              }))
                                            }
                                            disabled={snapshot === null}
                                          >
                                            <SelectTrigger className="h-7 w-full text-xs">
                                              <SelectValue placeholder={snapshot === null ? '加载中…' : '选择参考厂商'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {snapshot !== null && (
                                                <>
                                                  <SelectItem value="">不同步</SelectItem>
                                                  {(() => {
                                                    const stored = sourceByEndpoint[g.endpoint]?.[m] ?? ''
                                                    const candidates = providersForModel(snapshot, m)
                                                    if (stored === '' || candidates.some((p) => p.providerName === stored)) return null
                                                    // 存值可能是历史 models.dev providerId：能解析出名称就显示名称。
                                                    const resolved = snapshot.find((r) => r.providerId === stored)?.providerName
                                                    const raw = resolved ?? stored
                                                    return (
                                                      <SelectItem value={stored}>
                                                        {raw.length > 14 ? `${raw.slice(0, 8)}…（已失效）` : `${raw}（已失效）`}
                                                      </SelectItem>
                                                    )
                                                  })()}
                                                  {providersForModel(snapshot, m).map((p) => (
                                                    <SelectItem key={p.providerId} value={p.providerName}>
                                                      {p.providerName}{isModelsDevLab(m, p.providerId) ? '（官方）' : ''}
                                                    </SelectItem>
                                                  ))}
                                                </>
                                              )}
                                            </SelectContent>
                                          </Select>
                                        </td>
                                      </>
                                    ) : (
                                      <td colSpan={2} className="px-2 py-1.5 text-muted-foreground">（无模型）</td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </Field>
              )}
            </>
          )}
        </DialogScrollBody>
      </DialogContent>

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent width="sm" scrollFooter>
          <DialogHeader>
            <DialogTitle>删除托管 provider</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </>
          }>
            <p className="text-xs text-muted-foreground">
              确认删除托管 provider「{editing?.name ?? ''}」？删除会立即生效，已生成的 provider 配置仍会保留。
            </p>
          </DialogScrollBody>
        </DialogContent>
      </Dialog>
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
  const checkedOptions = options.filter((o) => checked.has(o.id))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 hover:bg-muted/40"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {checkedOptions.length === 0 ? (
              <span className="text-muted-foreground">点击展开，勾选系统配置的供应商</span>
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
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[55vh] w-[--radix-popover-trigger-width] overflow-auto p-0"
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
                      'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs select-none ' +
                      (disabled
                        ? 'cursor-not-allowed opacity-40'
                        : selected
                          ? 'bg-muted/60'
                          : 'hover:bg-muted/40')
                    }
                  >
                    <Checkbox
                      checked={selected}
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
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
      </PopoverContent>
    </Popover>
  )
}

