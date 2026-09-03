import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DiffView } from '@/components/DiffView'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { dashboardApi } from '@/lib/dashboard-api'
import type {
  AgentConfigFile,
  AgentModelProvider,
  AgentModelSummary,
  AgentProtocol,
  AgentRecommendation,
  ManagedGroupView,
  ManagedProviderView,
} from '@/lib/dashboard-api'
import { AgentModelInfoMatchDialog } from '@/components/dialog/agent-model-info-match'
import { ManagedProviderDialog } from '@/components/dialog/agent-managed-dialog'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'

type DiffStatus = 'ok' | 'missing' | 'mismatch' | 'extra' | 'no-recommendation'

interface DiffMarker {
  readonly path: string
  readonly status: DiffStatus
  readonly recommended: unknown
  readonly actual: unknown
}

interface AgentModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AgentConfigFile | null
  fetchModels: (id: string) => Promise<AgentModelSummary>
}

export function AgentModelsDialog({
  open,
  onOpenChange,
  record,
  fetchModels,
}: AgentModelsDialogProps) {
  const [summary, setSummary] = useState<AgentModelSummary | null>(null)
  const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [syncingFromInfo, setSyncingFromInfo] = useState(false)
  // liveContent is the working copy the user is editing / staging
  // changes against. null means "no staged changes — render the actual
  // content pulled from summary". After the user clicks any "使用推荐值"
  // (row or header), bulk-apply, or directly edits the JSON, we set it.
  const [liveContent, setLiveContent] = useState<string | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [saving, setSaving] = useState(false)

  // rawContent is the true file content fetched alongside the summary so
  // local provider/model rename/delete mutations operate on the real
  // document shape (opencode's "provider" or openclaw's
  // "models.providers"), not a re-synthesized {provider} root.
  const [rawContent, setRawContent] = useState<string | null>(null)
  // templateTally: after "使用推荐模板", per-provider and per-model
  // change counts for the green "N 处修改" preview labels.
  const [templateTally, setTemplateTally] = useState<
    Readonly<Map<string, { count: number; models: Readonly<Record<string, number>> }>>
  >(new Map())
  const [templateApplied, setTemplateApplied] = useState(0)
  const [confirmingTemplate, setConfirmingTemplate] = useState(false)
  const [renamingModel, setRenamingModel] = useState<{ providerId: string; modelId: string } | null>(null)
  const [confirmingDeleteModel, setConfirmingDeleteModel] = useState<{ providerId: string; modelId: string } | null>(null)

  // Managed (托管) providers bound to this file + their selection state.
  const [managed, setManaged] = useState<readonly ManagedProviderView[]>([])
  // selectedManaged: { mid, endpoint } when viewing a managed group's
  // generated block (read-only), null otherwise.
  const [selectedManaged, setSelectedManaged] = useState<{ mid: string; endpoint: string } | null>(null)
  const [selectedManagedModelId, setSelectedManagedModelId] = useState<string | null>(null)
  const [expandedManaged, setExpandedManaged] = useState<Set<string>>(new Set())
  const [renamingProvider, setRenamingProvider] = useState<string | null>(null)
  const [confirmingDeleteProvider, setConfirmingDeleteProvider] = useState<string | null>(null)
  const [confirmingDeleteManaged, setConfirmingDeleteManaged] = useState<ManagedProviderView | null>(null)
  const [managedDialogOpen, setManagedDialogOpen] = useState(false)
  const [managedEditing, setManagedEditing] = useState<ManagedProviderView | null>(null)
  const [syncingAllManaged, setSyncingAllManaged] = useState(false)

  const reload = () => {
    if (!record) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetchModels(record.id),
      dashboardApi.listManagedProviders(record.id),
      dashboardApi.getAgentConfigFileContent(record.id).catch(() => null),
    ])
      .then(([res, managedRes, raw]) => {
        setSummary(res)
        setManaged(managedRes)
        setRawContent(raw)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open || !record) return
    setSummary(null)
    setError(null)
    setSelectedProviderId(null)
    setSelectedModelId(null)
    setSelectedManaged(null)
    setManaged([])
    setExpandedManaged(new Set())
    setRawContent(null)
    setTemplateTally(new Map()); setTemplateApplied(0)
    setLiveContent(null)
    setConfirmingCancel(false)
    reload()
  }, [open, record]) // eslint-disable-line react-hooks/exhaustive-deps

  // workingProviders: the provider list currently shown. Reflects staged
  // deletes/renames in liveContent when present; otherwise the summary.
  const workingProviders = useMemo<readonly AgentModelProvider[]>(() => {
    if (liveContent === null) return summary?.providers ?? []
    const parsed = parseWorkingProviderList(liveContent, summary)
    return parsed ?? summary?.providers ?? []
  }, [liveContent, summary])

  // 托管供应商识别：配置文件里的 provider 块名与托管模板生成的块名
  // （根名，或根名+后缀）相同 → 该块归托管，不再显示在普通供应商列表。
  const managedBlockNames = useMemo(() => {
    const names = new Set<string>()
    for (const mv of managed) {
      names.add(mv.name)
      for (const g of mv.groups) names.add(`${mv.name}${g.suffix}`)
    }
    return names
  }, [managed])

  // 普通供应商 = 名字不命中任何托管块名。
  const normalProviders = useMemo(
    () => workingProviders.filter((p) => !managedBlockNames.has(p.provider_id)),
    [workingProviders, managedBlockNames],
  )

  // Re-select the first provider/model whenever the working provider set
  // changes (deletions/renames staged in liveContent reflect here). The
  // Managed selection is entirely separate and never auto-selected.
  useEffect(() => {
    const working = normalProviders
    if (selectedManaged) return
    if (
      selectedProviderId &&
      working.some((p) => p.provider_id === selectedProviderId)
    ) {
      const provider = working.find((p) => p.provider_id === selectedProviderId)!
      if (selectedModelId && provider.models.some((m) => m.id === selectedModelId)) return
      setSelectedModelId(provider.models[0]?.id ?? null)
      return
    }
    const first = working[0]
    setSelectedProviderId(first?.provider_id ?? null)
    setSelectedModelId(first?.models[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalProviders, selectedProviderId, selectedModelId, selectedManaged])

  // The managed view backing the current selection: { view, group }.
  const selectedManagedGroup = useMemo<{ view: ManagedProviderView; group: ManagedGroupView } | null>(() => {
    if (!selectedManaged) return null
    const view = managed.find((m) => m.id === selectedManaged.mid) ?? null
    if (!view) return null
    const group = view.groups.find((g) => g.endpoint === selectedManaged.endpoint) ?? view.groups[0]
    if (!group) return null
    return { view, group }
  }, [selectedManaged, managed])

  const selectedProvider = useMemo<AgentModelProvider | null>(() => {
    if (!summary) return null
    return workingProviders.find((p) => p.provider_id === selectedProviderId) ?? null
  }, [workingProviders, selectedProviderId, summary])

  const selectedModel = useMemo(() => {
    if (!selectedProvider) return null
    if (!selectedModelId) return null
    return selectedProvider.models.find((m) => m.id === selectedModelId) ?? null
  }, [selectedProvider, selectedModelId])

  const providerRecs = useMemo(
    () => (summary?.recommendations ?? []).filter((r) => r.scope === 'provider'),
    [summary],
  )
  const modelRecs = useMemo(
    () => (summary?.recommendations ?? []).filter((r) => r.scope === 'model'),
    [summary],
  )

  // Provider-level effective recommendations = common + protocols whose
  // conditions match the selected provider's actual config fields.
  const effectiveProviderRecs = useMemo(() => {
    const base = providerRecs
    if (!selectedProvider || !summary) return base
    const matched = (summary.protocols ?? []).filter((p) =>
      protocolMatchesConditions(selectedProvider.other_fields, p),
    )
    const extra: AgentRecommendation[] = []
    for (const p of matched) {
      for (const r of p.recommendations) {
        if (r.scope === 'provider') extra.push(r)
      }
    }
    return [...base, ...extra]
  }, [providerRecs, selectedProvider, summary])

  const effectiveModelRecs = useMemo(() => {
    const base = modelRecs
    if (!selectedProvider || !summary) return base
    const matched = (summary.protocols ?? []).filter((p) =>
      protocolMatchesConditions(selectedProvider.other_fields, p),
    )
    const extra: AgentRecommendation[] = []
    for (const p of matched) {
      for (const r of p.recommendations) {
        if (r.scope === 'model') extra.push(r)
      }
    }
    return [...base, ...extra]
  }, [modelRecs, selectedProvider, summary])

  // activeProviderValue / activeModelValue are what the JSON view shows
  // right now. They are the actual file content until the user clicks
  // "使用推荐值" (row or header) or edits the JSON, at which point we
  // hand them a working copy stored in liveContent.
  const activeProviderValue = useMemo(() => {
    if (liveContent === null) return selectedProvider?.other_fields
    const extracted = extractFromLiveContent(
      liveContent,
      summary?.providers,
      selectedProviderId,
      selectedModelId,
      'provider',
    )
    return extracted ?? selectedProvider?.other_fields
  }, [liveContent, selectedProvider, selectedProviderId, selectedModelId, summary])
  const activeModelValue = useMemo(() => {
    if (liveContent === null) return selectedModel?.config
    const extracted = extractFromLiveContent(
      liveContent,
      summary?.providers,
      selectedProviderId,
      selectedModelId,
      'model',
    )
    return extracted ?? selectedModel?.config
  }, [liveContent, selectedModel, selectedProviderId, selectedModelId, summary])

  // activeValueForModel reads the active value for the given model id — used
  // to render the merged provider + all models preview on the right side.
  function activeValueForModel(mid: string): unknown {
    if (!selectedProvider) return {}
    const m = selectedProvider.models.find((x) => x.id === mid)
    if (liveContent === null) return m?.config
    const extracted = extractFromLiveContent(
      liveContent,
      summary?.providers,
      selectedProviderId,
      mid,
      'model',
    )
    return extracted ?? m?.config
  }

  // rawProviderBaseline: 原始文件里选定 provider 的完整块（含 models），
  // 作为 diff 对比基准。
  const rawProviderBaseline = useMemo(() => {
    if (!selectedProvider || !summary) return null
    try {
      const parsed = JSON.parse(rawContent ?? '') as Record<string, unknown>
      const provPath = summary?.json_paths?.provider ?? 'provider'
      const root = (parsed as Record<string, unknown>)[provPath]
      if (root && typeof root === 'object') {
        return (root as Record<string, unknown>)[selectedProvider.provider_id] ?? null
      }
    } catch {
      // fall through to summary
    }
    return selectedProvider.other_fields ? {
      ...selectedProvider.other_fields,
      models: Object.fromEntries(selectedProvider.models.map((m) => [m.id, m.config ?? {}])),
    } : null
  }, [selectedProvider, rawContent, summary])

  // currentEditBaseline: liveContent 里该 provider 的当前块；无 liveContent
  // 时等于原始基线（此时无差异）。
  const currentEditBaseline = useMemo(() => {
    if (!selectedProvider) return null
    if (liveContent === null) return rawProviderBaseline
    const extracted = extractFromLiveContent(
      liveContent,
      summary?.providers,
      selectedProviderId,
      null,
      'provider',
    ) as Record<string, unknown> | null
    if (extracted) {
      return {
        ...extracted,
        models: Object.fromEntries(
          selectedProvider.models.map((m) => [m.id, activeValueForModel(m.id)]),
        ),
      }
    }
    return rawProviderBaseline
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, liveContent, rawProviderBaseline, summary, selectedProviderId])

  // currentEditableProviderValue: JsonEditor 显示的文本（provider 块 + models）。
  const currentEditableProviderValue = useMemo(() => {
    const v = currentEditBaseline ?? {}
    return JSON.stringify(v, null, 2)
  }, [currentEditBaseline])

  const providerDiff = useMemo(
    () => computeDiff(activeProviderValue, effectiveProviderRecs),
    [activeProviderValue, effectiveProviderRecs],
  )
  const modelDiff = useMemo(
    () => computeDiff(activeModelValue, effectiveModelRecs),
    [activeModelValue, effectiveModelRecs],
  )

  const liveDiffCount = useMemo(() => {
    if (liveContent === null) return 0
    return providerDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length +
      modelDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length
  }, [liveContent, providerDiff, modelDiff])

  const handleSavePending = async () => {
    if (!record || liveContent === null) return
    setSaving(true)
    try {
      // 每次保存都把 JSON 重新格式化（2 空格缩进），避免编辑/合并后出现
      // 排版混乱；解析失败则原样提交。
      let pretty = liveContent
      try {
        pretty = JSON.stringify(JSON.parse(liveContent), null, 2)
      } catch {
        // keep as-is
      }
      await dashboardApi.saveAgentConfigFileContent(record.id, pretty)
      toast('已保存预览中的变更')
      setLiveContent(null)
      setTemplateTally(new Map()); setTemplateApplied(0)
      reload()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelPending = () => {
    setLiveContent(null)
    setTemplateTally(new Map()); setTemplateApplied(0)
    setConfirmingCancel(false)
  }

  const tryClose = () => {
    if (liveContent !== null) {
      setConfirmingCancel(true)
      return
    }
    onOpenChange(false)
  }

  const handleSelectProvider = (id: string) => {
    setSelectedManaged(null)
    setSelectedProviderId(id)
    const provider = summary?.providers.find((p) => p.provider_id === id)
    setSelectedModelId(provider?.models[0]?.id ?? null)
  }

  // Rename/delete of a regular (file-driven) provider stage changes into
  // liveContent so the top 保存 bar saves them together.
  const handleRenameProvider = (oldId: string, newId: string) => {
    const target = newId.trim()
    if (!target || target === oldId) return
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      setLiveContent(renameProviderInContent(base, oldId, target, summary))
      toast('已生成预览：provider 改名待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改名失败')
    }
  }

  const handleDeleteProvider = (id: string) => {
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      setLiveContent(deleteProviderFromContent(base, id, summary))
      toast('已生成预览：删除 provider 待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const toggleManagedExpand = (id: string) => {
    setExpandedManaged((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectManaged = (mid: string, endpoint: string) => {
    setSelectedProviderId(null)
    setSelectedModelId(null)
    setSelectedManagedModelId(null)
    setSelectedManaged({ mid, endpoint })
  }

  // 同步所有待同步的托管供应商（顺序执行，失败即中断提示）。
  const handleSyncAllManaged = async () => {
    if (!record) return
    const pending = managed.filter((m) => m.pending_sync)
    if (pending.length === 0) {
      toast('没有需要同步的托管供应商')
      return
    }
    setSyncingAllManaged(true)
    try {
      let total = 0
      for (const view of pending) {
        const res = await dashboardApi.syncManagedProvider(record.id, view.id)
        total += res.synced
      }
      toast(`已同步全部 ${pending.length} 个托管供应商，共 ${total} 处字段写入配置文件`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncingAllManaged(false)
    }
  }

  const handleDeleteManaged = async (view: ManagedProviderView) => {
    if (!record) return
    try {
      await dashboardApi.deleteManagedProvider(record.id, view.id)
      toast('已删除托管 provider')
      setConfirmingDeleteManaged(null)
      setManagedDialogOpen(false)
      setSelectedManaged(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  // 使用推荐模板：对页面上所有非托管供应商 + 其模型批量生成预览，
  // 记录每供应商 / 每模型改动数（绿色提示），右上角出现保存。
  const handleApplyTemplate = async () => {
    if (!record) return
    setConfirmingTemplate(false)
    setApplying(true)
    try {
      const res = await dashboardApi.applyRecommendationTemplate(record.id)
      const tally = new Map<string, { count: number; models: Readonly<Record<string, number>> }>()
      for (const p of res.providers) {
        tally.set(p.provider_id, { count: p.count, models: p.models ?? {} })
      }
      setTemplateTally(tally)
      setTemplateApplied(res.applied)
      setLiveContent(res.content)
      // 二次确认后立即生效：直接写盘并关闭。
      await persistContent(res.content)
      toast(`已应用推荐模板：${res.applied} 处变更已写入文件`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '套用失败')
    } finally {
      setApplying(false)
    }
  }

  // persistContent writes content to disk directly (shared by the
  // 使用推荐模板 / 同步模型基本信息 confirm flows).
  const persistContent = async (content: string) => {
    if (!record) return
    let pretty = content
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // keep as-is
    }
    await dashboardApi.saveAgentConfigFileContent(record.id, pretty)
    setLiveContent(null)
    setTemplateTally(new Map()); setTemplateApplied(0)
    reload()
  }

  // Model rename / delete (both route through liveContent for the
  // preview-save flow).
  const handleRenameModel = (providerId: string, oldId: string, newId: string) => {
    const target = newId.trim()
    if (!target || target === oldId) return
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      setLiveContent(renameModelInContent(base, providerId, oldId, target))
      toast('已生成预览：模型改名待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改名失败')
    }
  }

  const handleDeleteModel = (providerId: string, modelId: string) => {
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      setLiveContent(deleteModelFromContent(base, providerId, modelId))
      toast('已生成预览：删除模型待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="md"
        height="auto"
        minHeight="640px"
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col !gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>管理模型 · {record?.record_name ?? ''}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {record?.agent_type ?? ''} · {record?.path ?? ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!summary || !record}
              onClick={() => setSyncingFromInfo(true)}
              title="选择参考供应商，按官方推荐配置对勾选的供应商与模型套用推荐配置"
            >
              <AppIcon name="auto_fix_high" size={14} data-icon="inline-start" />
              使用推荐配置
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={tryClose}>
              <AppIcon name="close" size={16} />
            </Button>
          </div>
        </DialogHeader>

        {liveContent !== null && (
          <PreviewBanner applied={templateTally.size > 0 ? templateApplied : liveDiffCount} />
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[200px_220px_minmax(300px,1fr)] divide-x divide-border">
          {/* Left: 非托管供应商 (adaptive) + 托管供应商 module */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader>供应商</ColumnHeader>
            {/* 非托管供应商区域：高度至少 3 行，超出内部滚动 */}
            <div className="max-h-[40%] flex-1 overflow-y-auto p-0">
              {loading && <Placeholder>加载中…</Placeholder>}
              {error && <Placeholder tone="error">{error}</Placeholder>}
              {!loading && !error && summary && summary.providers.length === 0 && (
                <Placeholder>未解析到任何 provider</Placeholder>
              )}
              {normalProviders.map((p) => {
                const tally = templateTally.get(p.provider_id)
                return (
                  <ProviderRow
                    key={p.provider_id}
                    name={p.provider_id}
                    info={
                      tally && tally.count > 0
                        ? { text: `${tally.count} 处修改`, green: true }
                        : { text: `${p.models.length} 模型`, green: false }
                    }
                    selected={selectedProviderId === p.provider_id}
                    onClick={() => handleSelectProvider(p.provider_id)}
                    actions={
                      <RowMenu
                        items={[
                          { key: 'rename', label: '修改名字', icon: 'edit' },
                          { key: 'delete', label: '删除', icon: 'delete', destructive: true },
                        ]}
                        onSelect={(k) => {
                          if (k === 'rename') setRenamingProvider(p.provider_id)
                          else setConfirmingDeleteProvider(p.provider_id)
                        }}
                      />
                    }
                  />
                )
              })}
            </div>

            <div className="h-px shrink-0 bg-border" />

            {/* 托管供应商 module */}
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">托管供应商</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={syncingAllManaged}
                  title="把待同步的托管供应商全部写入配置文件"
                  onClick={() => void handleSyncAllManaged()}
                >
                  <AppIcon name="auto_fix_high" size={14} />
                  同步所有
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  title="把我们系统里录入的供应商按 endpoint 分组后生成托管 provider"
                  onClick={() => {
                    setManagedEditing(null)
                    setManagedDialogOpen(true)
                  }}
                >
                  <AppIcon name="add" size={14} />
                </Button>
              </div>
            </div>
            <div className="shrink-0 overflow-y-auto p-0">
              {managed.length === 0 && (
                <Placeholder>暂无托管供应商</Placeholder>
              )}
              {managed.map((mv) => {
                const expandable = mv.groups.length > 1
                const expanded = expandedManaged.has(mv.id)
                return (
                  <div key={mv.id}>
                    {expandable ? (
                      <>
                        <ProviderRow
                          name={<span className="truncate font-medium">{mv.name}</span>}
                          info={{ text: `${mv.groups.length} 分组`, green: false }}
                          badge={mv.pending_sync ? (
                            <span className="shrink-0 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium text-warning">待同步</span>
                          ) : null}
                          selected={selectedManaged?.mid === mv.id}
                          onClick={() => {
                            toggleManagedExpand(mv.id)
                            // 点击一级行同时选中，让操作按钮在触屏设备上常显
                            handleSelectManaged(mv.id, mv.groups[0]?.endpoint ?? '')
                          }}
                          actions={
                            <>
                              <IconHoverButton
                                title="设置"
                                icon="settings"
                                tone="default"
                                disabled={false}
                                onClick={() => {
                                  setManagedEditing(mv)
                                  setManagedDialogOpen(true)
                                }}
                              />
                            </>
                          }
                          leading={
                            <AppIcon
                              name="chevron_right"
                              size={12}
                              className={'shrink-0 text-muted-foreground transition-transform ' + (expanded ? 'rotate-90' : '')}
                            />
                          }
                        />
                        {expanded && (
                          <div className="space-y-0.5 rounded-md bg-muted/60">
                            {mv.groups.map((g) => (
                              <ProviderRow
                                key={g.endpoint}
                                indent
                                name={mv.name + g.suffix}
                                info={{ text: `${g.model_count} 模型`, green: false }}
                                selected={
                                  selectedManaged?.mid === mv.id && selectedManaged?.endpoint === g.endpoint
                                }
                                onClick={() => handleSelectManaged(mv.id, g.endpoint)}
                                actions={null}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      // Single group: rendered as a direct row.
                      mv.groups.map((g) => (
                        <ProviderRow
                          key={g.endpoint}
                          name={<span className="truncate font-medium">{mv.name + g.suffix}</span>}
                          info={{ text: `${g.model_count} 模型`, green: false }}
                          badge={mv.pending_sync ? (
                            <span className="shrink-0 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium text-warning">待同步</span>
                          ) : null}
                          selected={
                            selectedManaged?.mid === mv.id && selectedManaged?.endpoint === g.endpoint
                          }
                          onClick={() => handleSelectManaged(mv.id, g.endpoint)}
                          actions={
                            <>
                              <IconHoverButton
                                title="设置"
                                icon="settings"
                                tone="default"
                                disabled={false}
                                onClick={() => {
                                  setManagedEditing(mv)
                                  setManagedDialogOpen(true)
                                }}
                              />
                            </>
                          }
                        />
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Middle: models list only */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader>模型列表</ColumnHeader>
            <div className="flex-1 overflow-y-auto p-0">
              {selectedManagedGroup ? (
                <>
                  {selectedManagedGroup.group.model_names.length === 0 && (
                    <Placeholder>该分组没有可同步的模型</Placeholder>
                  )}
                  {selectedManagedGroup.group.model_names.map((mid) => (
                    <ModelRow
                      key={mid}
                      name={mid}
                      info={null}
                      selected={selectedManagedModelId === mid}
                      onClick={() => setSelectedManagedModelId(mid)}
                      actions={null}
                    />
                  ))}
                </>
              ) : selectedProvider && selectedProvider.models.length === 0 ? (
                <Placeholder>该供应商下没有模型</Placeholder>
              ) : (
                selectedProvider?.models.map((m) => {
                  const tally = templateTally.get(selectedProviderId ?? '')
                  const modelCount = tally?.models?.[m.id] ?? 0
                  return (
                    <ModelRow
                      key={m.id}
                      name={m.id}
                      info={modelCount > 0 ? { text: `${modelCount} 处修改`, green: true } : null}
                      selected={selectedModelId === m.id}
                      onClick={() => setSelectedModelId(m.id)}
                      actions={
                        <RowMenu
                          items={[
                            { key: 'rename', label: '修改名字', icon: 'edit' },
                            { key: 'delete', label: '删除', icon: 'delete', destructive: true },
                          ]}
                          onSelect={(k) => {
                            if (!selectedProviderId) return
                            if (k === 'rename') setRenamingModel({ providerId: selectedProviderId, modelId: m.id })
                            else setConfirmingDeleteModel({ providerId: selectedProviderId, modelId: m.id })
                          }}
                        />
                      }
                    />
                  )
                })
              )}
            </div>
          </div>

          {/* Right: editable JSON + inline diff vs 原始文件. Clicking a model on
              the left scrolls to that model's segment. */}
        <div className="flex min-h-0 flex-col">
            <ColumnHeader>供应商 + 模型 配置（可直接编辑，实时对比下方差异）</ColumnHeader>
            <div className="max-h-[55%] overflow-auto border-b border-border p-0">
              {selectedManagedGroup ? (
                <DiffView
                  before={selectedManagedGroup.group.generated}
                  after={selectedManagedGroup.group.generated}
                />
              ) : selectedProvider ? (
                <JsonEditor
                  value={currentEditableProviderValue}
                  onChange={(text) => setLiveContent(wrapRootScope('provider', text, summary, selectedProviderId, selectedModelId, rawContent))}
                />
              ) : (
                <Placeholder>未选择供应商</Placeholder>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                与原始文件的差异
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-0">
                {selectedProvider ? (
                  <DiffView before={rawProviderBaseline} after={currentEditBaseline} />
                ) : (
                  <Placeholder>未选择供应商</Placeholder>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-4 py-3">
          <div className="flex flex-1 items-center">
            {liveContent !== null && (
              <span className="text-xs text-warning">
                已修改 {templateTally.size > 0 ? templateApplied : liveDiffCount} 项
              </span>
            )}
          </div>
          <Button variant="outline" onClick={tryClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="default"
            disabled={liveContent === null || saving}
            onClick={() => void handleSavePending()}
          >
            {saving ? <AppIcon name="progress_activity" size={14} className="animate-spin" /> : '保存'}
          </Button>
        </DialogFooter>

        <AgentModelInfoMatchDialog
          open={syncingFromInfo}
          onOpenChange={setSyncingFromInfo}
          record={record}
          providers={summary?.providers ?? []}
          modelInfoFields={summary?.model_info_fields ?? {
            max_context: '',
            max_output_token: '',
            input_types: '',
            thinking_levels: '',
          }}
          recommendations={summary?.recommendations ?? []}
          protocols={summary?.protocols ?? []}
          onPreview={({ content, applied }) => {
            setLiveContent(content)
            toast(`已应用推荐配置：${applied} 处变更待保存`)
          }}
        />

        <ConfirmDiscardDialog
          open={confirmingCancel}
          saving={saving}
          onCancel={() => setConfirmingCancel(false)}
          onDiscard={() => {
            handleCancelPending()
            onOpenChange(false)
          }}
          onSave={() => void handleSavePending().then(() => onOpenChange(false))}
        />
      {/* Managed provider add/edit dialog (also carries the delete action) */}
        <ManagedProviderDialog
          open={managedDialogOpen}
          onOpenChange={setManagedDialogOpen}
          record={record}
          editing={managedEditing}
          onSaved={() => reload()}
        />

        {/* Rename provider dialog (regular providers) */}
        <RenameProviderDialog
          open={renamingProvider !== null}
          currentName={renamingProvider ?? ''}
          onOpenChange={(open) => {
            if (!open) setRenamingProvider(null)
          }}
          onConfirm={(newName) => {
            if (renamingProvider) handleRenameProvider(renamingProvider, newName)
            setRenamingProvider(null)
          }}
        />

        {/* Delete regular provider confirm */}
        <ConfirmDeleteDialog
          open={confirmingDeleteProvider !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmingDeleteProvider(null)
          }}
          title="删除 provider"
          description={`确认删除配置文件中的 provider「${confirmingDeleteProvider ?? ''}」？删除会随预览一起提交，点底部「保存」后生效。`}
          onConfirm={() => {
            if (confirmingDeleteProvider) handleDeleteProvider(confirmingDeleteProvider)
            setConfirmingDeleteProvider(null)
          }}
        />

                {/* Delete managed provider confirm */}
        <ConfirmDeleteDialog
          open={confirmingDeleteManaged !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmingDeleteManaged(null)
          }}
          title="删除托管 provider"
          description={`确认删除托管 provider「${confirmingDeleteManaged?.name ?? ''}」？删除会立即生效。`}
          onConfirm={() => confirmingDeleteManaged && void handleDeleteManaged(confirmingDeleteManaged)}
        />

        {/* 使用推荐模板 confirm */}
        <Dialog open={confirmingTemplate} onOpenChange={setConfirmingTemplate}>
          <DialogContent width="sm">
            <DialogHeader>
              <DialogTitle>使用推荐模板</DialogTitle>
            </DialogHeader>
            <p className="px-4 text-xs text-muted-foreground">
              将根据 AI 软件官方的配置文档，对页面中全部供应商（托管供应商除外）
              及其模型的字段进行调整，并把结果直接写入文件生效。确认？
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingTemplate(false)} disabled={applying}>取消</Button>
              <Button onClick={() => void handleApplyTemplate()} disabled={applying}>
                {applying ? '应用中...' : '确认并生效'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename model dialog */}
        <RenameProviderDialog
          open={renamingModel !== null}
          currentName={renamingModel?.modelId ?? ''}
          onOpenChange={(open) => {
            if (!open) setRenamingModel(null)
          }}
          title="修改模型名称"
          onConfirm={(newName) => {
            if (renamingModel) handleRenameModel(renamingModel.providerId, renamingModel.modelId, newName)
            setRenamingModel(null)
          }}
        />

        {/* Delete model confirm */}
        <ConfirmDeleteDialog
          open={confirmingDeleteModel !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmingDeleteModel(null)
          }}
          title="删除模型"
          description={`确认删除配置文件中的模型「${confirmingDeleteModel?.modelId ?? ''}」？删除会随预览一起提交，点底部「保存」后生效。`}
          onConfirm={() => {
            if (confirmingDeleteModel) handleDeleteModel(confirmingDeleteModel.providerId, confirmingDeleteModel.modelId)
            setConfirmingDeleteModel(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function RenameProviderDialog({
  open,
  currentName,
  onOpenChange,
  onConfirm,
  title = '修改 provider 名称',
}: {
  open: boolean
  currentName: string
  onOpenChange: (open: boolean) => void
  onConfirm: (newName: string) => void
  title?: string
}) {
  const [value, setValue] = useState(currentName)
  useEffect(() => {
    if (open) setValue(currentName)
  }, [open, currentName])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim() && value.trim() !== currentName) {
                onConfirm(value.trim())
              }
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            修改会作为预览的一部分，点右上角「保存」后才会写入配置文件。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            disabled={!value.trim() || value.trim() === currentName}
            onClick={() => onConfirm(value.trim())}
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ProviderRow is a single sidebar row with a leading slot, label and a
// trailing actions slot rendered on hover.
type RowInfo = string | { text: string; green: boolean } | null

function ProviderRow({
  name,
  info,
  badge,
  indent,
  selected,
  onClick,
  actions,
  leading,
}: {
  name: React.ReactNode
  info: RowInfo
  badge?: React.ReactNode
  /** 子级行：缩进加在内容上而非行本身，保证选中背景整行拉通。 */
  indent?: boolean
  selected: boolean
  onClick: () => void
  actions: React.ReactNode | null
  leading?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={
        'group flex w-full cursor-pointer items-center gap-1 rounded-none px-2 py-2 text-left transition-colors ' +
        (selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted')
      }
    >
      {leading}
      <div className={'flex min-w-0 flex-1 flex-col gap-0.5 text-left ' + (indent ? 'pl-3' : '')}>
        <span className="flex min-w-0 items-center truncate text-sm font-medium">{name}</span>
        {(info || badge) && (
          <span
            className={
              'flex min-w-0 items-center gap-1 text-[11px] ' +
              (typeof info === 'object' && info.green ? 'text-success' : 'text-muted-foreground')
            }
          >
            {badge}
            <span className="truncate">
              {typeof info === 'object' ? info.text : info}
            </span>
          </span>
        )}
      </div>
      {actions && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={
            'flex shrink-0 items-center gap-0.5 transition-opacity ' +
            (selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
        >
          {actions}
        </div>
      )}
    </div>
  )
}

// ModelRow mirrors ProviderRow's two-line height + vertical centering so
// model rows look identical to provider rows.
function ModelRow({
  name,
  info,
  selected,
  onClick,
  actions,
}: {
  name: React.ReactNode
  info: RowInfo
  selected: boolean
  onClick: () => void
  actions: React.ReactNode | null
}) {
  return (
    <div
      className={
        'group flex min-h-[48px] w-full items-center gap-1 rounded-none px-2 py-2 text-left transition-colors ' +
        (selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted')
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 text-left"
      >
        {info ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
              <AppIcon name="layers" size={12} className="shrink-0 text-muted-foreground" />
              {name}
            </span>
            <span
              className={
                'truncate text-[11px] ' +
                (typeof info === 'object' && info.green ? 'text-success' : 'text-muted-foreground')
              }
            >
              {typeof info === 'object' ? info.text : info}
            </span>
          </span>
        ) : (
          <span className="flex min-h-8 min-w-0 items-center gap-2 truncate text-sm font-medium">
            <AppIcon name="layers" size={12} className="shrink-0 text-muted-foreground" />
            {name}
          </span>
        )}
      </button>
      {actions && (
        <div
          className={
            'flex shrink-0 items-center gap-0.5 transition-opacity ' +
            (selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
        >
          {actions}
        </div>
      )}
    </div>
  )
}

// RowMenu renders the single three-dot trigger with a small dropdown
// (修改名字 / 删除 …). Visible on hover or when the row is selected
// (the parent row handles opacity; trigger itself is always rendered).
function RowMenu({
  items,
  onSelect,
}: {
  items: readonly { key: string; label: string; icon: string; destructive?: boolean }[]
  onSelect: (key: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5 text-muted-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <AppIcon name="more_horiz" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {items.map((it) => (
          <DropdownMenuItem
            key={it.key}
            variant={it.destructive ? 'destructive' : 'default'}
            onSelect={() => onSelect(it.key)}
          >
            <AppIcon name={it.icon} size={12} />
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function IconHoverButton({
  title,
  icon,
  tone,
  disabled,
  onClick,
}: {
  title: string
  icon: string
  tone: 'default' | 'destructive' | 'success'
  disabled: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === 'destructive'
      ? 'text-muted-foreground hover:text-destructive'
      : tone === 'success'
        ? 'text-muted-foreground hover:text-success'
        : 'text-muted-foreground hover:text-primary'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={title}
      disabled={disabled}
      className={'h-5 w-5 ' + toneClass}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <AppIcon name={icon} size={11} />
    </Button>
  )
}

function computeDiff(
  value: unknown,
  recs: readonly AgentRecommendation[],
): readonly DiffMarker[] {
  const out: DiffMarker[] = []
  const recByKey = new Map(recs.map((r) => [r.key, r]))
  const visited = new Set<string>()

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      const rec = recByKey.get(key)
      if (rec) {
        visited.add(key)
        out.push(evaluateMarker(key, (value as Record<string, unknown>)[key], rec))
      }
    }
  }

  // Recommendations for keys that aren't present.
  for (const rec of recs) {
    if (visited.has(rec.key)) continue
    out.push({
      path: rec.key,
      status: 'missing',
      recommended: rec.recommended,
      actual: undefined,
    })
  }
  return out
}

function evaluateMarker(key: string, actual: unknown, rec: AgentRecommendation): DiffMarker {
  if (rec.recommended === null || rec.recommended === undefined) {
    return { path: key, status: 'no-recommendation', recommended: null, actual }
  }
  if (deepEqual(rec.recommended, actual)) {
    return { path: key, status: 'ok', recommended: rec.recommended, actual }
  }
  return { path: key, status: 'mismatch', recommended: rec.recommended, actual }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    for (const k of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}

// extractFromLiveContent pulls the provider's other_fields or the
// model's config out of the liveContent JSON string. It mirrors the
// backend's path walk so the diff view stays in sync with the working
// copy. For the provider scope we strip the `models` subtree so the
// diff display only shows the actual recommendation fields.
function extractFromLiveContent(
  content: string,
  _providers: readonly AgentModelProvider[] | undefined,
  providerId: string | null,
  modelId: string | null,
  scope: 'provider' | 'model',
): unknown {
  if (!providerId) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
  const providerObj = readPath(parsed, ['models', 'providers', providerId])
    ?? readPath(parsed, ['provider', providerId])
  if (!providerObj || typeof providerObj !== 'object') return null
  if (scope === 'model') {
    if (!modelId) return null
    const models = readPath(providerObj as Record<string, unknown>, ['models'])
    if (!models || typeof models !== 'object') return null
    return (models as Record<string, unknown>)[modelId] ?? null
  }
  const copy: Record<string, unknown> = { ...(providerObj as Record<string, unknown>) }
  delete copy.models
  return copy
}

function readPath(obj: Record<string, unknown>, segments: readonly string[]): unknown {
  let cur: unknown = obj
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

// protocolMatchesConditions reports whether any OR-branch of a protocol
// matches the provider's config fields (provider-level gjson paths).
function protocolMatchesConditions(
  providerFields: unknown,
  protocol: AgentProtocol,
): boolean {
  if (!protocol.conditions || protocol.conditions.length === 0) return false
  if (!providerFields || typeof providerFields !== 'object') return false
  for (const cond of protocol.conditions) {
    const field = cond.field.trim()
    if (!field) continue
    const val = readPath(providerFields as Record<string, unknown>, field.split('.'))
    const actual = val === null || val === undefined ? '' : String(val)
    const want = cond.value.trim()
    switch (cond.op) {
      case 'equals':
        if (actual === want) return true
        break
      case 'not_equals':
        if (actual !== want) return true
        break
      case 'contains':
        if (actual.includes(want)) return true
        break
      case 'not_contains':
        if (!actual.includes(want)) return true
        break
    }
  }
  return false
}

// providerRootOfContent detects whether the config file keeps providers
// under "provider" (opencode) or "models.providers" (openclaw) and
// returns the segments to the provider map plus the leaf path to write.
function providerRootOfContent(parsed: Record<string, unknown>): readonly string[] | null {
  if (parsed.provider && typeof parsed.provider === 'object') return ['provider']
  if (parsed.models && typeof parsed.models === 'object') {
    const models = parsed.models as Record<string, unknown>
    if (models.providers && typeof models.providers === 'object') return ['models', 'providers']
  }
  return null
}

// renameProviderInContent re-keys a provider within the live content,
// preserving the provider object verbatim under the new id.
function renameProviderInContent(
  content: string,
  oldId: string,
  newId: string,
  summary: AgentModelSummary | null,
): string {
  void summary
  const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
  const root = providerRootOfContent(parsed)
  if (!root) throw new Error('无法识别配置文件里的 provider 根路径')
  let cur: Record<string, unknown> = parsed
  for (const seg of root) {
    const next = cur[seg]
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`provider 根路径 ${seg} 无效`)
    cur = next as Record<string, unknown>
  }
  const map = cur as Record<string, unknown>
  if (!(oldId in map)) throw new Error(`provider ${oldId} 不存在`)
  if (newId in map) throw new Error(`provider ${newId} 已存在`)
  map[newId] = map[oldId]
  delete map[oldId]
  return JSON.stringify(parsed)
}

// deleteProviderFromContent removes a provider key from the live content.
function deleteProviderFromContent(
  content: string,
  id: string,
  summary: AgentModelSummary | null,
): string {
  void summary
  const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
  const root = providerRootOfContent(parsed)
  if (!root) throw new Error('无法识别配置文件里的 provider 根路径')
  let cur: Record<string, unknown> = parsed
  for (const seg of root) {
    const next = cur[seg]
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`provider 根路径 ${seg} 无效`)
    cur = next as Record<string, unknown>
  }
  const map = cur as Record<string, unknown>
  if (!(id in map)) throw new Error(`provider ${id} 不存在`)
  delete map[id]
  return JSON.stringify(parsed)
}

// findModelsContainer returns the provider's models container, supporting
// both the object-map shape ({modelId: cfg}) and the array shape
// ([{id, ...}]). Returns the provider object (for mutation) + how to
// interpret it.
function modelsContainerOf(
  parsed: Record<string, unknown>,
  providerId: string,
): { container: unknown; provider: Record<string, unknown> } {
  const root = providerRootOfContent(parsed)
  if (!root) throw new Error('无法识别配置文件里的 provider 根路径')
  let cur: Record<string, unknown> = parsed
  for (const seg of root) {
    const next = cur[seg]
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`provider 根路径 ${seg} 无效`)
    cur = next as Record<string, unknown>
  }
  const provider = cur[providerId] as Record<string, unknown> | undefined
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error(`provider ${providerId} 不存在`)
  }
  const models = provider.models
  if (models === undefined || models === null) throw new Error(`provider ${providerId} 下没有 models`)
  return { container: models, provider }
}

// renameModelInContent re-keys a model inside its provider's models. For
// the object-map shape the key is renamed; for the array shape the id / 
// name field is updated in place.
function renameModelInContent(content: string, providerId: string, oldId: string, newId: string): string {
  const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
  const { container } = modelsContainerOf(parsed, providerId)
  if (Array.isArray(container)) {
    const target = container.find((m) => {
      const mr = m as Record<string, unknown>
      return mr.id === oldId || mr.name === oldId
    }) as Record<string, unknown> | undefined
    if (!target) throw new Error(`模型 ${oldId} 不存在`)
    if (target.id === oldId) target.id = newId
    else if (target.name === oldId) target.name = newId
    return JSON.stringify(parsed)
  }
  const map = container as Record<string, unknown>
  if (!(oldId in map)) throw new Error(`模型 ${oldId} 不存在`)
  if (newId in map) throw new Error(`模型 ${newId} 已存在`)
  map[newId] = map[oldId]
  delete map[oldId]
  return JSON.stringify(parsed)
}

// deleteModelFromContent removes a model from its provider's models
// (object key or array element).
function deleteModelFromContent(content: string, providerId: string, modelId: string): string {
  const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
  const { container } = modelsContainerOf(parsed, providerId)
  if (Array.isArray(container)) {
    const idx = container.findIndex((m) => {
      const mr = m as Record<string, unknown>
      return mr.id === modelId || mr.name === modelId
    })
    if (idx < 0) throw new Error(`模型 ${modelId} 不存在`)
    container.splice(idx, 1)
    return JSON.stringify(parsed)
  }
  const map = container as Record<string, unknown>
  if (!(modelId in map)) throw new Error(`模型 ${modelId} 不存在`)
  delete map[modelId]
  return JSON.stringify(parsed)
}

// parseWorkingProviderList derives the current provider list from a
// staged liveContent document (after delete/rename previews), preserving
// model ids/config from liveContent where present and filling gaps from
// the summary. Returns null when the live content can't be parsed.
function parseWorkingProviderList(
  content: string,
  summary: AgentModelSummary | null,
): readonly AgentModelProvider[] | null {
  try {
  const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
    const root = providerRootOfContent(parsed)
    if (!root) return null
    let container: Record<string, unknown> = parsed
    for (const seg of root) {
      const next = container[seg]
      if (!next || typeof next !== 'object' || Array.isArray(next)) return null
      container = next as Record<string, unknown>
    }
    const byId = new Map((summary?.providers ?? []).map((p) => [p.provider_id, p]))
    const modelLeaf = lastPathSegment((summary?.json_paths?.model ?? 'models') || 'models')
    const out: AgentModelProvider[] = []
    for (const id of Object.keys(container)) {
      const prov = container[id] as Record<string, unknown>
      const modelsRaw = prov?.[modelLeaf]
      const models: { id: string; config: unknown }[] = []
      if (Array.isArray(modelsRaw)) {
        modelsRaw.forEach((m, i) => {
          const mr = m as Record<string, unknown>
          const mid = typeof mr.id === 'string' ? mr.id : typeof mr.name === 'string' ? String(mr.name) : String(i)
          models.push({ id: mid, config: m })
        })
      } else if (modelsRaw && typeof modelsRaw === 'object') {
        for (const mid of Object.keys(modelsRaw as Record<string, unknown>)) {
          models.push({ id: mid, config: (modelsRaw as Record<string, unknown>)[mid] })
        }
      }
      const prev = byId.get(id)
      const merged: AgentModelProvider = {
        provider_id: id,
        other_fields: prev?.other_fields ?? null,
        models: models.length > 0 ? models : (prev?.models ?? []),
      }
      out.push(merged)
    }
    return out
  } catch {
    return null
  }
}

// lastPathSegment returns the trailing key of a dotted path so the
// caller can locate the models container leaf ("provider.{id}.models").
function lastPathSegment(path: string): string {
  if (!path) return 'models'
  const i = path.lastIndexOf('.')
  return i >= 0 ? path.slice(i + 1) : path
}

// wrapRootScope rebuilds a full file content string from summary +
// the edited scope value, so we always have a complete document in
// liveContent (the save endpoint writes the whole file in one go).
// Falls back to the previously-staged liveContent when scope/ids are
// not yet resolved.
function wrapRootScope(
  scope: 'provider' | 'model',
  edited: string,
  summary: AgentModelSummary | null,
  providerId: string | null,
  modelId: string | null,
  rawContent?: string | null,
): string {
  if (!summary || !providerId) return edited
  const root = currentActualContent(summary, rawContent) as Record<string, unknown>
  const providerMapContainer =
    root.models && typeof root.models === 'object'
      ? ((root.models as Record<string, unknown>).providers ?? {}) as Record<string, unknown>
      : (root.provider ?? {}) as Record<string, unknown>
  const provider = (providerMapContainer[providerId] ?? {}) as Record<string, unknown>
  let parsed: unknown
  try {
    parsed = JSON.parse(edited)
  } catch {
    parsed = edited
  }
  if (scope === 'provider') {
    const next = { ...(parsed as Record<string, unknown>) }
    next.models = provider.models
    providerMapContainer[providerId] = next
  } else if (scope === 'model' && modelId) {
    const next = { ...(parsed as Record<string, unknown>) }
    const models = { ...((provider.models ?? {}) as Record<string, unknown>) }
    models[modelId] = parsed
    next.models = models
    providerMapContainer[providerId] = next
  }
  return JSON.stringify(root)
}

// JsonEditor renders a monospace textarea pre-populated with the
// current JSON. Typing into it writes the user-edited value back to
// liveContent so the diff view recomputes against the new state.
// Errors parsing the typed text surface as a red border on the box
// without dropping the user's keystrokes.
function JsonEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (text: string) => void
}) {
  const initial = useMemo(() => {
    if (value === null || value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [value])
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  // When the upstream value changes (provider switch, recommendations
  // apply), reset the editor to the new current state.
  useEffect(() => {
    setText(initial)
    setError(null)
  }, [initial])
  return (
    <div className="flex h-full flex-col gap-1">
      <Textarea
        value={text}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          try {
            JSON.parse(v)
            setError(null)
            onChange(v)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'JSON 解析失败')
          }
        }}
        className={
          'min-h-[120px] flex-1 resize-none font-mono text-xs leading-relaxed ' +
          (error ? 'border-destructive focus-visible:ring-destructive' : '')
        }
        spellCheck={false}
      />
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  )
}

// currentActualContent rebuilds the live JSON from the loaded
// summary — used when the user has no liveContent yet but triggers a
// single-field apply, so we have a fresh base to mutate.
function currentActualContent(
  summary: AgentModelSummary | null,
  rawContent?: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  // Detect the real root shape from the raw file when available: opencode
  // puts providers under "provider", openclaw under "models.providers".
  // Building from the wrong shape corrupts openclaw's file on save.
  let rootKey: string = 'provider'
  if (rawContent && rawContent.trim() !== '') {
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>
      if (parsed.models && typeof parsed.models === 'object') {
        const models = parsed.models as Record<string, unknown>
        if (models.providers && typeof models.providers === 'object') {
          rootKey = 'models'
        }
      }
    } catch {
      // fall through to the default provider shape
    }
  }

  const providers: Record<string, unknown> = {}
  const summaryProviders = summary?.providers ?? []
  for (const p of summaryProviders) {
    const other = (p.other_fields ?? {}) as Record<string, unknown>
    const models: Record<string, unknown> = {}
    for (const m of p.models) {
      models[m.id] = (m.config ?? {}) as unknown
    }
    providers[p.provider_id] = { ...other, models }
  }

  if (rootKey === 'provider') {
    out.provider = providers
    return out
  }
  const modelsObj: Record<string, unknown> = {}
  modelsObj.providers = providers
  out.models = modelsObj
  return out
}

// stripJsoncComments removes // and /* */ comments so JSON.parse can
// read JSONC / JSON5 config files; string contents are untouched.
function stripJsoncComments(s: string): string {
  const out: string[] = []
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      out.push(c)
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out.push(c)
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i)
      if (end < 0) return out.join('')
      i = end
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      if (end < 0) return out.join('')
      i = end + 1
      continue
    }
    out.push(c)
  }
  return out.join('')
}

function PreviewBanner({ applied }: { applied: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2 text-warning">
        <AppIcon name="auto_fix_high" size={14} />
        <span>
          预览：当前编辑与文件实际值相比，共 <strong className="font-semibold">{applied}</strong> 处差异待保存
        </span>
      </div>
    </div>
  )
}

// ConfirmDiscardDialog pops when the user tries to close the dialog
// while preview changes are still pending. It forces the user to pick
// either to discard the preview or save it before the dialog closes.
function ConfirmDiscardDialog({
  open,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean
  saving: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[400px] rounded-none border border-border bg-popover p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium">当前操作未保存</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          关闭后将丢失当前预览中的所有变更。继续取消，还是先保存？
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            继续编辑
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            取消变更
          </Button>
          <Button variant="default" size="sm" onClick={onSave} disabled={saving}>
            {saving ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Placeholder({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <div
      className={
        'p-3 text-xs ' +
        (tone === 'error' ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  )
}