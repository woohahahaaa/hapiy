import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('agentConfig')
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
      .catch((err) => toast.error(err instanceof Error ? err.message : t('errors.loadFailed')))
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
    ? t('managedDialog.noneMergeHint', {
        endpoint: noneMergeTarget.endpoint,
        suffixHint: (suffixByEndpoint[noneMergeTarget.endpoint] ?? '').trim()
          ? t('managedDialog.noneMergeSuffixPart', { suffix: (suffixByEndpoint[noneMergeTarget.endpoint] ?? '').trim() })
          : '',
      })
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
    toast(t('toast.officialAll'))
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
      toast.error(t('toast.nameRequired'))
      return
    }
    if (groups.length === 0) {
      toast.error(t('toast.noEndpointProvider'))
      return
    }
    if (apiKey.trim() === '') {
      toast.error(t('toast.apiKeyRequired'))
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
          toast.error(t('toast.manualEndpointRequired'))
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
          toast(t('toast.mergedIntoGroup', { endpoint: existing.endpoint }))
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
          toast.error(t('toast.suffixRequired', { endpoint: p.endpoint }))
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
        toast(t('toast.savedProvider'))
      } else {
        await dashboardApi.createManagedProvider(record.id, {
          name: trimmed,
          provider_ids: [...checked],
          groups: payload,
          ...authFields,
        })
        toast(t('toast.createdProvider'))
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.saveFailed'))
    }
  }

  // 删除当前编辑的托管 provider（二次确认后再执行）。
  const handleDelete = async () => {
    if (!record || !editing) return
    setDeleting(true)
    try {
      await dashboardApi.deleteManagedProvider(record.id, editing.id)
      toast(t('toast.deletedProvider'))
      setConfirmDelete(false)
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.deleteFailed'))
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
          <DialogTitle>{editing ? t('managedDialog.titleEdit') : t('managedDialog.titleCreate')}</DialogTitle>
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
                {t('common:action.delete')}
              </Button>
            )}
            <Button onClick={() => void submit()}>{t('common:action.save')}</Button>
          </>
        }>
          {loading ? (
            <p className="text-xs text-muted-foreground">{t('managedDialog.loadingProviders')}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 items-start gap-4">
                <Field>
                  <FieldLabel>{t('managedDialog.ruleNameLabel')}</FieldLabel>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('managedDialog.ruleNamePlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('managedDialog.ruleNameHint')}
                  </p>
                </Field>

                <Field>
                  <FieldLabel>
                    {t('managedDialog.apiKeyLabel')}
                    <span className="ml-1 font-normal text-muted-foreground">{t('managedDialog.apiKeyRequiredSuffix')}</span>
                  </FieldLabel>
                  <Select value={apiKey} onValueChange={setApiKey}>
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder={t('managedDialog.apiKeyPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.length === 0 ? (
                        <SelectItem value="__none__" disabled>{t('managedDialog.noTokens')}</SelectItem>
                      ) : (
                        tokens.map((token) => (
                          <SelectItem key={token.id} value={token.key}>
                            {token.name}
                            {!token.status && t('managedDialog.tokenDisabled')}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('managedDialog.apiKeyHint')}
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
                    {t('managedDialog.baseUrlHint')}
                  </p>
                </Field>

                <Field>
                  <FieldLabel>{t('managedDialog.sourceLabel')}</FieldLabel>
                  <Input
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder={t('managedDialog.sourcePlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('managedDialog.sourceHint')}
                  </p>
                </Field>
              </div>

              <Field>
                <FieldLabel>
                  {t('managedDialog.selectProvidersLabel')}
                  <span className="ml-1 font-normal text-muted-foreground">{t('managedDialog.selectProvidersSuffix')}</span>
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
                    {t('managedDialog.groupsLabel')}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {t('managedDialog.groupsSuffix')}
                    </span>
                  </FieldLabel>
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-xs border border-border">
                      <div className="flex items-center border-b border-border-subtle bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground">
                        <div className="w-[24%]">Endpoint</div>
                        <div className="w-[14%] border-l border-border-subtle pl-2">{t('managedDialog.suffixColumn')}</div>
                        <div className="w-[26%] border-l border-border-subtle pl-2">{t('managedDialog.modelsColumn')}</div>
                        <div className="flex w-[36%] items-center justify-between gap-1 border-l border-border-subtle pl-2">
                          <span>{t('columns.syncFromModelsDev')}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            title={t('managedDialog.bulkSetTitle')}
                            onClick={applyOfficialToAll}
                            disabled={snapshot === null}
                          >
                            <AppIcon name="auto_fix_high" data-icon="inline-start" />
                            {t('managedDialog.bulkSet')}
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
                                  <tr key={m || '__empty__'} className={idx > 0 ? 'border-t border-border-subtle' : undefined}>
                                    {idx === 0 && (
                                      <td rowSpan={rows.length} className="w-[24%] border-r border-border-subtle px-2 py-2 align-middle">
                                        {isNone ? (
                                          <Input
                                            value={manualEndpoint[g.endpoint] ?? ''}
                                            onChange={(e) =>
                                              setManualEndpoint((prev) => ({ ...prev, [g.endpoint]: e.target.value }))
                                            }
                                            placeholder={t('managedDialog.manualEndpointPlaceholder')}
                                            className="h-7 w-full text-xs font-mono"
                                          />
                                        ) : (
                                          <span className="block truncate font-mono" title={g.endpoint}>{g.endpoint}</span>
                                        )}
                                      </td>
                                    )}
                                    {idx === 0 && (
                                      <td rowSpan={rows.length} className="w-[14%] border-r border-border-subtle px-2 py-2 align-middle">
                                        <Input
                                          value={
                                            isNone
                                              ? (suffixByEndpoint[g.endpoint] ?? (noneMergeTarget ? '' : defaultSuffixOf(manualNoneEndpoint)))
                                              : (suffixByEndpoint[g.endpoint] ?? defaultSuffixOf(g.endpoint))
                                          }
                                          onChange={(e) =>
                                            setSuffixByEndpoint((prev) => ({ ...prev, [g.endpoint]: e.target.value }))
                                          }
                                          placeholder={isNone && noneSuffixPlaceholder ? noneSuffixPlaceholder : t('managedDialog.suffixPlaceholder')}
                                          className="h-7 w-full text-xs font-mono"
                                        />
                                        {isNone && noneMergeHint && (
                                          <p className="mt-1 text-[11px] leading-tight break-all text-warning">{noneMergeHint}</p>
                                        )}
                                      </td>
                                    )}
                                    {m ? (
                                      <>
                                        <td className="w-[26%] border-r border-border-subtle px-2 py-1.5">
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
                                              <SelectValue placeholder={snapshot === null ? t('common:state.loading') : t('managedDialog.referencePlaceholder')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {snapshot !== null && (
                                                <>
                                                  <SelectItem value="">{t('managedDialog.noSync')}</SelectItem>
                                                  {(() => {
                                                    const stored = sourceByEndpoint[g.endpoint]?.[m] ?? ''
                                                    const candidates = providersForModel(snapshot, m)
                                                    if (stored === '' || candidates.some((p) => p.providerName === stored)) return null
                                                    // 存值可能是历史 models.dev providerId：能解析出名称就显示名称。
                                                    const resolved = snapshot.find((r) => r.providerId === stored)?.providerName
                                                    const raw = resolved ?? stored
                                                    return (
                                                      <SelectItem value={stored}>
                                                        {raw.length > 14 ? `${raw.slice(0, 8)}…${t('managedDialog.staleSuffix')}` : `${raw}${t('managedDialog.staleSuffix')}`}
                                                      </SelectItem>
                                                    )
                                                  })()}
                                                  {providersForModel(snapshot, m).map((p) => (
                                                    <SelectItem key={p.providerId} value={p.providerName}>
                                                      {p.providerName}{isModelsDevLab(m, p.providerId) ? t('managedDialog.officialSuffix') : ''}
                                                    </SelectItem>
                                                  ))}
                                                </>
                                              )}
                                            </SelectContent>
                                          </Select>
                                        </td>
                                      </>
                                    ) : (
                                      <td colSpan={2} className="px-2 py-1.5 text-muted-foreground">{t('managedDialog.noModelsCell')}</td>
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
            <DialogTitle>{t('managedDialog.confirmDeleteTitle')}</DialogTitle>
          </DialogHeader>
          <DialogScrollBody footer={
            <>
              <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? t('managedDialog.confirmDeleteBusy') : t('confirmDelete.confirm')}
              </Button>
            </>
          }>
            <p className="text-xs text-muted-foreground">
              {t('managedDialog.confirmDeleteDescription', { name: editing?.name ?? '' })}
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
  const { t } = useTranslation('agentConfig')
  const checkedOptions = options.filter((o) => checked.has(o.id))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-8 w-full items-center gap-1.5 rounded-xs border border-border bg-transparent px-2.5 py-2 text-xs outline-none select-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 hover:bg-muted/40"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {checkedOptions.length === 0 ? (
              <span className="text-muted-foreground">{t('managedDialog.emptyMultiSelect')}</span>
            ) : (
              <>
                {checkedOptions.map((o) => (
                  <RemovableTag
                    key={o.id}
                    label={<span className="font-medium">{o.name}</span>}
                    onRemove={() => onToggle(o.id)}
                    removeTitle={t('managedDialog.removeTitle', { name: o.name })}
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
          <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('managedDialog.loadingProviders')}</p>
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
                      {disabled && <span className="ml-1 text-muted-foreground">{t('managedDialog.providerDisabled')}</span>}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {t('managedDialog.providerMeta', { models: opt.modelCount, endpoints: opt.endpointCount })}
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

