import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { JsonTokens } from '@/components/JsonHighlight'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
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
  // editingScope says which side's JSON box the user has flipped into
  // raw textarea mode (and wants to edit by hand). null means both
  // boxes show the diff recommendation view.
  const [editingScope, setEditingScope] = useState<'provider' | 'model' | null>(null)

  // Managed (托管) providers bound to this file + their selection state.
  const [managed, setManaged] = useState<readonly ManagedProviderView[]>([])
  // selectedManaged: { mid, endpoint } when viewing a managed group's
  // generated block (read-only), null otherwise.
  const [selectedManaged, setSelectedManaged] = useState<{ mid: string; endpoint: string } | null>(null)
  const [selectedManagedModelId, setSelectedManagedModelId] = useState<string | null>(null)
  const [expandedManaged, setExpandedManaged] = useState<Set<string>>(new Set())
  const [renamingProvider, setRenamingProvider] = useState<string | null>(null)
  const [confirmingDeleteProvider, setConfirmingDeleteProvider] = useState<string | null>(null)
  const [confirmingSync, setConfirmingSync] = useState<ManagedProviderView | null>(null)
  const [managedDialogOpen, setManagedDialogOpen] = useState(false)
  const [managedEditing, setManagedEditing] = useState<ManagedProviderView | null>(null)
  const [confirmingDeleteManaged, setConfirmingDeleteManaged] = useState<ManagedProviderView | null>(null)

  const reload = () => {
    if (!record) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetchModels(record.id),
      dashboardApi.listManagedProviders(record.id),
    ])
      .then(([res, managedRes]) => {
        setSummary(res)
        setManaged(managedRes)
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
    setLiveContent(null)
    setConfirmingCancel(false)
    reload()
  }, [open, record]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-select the first provider/model whenever summary arrives/changes.
  // Managed selection is entirely separate and never auto-selected.
  useEffect(() => {
    if (!summary) return
    if (selectedManaged) return
    if (selectedProviderId && summary.providers.some((p) => p.provider_id === selectedProviderId)) {
      const provider = summary.providers.find((p) => p.provider_id === selectedProviderId)!
      if (selectedModelId && provider.models.some((m) => m.id === selectedModelId)) return
      setSelectedModelId(provider.models[0]?.id ?? null)
      return
    }
    const first = summary.providers[0]
    setSelectedProviderId(first?.provider_id ?? null)
    setSelectedModelId(first?.models[0]?.id ?? null)
  }, [summary, selectedProviderId, selectedModelId, selectedManaged])

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
    if (!summary || !selectedProviderId) return null
    return summary.providers.find((p) => p.provider_id === selectedProviderId) ?? null
  }, [summary, selectedProviderId])

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
    // After any staging edit, every diff row that the recommendations
    // would still resolve against the active value counts as one
    // pending change. The view already marks each line individually.
    return providerDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length +
      modelDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length
  }, [liveContent, providerDiff, modelDiff])

  const problemCount =
    providerDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length +
    modelDiff.filter((d) => d.status === 'missing' || d.status === 'mismatch').length

  const handleApply = async (scope: 'provider' | 'model') => {
    if (!record || !selectedProviderId) return
    setApplying(true)
    try {
      const res = await dashboardApi.applyAgentRecommendations(record.id, {
        provider_id: selectedProviderId,
        ...(scope === 'model' && selectedModelId ? { model_id: selectedModelId } : {}),
      })
      // Preview only — stash the proposed content; do NOT touch the
      // file. The user reviews and clicks the bottom-right 保存 button.
      setLiveContent(res.content)
      toast(`已生成预览：${res.applied} 处变更待保存`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '套用失败')
    } finally {
      setApplying(false)
    }
  }

  // applyOneField is the client-side single-field apply used by the
  // "使用推荐值" hover button on each diff row. It mutates the working
  // copy in liveContent; nothing is written to disk until the user
  // hits 保存. Recomputing the diff afterwards naturally drops the
  // resolved row from the diff list.
  const applyOneField = (path: string, value: unknown) => {
    const base = liveContent ?? JSON.stringify(currentActualContent(summary), null, 2)
    try {
      setLiveContent(setJsonPath(base, path, value))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '应用失败')
    }
  }

  const handleSavePending = async () => {
    if (!record || liveContent === null) return
    setSaving(true)
    try {
      await dashboardApi.saveAgentConfigFileContent(record.id, liveContent)
      toast('已保存预览中的变更')
      setLiveContent(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelPending = () => {
    setLiveContent(null)
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
    const base = liveContent ?? JSON.stringify(currentActualContent(summary), null, 2)
    try {
      setLiveContent(renameProviderInContent(base, oldId, target, summary))
      toast('已生成预览：provider 改名待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改名失败')
    }
  }

  const handleDeleteProvider = (id: string) => {
    const base = liveContent ?? JSON.stringify(currentActualContent(summary), null, 2)
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

  const handleSyncManaged = async (view: ManagedProviderView) => {
    if (!record) return
    try {
      const res = await dashboardApi.syncManagedProvider(record.id, view.id)
      toast(`已同步：${res.synced} 处字段已写入配置文件`)
      setConfirmingSync(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败')
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="full"
        height="full"
        bare
        showCloseButton={false}
        className="flex flex-col !gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>管理模型 · {record?.record_name ?? ''}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {record?.agent_type ?? ''} · {record?.path ?? ''}
              {problemCount > 0 && (
                <span className="ml-2 text-destructive">· {problemCount} 处与推荐值不符</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={tryClose}>
              <AppIcon name="close" size={16} />
            </Button>
          </div>
        </DialogHeader>

        {liveContent !== null && (
          <PreviewBanner
            applied={liveDiffCount}
            saving={saving}
            onSave={() => void handleSavePending()}
            onCancel={handleCancelPending}
          />
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(320px,1fr)_minmax(360px,1.4fr)] divide-x divide-border">
          {/* Left: providers (regular + managed) */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader
              action={
                <Button
                  variant="outline"
                  size="xs"
                  title="把我们系统里录入的供应商按 endpoint 分组后生成托管 provider"
                  onClick={() => {
                    setManagedEditing(null)
                    setManagedDialogOpen(true)
                  }}
                >
                  <AppIcon name="add" size={12} data-icon="inline-start" />
                  添加托管provider
                </Button>
              }
            >
              供应商
            </ColumnHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {loading && <Placeholder>加载中…</Placeholder>}
              {error && <Placeholder tone="error">{error}</Placeholder>}
              {!loading && !error && summary && summary.providers.length === 0 && managed.length === 0 && (
                <Placeholder>未解析到任何 provider</Placeholder>
              )}

              {/* Regular providers (hover → 改名/删除) */}
              {summary?.providers.map((p) => (
                <ProviderRow
                  key={p.provider_id}
                  name={p.provider_id}
                  info={`${p.models.length} 模型`}
                  selected={selectedProviderId === p.provider_id}
                  onClick={() => handleSelectProvider(p.provider_id)}
                  actions={
                    <>
                      <NameEditButton
                        title="改名"
                        onClick={() => setRenamingProvider(p.provider_id)}
                      />
                      <IconHoverButton
                        title="删除"
                        icon="delete"
                        tone="destructive"
                        disabled={false}
                        onClick={() => setConfirmingDeleteProvider(p.provider_id)}
                      />
                    </>
                  }
                />
              ))}

              {/* Managed providers: parent rows (expand) + child group rows */}
              {managed.map((mv) => {
                const expandable = mv.groups.length > 1
                const expanded = expandedManaged.has(mv.id)
                return (
                  <div key={mv.id}>
                    {expandable ? (
                      <>
                        <ProviderRow
                          name={
                            <>
                              {mv.pending_sync && (
                                <span className="mr-1 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium text-warning">
                                  待同步
                                </span>
                              )}
                              <span className="truncate font-medium">{mv.name}</span>
                            </>
                          }
                          info={`${mv.groups.length} 分组`}
                          selected={false}
                          onClick={() => toggleManagedExpand(mv.id)}
                          actions={
                            <>
                              {mv.pending_sync && (
                                <IconHoverButton
                                  title="同步到配置文件"
                                  icon="auto_fix_high"
                                  tone="success"
                                  disabled={false}
                                  onClick={() => setConfirmingSync(mv)}
                                />
                              )}
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
                          <div className="ml-4 space-y-0.5 border-l border-border pl-1.5">
                            {mv.groups.map((g) => (
                              <ProviderRow
                                key={g.endpoint}
                                name={mv.name + g.suffix}
                                info={`${g.model_count} 模型`}
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
                          name={
                            <>
                              {mv.pending_sync && (
                                <span className="mr-1 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium text-warning">
                                  待同步
                                </span>
                              )}
                              <span className="truncate font-medium">{mv.name + g.suffix}</span>
                            </>
                          }
                          info={`${g.model_count} 模型`}
                          selected={
                            selectedManaged?.mid === mv.id && selectedManaged?.endpoint === g.endpoint
                          }
                          onClick={() => handleSelectManaged(mv.id, g.endpoint)}
                          actions={
                            <>
                              {mv.pending_sync && (
                                <IconHoverButton
                                  title="同步到配置文件"
                                  icon="auto_fix_high"
                                  tone="success"
                                  disabled={false}
                                  onClick={() => setConfirmingSync(mv)}
                                />
                              )}
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

          {/* Middle: provider other_fields + models */}
          <div className="flex min-h-0 flex-col">
<ColumnHeader
              action={
                selectedManagedGroup ? null : (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditingScope(editingScope === 'provider' ? null : 'provider')}
                      disabled={!selectedProvider}
                    >
                      <AppIcon name={editingScope === 'provider' ? 'auto_fix_high' : 'edit'} size={12} data-icon="inline-start" />
                      {editingScope === 'provider' ? '完成编辑' : '编辑JSON'}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={
                        applying ||
                        editingScope === 'provider' ||
                        providerDiff.filter((d) => d.status !== 'ok' && d.status !== 'no-recommendation').length === 0
                      }
                      onClick={() => void handleApply('provider')}
                    >
                      <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                      使用推荐值
                    </Button>
                  </div>
                )
              }
            >
              {selectedManagedGroup
                ? `托管 · ${selectedManagedGroup.view.name}${selectedManagedGroup.group.suffix}`
                : selectedProvider
                  ? `供应商配置 · ${selectedProvider.provider_id}`
                  : '供应商配置'}
            </ColumnHeader>
            <div className="max-h-[40%] overflow-auto border-b border-border p-2">
              {selectedManagedGroup ? (
                <ReadOnlyJson
                  value={
                    (selectedManagedGroup.group.generated as { provider?: unknown } | undefined)?.provider
                  }
                  note="由系统最优值生成，不允许编辑"
                />
              ) : selectedProvider ? (
                editingScope === 'provider' ? (
                  <JsonEditor
                    value={activeProviderValue}
                    onChange={(text) => setLiveContent(wrapRootScope('provider', text, summary, selectedProviderId, selectedModelId))}
                  />
                ) : (
                  <JsonDiffHighlight
                    value={activeProviderValue}
                    markers={providerDiff}
                    onApplyOne={(path) => {
                      const rec = effectiveProviderRecs.find((r) => r.key === path)
                      if (rec) applyOneField(path, rec.recommended)
                    }}
                  />
                )
              ) : (
                <Placeholder>未选择供应商</Placeholder>
              )}
            </div>
            <ColumnHeader
              action={
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!selectedProvider || !selectedModelId}
                  onClick={() => setSyncingFromInfo(true)}
                  title="从我们维护的模型信息表格同步到当前模型"
                >
                  <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                  同步模型信息
                </Button>
              }
            >
              模型列表
            </ColumnHeader>
            <div className="flex-1 overflow-y-auto p-2">
              {selectedManagedGroup ? (
                <>
                  {Object.keys(
                    (selectedManagedGroup.group.generated as { models?: Record<string, unknown> } | undefined)?.models ?? {},
                  ).length === 0 && <Placeholder>该分组没有可同步的模型</Placeholder>}
                  {Object.entries(
                    (selectedManagedGroup.group.generated as { models?: Record<string, unknown> } | undefined)?.models ?? {},
                  ).map(([mid]) => (
                    <button
                      key={mid}
                      type="button"
                      onClick={() => setSelectedManagedModelId(mid)}
                      className={
                        'flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-xs transition-colors ' +
                        (selectedManagedModelId === mid
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted')
                      }
                    >
                      <AppIcon name="robot" size={12} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{mid}</span>
                    </button>
                  ))}
                </>
              ) : selectedProvider && selectedProvider.models.length === 0 ? (
                <Placeholder>该供应商下没有模型</Placeholder>
              ) : (
                selectedProvider?.models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModelId(m.id)}
                    className={
                      'flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-xs transition-colors ' +
                      (selectedModelId === m.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted')
                    }
                  >
                    <AppIcon name="robot" size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{m.id}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: model config */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader
              action={
                selectedManagedGroup ? null : (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditingScope(editingScope === 'model' ? null : 'model')}
                      disabled={!selectedModel}
                    >
                      <AppIcon name={editingScope === 'model' ? 'auto_fix_high' : 'edit'} size={12} data-icon="inline-start" />
                      {editingScope === 'model' ? '推荐视图' : '编辑JSON'}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={
                        applying ||
                        editingScope === 'model' ||
                        !selectedModel ||
                        modelDiff.filter((d) => d.status !== 'ok' && d.status !== 'no-recommendation').length === 0
                      }
                      onClick={() => void handleApply('model')}
                    >
                      <AppIcon name="auto_fix_high" size={12} data-icon="inline-start" />
                      使用推荐值
                    </Button>
                  </div>
                )
              }
            >
              {selectedManagedGroup
                ? `模型配置 · ${selectedManagedModelId ?? ''}（只读）`
                : selectedModel
                  ? `模型配置 · ${selectedModel.id}`
                  : '模型配置'}
            </ColumnHeader>
            <div className="flex-1 overflow-auto p-2">
              {selectedManagedGroup ? (
                <ReadOnlyJson
                  value={
                    selectedManagedModelId
                      ? (selectedManagedGroup.group.generated as { models?: Record<string, unknown> } | undefined)?.models?.[selectedManagedModelId]
                      : undefined
                  }
                  note="由系统最优值生成，不允许编辑"
                />
              ) : selectedModel ? (
                editingScope === 'model' ? (
                  <JsonEditor
                    value={activeModelValue}
                    onChange={(text) => setLiveContent(wrapRootScope('model', text, summary, selectedProviderId, selectedModelId))}
                  />
                ) : (
                  <JsonDiffHighlight
                    value={activeModelValue}
                    markers={modelDiff}
                    onApplyOne={(path) => {
                      const rec = effectiveModelRecs.find((r) => r.key === path)
                      if (rec) applyOneField(path, rec.recommended)
                    }}
                  />
                )
              ) : (
                <Placeholder>未选择模型</Placeholder>
              )}
            </div>
          </div>
        </div>

<AgentModelInfoMatchDialog
          open={syncingFromInfo}
          onOpenChange={setSyncingFromInfo}
          record={record}
          providerId={selectedProviderId}
          provider={selectedProvider}
          modelInfoFields={summary?.model_info_fields ?? {
            max_context: '',
            max_output_token: '',
            input_types: '',
            thinking_levels: '',
          }}
          onPreview={({ content, applied }) => {
            setLiveContent(content)
            toast(`已生成预览：${applied} 处变更待保存`)
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
          description={`确认删除配置文件中的 provider「${confirmingDeleteProvider ?? ''}」？删除会随预览一起提交，点右上角保存后生效。`}
          onConfirm={() => {
            if (confirmingDeleteProvider) handleDeleteProvider(confirmingDeleteProvider)
            setConfirmingDeleteProvider(null)
          }}
        />

        {/* Sync managed provider confirm */}
        <ConfirmSyncDialog
          open={confirmingSync !== null}
          view={confirmingSync}
          onOpenChange={(open) => {
            if (!open) setConfirmingSync(null)
          }}
          onConfirm={() => confirmingSync && void handleSyncManaged(confirmingSync)}
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
      </DialogContent>
    </Dialog>
  )
}

function RenameProviderDialog({
  open,
  currentName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  currentName: string
  onOpenChange: (open: boolean) => void
  onConfirm: (newName: string) => void
}) {
  const [value, setValue] = useState(currentName)
  useEffect(() => {
    if (open) setValue(currentName)
  }, [open, currentName])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>修改 provider 名称</DialogTitle>
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

function ConfirmSyncDialog({
  open,
  view,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  view: ManagedProviderView | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="sm">
        <DialogHeader>
          <DialogTitle>同步托管 provider</DialogTitle>
        </DialogHeader>
        <p className="px-4 text-xs text-muted-foreground">
          确认将托管 provider 「{view?.name ?? ''}」生成的内容写入配置文件？同步会立即写入并原子保存。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button
            variant="default"
            onClick={() => {
              setBusy(true)
              onConfirm()
            }}
            disabled={busy}
          >
            {busy ? '同步中...' : '确认同步'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ProviderRow is a single sidebar row with a leading slot, label and a
// trailing actions slot rendered on hover.
function ProviderRow({
  name,
  info,
  selected,
  onClick,
  actions,
  leading,
}: {
  name: React.ReactNode
  info: string
  selected: boolean
  onClick: () => void
  actions: React.ReactNode | null
  leading?: React.ReactNode
}) {
  return (
    <div
      className={
        'group flex w-full items-center gap-1 rounded-none px-2 py-1.5 text-left text-xs transition-colors ' +
        (selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted')
      }
    >
      {leading}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center truncate font-medium">{name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{info}</span>
      </button>
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
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

function NameEditButton({
  title,
  onClick,
}: {
  title: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={title}
      className="h-5 w-5 text-muted-foreground hover:text-primary"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <AppIcon name="edit" size={11} />
    </Button>
  )
}

// ReadOnlyJson renders a generated managed-provider block in a
// monospace pre — no edit affordances, just view.
function ReadOnlyJson({ value, note }: { value: unknown; note: string }) {
  if (value === null || value === undefined) {
    return <Placeholder>{note}</Placeholder>
  }
  return (
    <div className="rounded-md border border-border bg-muted/10 p-2">
      <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
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
  const parsed = JSON.parse(content) as Record<string, unknown>
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
  const parsed = JSON.parse(content) as Record<string, unknown>
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
): string {
  if (!summary || !providerId) return edited
  const root = currentActualContent(summary) as Record<string, unknown>
  const providers = (root.provider ?? {}) as Record<string, unknown>
  const provider = (providers[providerId] ?? {}) as Record<string, unknown>
  let parsed: unknown
  try {
    parsed = JSON.parse(edited)
  } catch {
    parsed = edited
  }
  if (scope === 'provider') {
    const next = { ...(parsed as Record<string, unknown>) }
    next.models = provider.models
    providers[providerId] = next
  } else if (scope === 'model' && modelId) {
    const next = { ...(parsed as Record<string, unknown>) }
    const models = { ...((provider.models ?? {}) as Record<string, unknown>) }
    models[modelId] = parsed
    next.models = models
    providers[providerId] = next
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
function currentActualContent(summary: AgentModelSummary | null): Record<string, unknown> {
  if (!summary) return {}
  const out: Record<string, unknown> = {}
  const providers: Record<string, unknown> = {}
  for (const p of summary.providers) {
    const other = (p.other_fields ?? {}) as Record<string, unknown>
    const models: Record<string, unknown> = {}
    for (const m of p.models) {
      models[m.id] = (m.config ?? {}) as unknown
    }
    providers[p.provider_id] = { ...other, models }
  }
  // The shape matches opencode (provider.<id>) by default; openclaw's
  // shape (models.providers.<id>) is handled at extract-time, so this
  // minimal shape works for both.
  out.provider = providers
  return out
}

// setJsonPath walks a dotted path inside the parsed content and writes
// value at the leaf, creating intermediate objects as needed. Returns
// the re-serialized content. Throws if content is not valid JSON.
function setJsonPath(content: string, path: string, value: unknown): string {
  const parsed = JSON.parse(content) as Record<string, unknown>
  const segments = path.split('.')
  let cur: Record<string, unknown> = parsed
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const next = cur[seg]
    if (next === null || next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      cur[seg] = {}
    }
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segments[segments.length - 1]] = value
  return JSON.stringify(parsed)
}

function JsonDiffHighlight({
  value,
  markers,
  onApplyOne,
}: {
  value: unknown
  markers: readonly DiffMarker[]
  onApplyOne?: (path: string) => void
}) {
  if (value === null || value === undefined) {
    return <Placeholder>为空</Placeholder>
  }
  const lines = buildUnifiedDiff(value, markers)
  return (
    <div className="overflow-x-auto font-mono text-sm leading-relaxed">
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} onApplyOne={onApplyOne} />
      ))}
    </div>
  )
}

// Each diff row carries an action label that drives the row's
// background color, plus the field path it applies to. The label is
// always rendered as a Chinese action phrase (推荐新增 / 推荐修改 / 推荐
// 不填 / 未查到该字段), so the user reads it as guidance rather than a
// raw status code.
type DiffAction =
  | '推荐新增'
  | '推荐修改'
  | '推荐不填'
  | '未查到该字段'
  | 'context'
  | 'mismatch'

interface DiffRowData {
  readonly prefix: ' ' | '-' | '+'
  readonly text: string
  readonly action: DiffAction
  readonly path?: string
  readonly recommendedValue?: unknown
}

const ROW_BG: Record<DiffAction, string> = {
  '推荐新增': 'bg-success/15 hover:bg-success/25',
  '推荐修改': 'bg-warning/15 hover:bg-warning/25',
  '推荐不填': 'bg-muted hover:bg-muted/80',
  '未查到该字段': 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700',
  context: 'hover:bg-muted/30',
  mismatch: 'bg-destructive/15 hover:bg-destructive/25',
}

const ROW_TEXT_COLOR: Record<DiffAction, string> = {
  '推荐新增': 'text-success',
  '推荐修改': 'text-warning',
  '推荐不填': 'text-muted-foreground',
  '未查到该字段': 'text-muted-foreground',
  context: 'text-foreground',
  mismatch: 'text-destructive',
}

const ROW_ACTION_COLOR: Record<DiffAction, string> = {
  '推荐新增': 'text-success',
  '推荐修改': 'text-warning',
  '推荐不填': 'text-muted-foreground',
  '未查到该字段': 'text-muted-foreground',
  context: 'text-muted-foreground',
  mismatch: 'text-destructive',
}

const ACTION_LABEL: Record<DiffAction, string> = {
  '推荐新增': '推荐新增',
  '推荐修改': '推荐修改',
  '推荐不填': '推荐不填',
  '未查到该字段': '未查到该字段',
  context: '',
  mismatch: '推荐修改',
}

function DiffRow({
  line,
  onApplyOne,
}: {
  line: DiffRowData
  onApplyOne?: (path: string) => void
}) {
  const showApply = (line.action === '推荐新增' || line.action === '推荐修改' || line.action === '推荐不填') && line.path && onApplyOne
  return (
    <div
      className={
        'group flex w-full min-w-full items-center gap-2 px-2 py-1 transition-colors ' + ROW_BG[line.action]
      }
    >
      <span
        className={
          'w-3 shrink-0 select-none text-center font-bold ' +
          (line.prefix === ' ' ? 'invisible' : ROW_TEXT_COLOR[line.action])
        }
      >
        {line.prefix === ' ' ? '' : line.prefix}
      </span>
      <span
        className={
          'w-[88px] shrink-0 select-none text-xs font-medium ' +
          ROW_ACTION_COLOR[line.action]
        }
      >
        {ACTION_LABEL[line.action]}
      </span>
      <span className="flex-1 whitespace-nowrap">
        <JsonTokens text={line.text} />
      </span>
      {showApply ? (
        <Button
          variant="ghost"
          size="xs"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => onApplyOne!(line.path!)}
        >
          使用推荐值
        </Button>
      ) : (
        <span className="w-[1px]" />
      )}
    </div>
  )
}

// buildUnifiedDiff turns the actual JSON object + the recommendation
// markers into a flat list of rows the UI can render directly. Rows are
// interleaved with the actual object order — every existing key keeps
// its position, and unmatched recommendation lines are inserted at the
// end of their scope. The action label on each row tells the user what
// to do (新增 / 修改 / 不填 / 未查到).
function buildUnifiedDiff(
  value: unknown,
  markers: readonly DiffMarker[],
): DiffRowData[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [
      {
        prefix: ' ',
        text: JSON.stringify(value, null, 2),
        action: 'context',
      },
    ]
  }
  const recs: AgentRecommendation[] = markers.map((m) => ({
    scope: 'provider',
    key: m.path,
    description: '',
    type: 'string',
    recommended: m.recommended,
    required: false,
  }))
  const out: DiffRowData[] = []
  out.push({ prefix: ' ', text: '{', action: 'context' })
  out.push(...renderObject(value as Record<string, unknown>, recs, 1))
  out.push({ prefix: ' ', text: '}', action: 'context' })
  return out
}

function renderObject(
  obj: Record<string, unknown>,
  recs: readonly AgentRecommendation[],
  indent: number,
): DiffRowData[] {
  const pad = '  '.repeat(indent)
  const out: DiffRowData[] = []

  const directRecs = new Map<string, AgentRecommendation>()
  const nestedByFirst = new Map<string, AgentRecommendation[]>()
  for (const r of recs) {
    const dot = r.key.indexOf('.')
    if (dot < 0) {
      directRecs.set(r.key, r)
    } else {
      const first = r.key.substring(0, dot)
      const rest = r.key.substring(dot + 1)
      const sub: AgentRecommendation = { ...r, key: rest }
      const arr = nestedByFirst.get(first) ?? []
      arr.push(sub)
      nestedByFirst.set(first, arr)
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    const directRec = directRecs.get(k)
    const nestedRecs = nestedByFirst.get(k) ?? []
    const status = directRec ? directRecStatus(v, directRec) : null

    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push({ prefix: ' ', text: `${pad}"${k}": {`, action: 'context' })
      out.push(...renderObject(v as Record<string, unknown>, nestedRecs, indent + 1))
      out.push({ prefix: ' ', text: `${pad}}`, action: 'context' })
      continue
    }

    const valText = formatValue(v)
    if (status === 'mismatch') {
      out.push({
        prefix: '-',
        text: `${pad}"${k}": ${valText}`,
        action: 'mismatch',
        path: fullRecPath(obj, directRec!),
        recommendedValue: directRec!.recommended,
      })
      out.push({
        prefix: '+',
        text: `${pad}"${k}": ${formatValue(directRec!.recommended)}`,
        action: '推荐修改',
        path: fullRecPath(obj, directRec!),
        recommendedValue: directRec!.recommended,
      })
    } else if (status === 'unmatched') {
      out.push({
        prefix: ' ',
        text: `${pad}"${k}": ${valText}`,
        action: '未查到该字段',
      })
    } else {
      out.push({
        prefix: ' ',
        text: `${pad}"${k}": ${valText}`,
        action: 'context',
      })
    }
  }

  for (const [k, r] of directRecs) {
    if (k in obj) continue
    const recVal = r.recommended
    if (recVal === null || recVal === undefined) {
      out.push({
        prefix: ' ',
        text: `${pad}"${k}": null（推荐不填）`,
        action: '推荐不填',
        path: r.key,
      })
    } else {
      out.push({
        prefix: '+',
        text: `${pad}"${k}": ${formatValue(recVal)}`,
        action: '推荐新增',
        path: r.key,
        recommendedValue: recVal,
      })
    }
  }

  return out
}

// directRecStatus decides whether the recommendation matches the
// actual value, is a mismatch, or simply has no entry for this key.
function directRecStatus(actual: unknown, rec: AgentRecommendation): 'ok' | 'mismatch' | 'unmatched' {
  if (rec.recommended === null || rec.recommended === undefined) return 'unmatched'
  return deepEqual(rec.recommended, actual) ? 'ok' : 'mismatch'
}

// fullRecPath echoes the recommendation's key for the hover handler —
// the renderer already stripped nested prefixes off the rec, so the
// stored key is the full path the user wrote.
function fullRecPath(_obj: Record<string, unknown>, rec: AgentRecommendation): string {
  return rec.key
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function ColumnHeader({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">{children}</span>
      {action}
    </div>
  )
}

// PreviewBanner sits at the top of the dialog body whenever pending
// preview changes are waiting to be saved. It exposes two buttons:
// - 取消: drop the preview, return to read-only state
// - 保存: write the previewed content to the live config file
function PreviewBanner({
  applied,
  saving,
  onSave,
  onCancel,
}: {
  applied: number
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2 text-warning">
        <AppIcon name="auto_fix_high" size={14} />
        <span>
          预览：当前编辑与文件实际值相比，共 <strong className="font-semibold">{applied}</strong> 处差异待保存
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="default" size="xs" disabled={saving} onClick={onSave}>
          {saving ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : '保存'}
        </Button>
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