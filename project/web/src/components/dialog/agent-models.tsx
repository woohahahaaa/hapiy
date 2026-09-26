import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { JsonTokens } from '@/components/JsonHighlight'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollBody,
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
  AgentModelConfigSources,
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
import { modelInfoChangesFor } from '@/lib/agent-model-info'
import { loadModelsDevModels, providersForModel } from '@/lib/models-dev'
import { diffLines, type Change } from 'diff'

type DiffStatus = 'ok' | 'missing' | 'mismatch'

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
  // managedActionsRow: 点击托管供应商父级后，该行右侧动作按钮保持常显
  // （模拟 hover），直到点击该行以外任何地方才消失。
  const [managedActionsRow, setManagedActionsRow] = useState<string | null>(null)
  const [renamingProvider, setRenamingProvider] = useState<string | null>(null)
  const [confirmingDeleteProvider, setConfirmingDeleteProvider] = useState<string | null>(null)
  const [confirmingDeleteManaged, setConfirmingDeleteManaged] = useState<ManagedProviderView | null>(null)
  // Top-level panel: 非托管供应商 / 托管供应商。
  const [activePanel, setActivePanel] = useState<'normal' | 'managed'>('normal')
  const [confirmSyncManaged, setConfirmSyncManaged] = useState(false)
  // 保存/同步成功后的按钮状态：弹窗保持打开，按钮显示「保存成功/同步成功」，
  // 有新修改、切换 tab 或重新打开弹窗时恢复。
  const [savedOk, setSavedOk] = useState(false)
  const [syncOk, setSyncOk] = useState(false)
  const [managedDialogOpen, setManagedDialogOpen] = useState(false)
  const [managedEditing, setManagedEditing] = useState<ManagedProviderView | null>(null)
  const [syncingAllManaged, setSyncingAllManaged] = useState(false)
  // 预览差异：点「预览差异」进入；显示"全部套用推荐模板 + 参考供应商4基础
  // 字段"后的内容与当前内容的差异。切换供应商/模型保持；编辑则取消。
  const [diffPreviewing, setDiffPreviewing] = useState(false)
  const [diffBefore, setDiffBefore] = useState<string | null>(null)
  const [diffAfter, setDiffAfter] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  // 预览差异中"未设置或已失效参考厂商"的模型：{ provider, models } 列表，
  // 供右侧 diff 顶部灰色备注。文案取表格列头「从 models.dev 同步模型配置」。
  const [diffUnsetModels, setDiffUnsetModels] = useState<readonly { provider: string; model: string; stale: boolean }[]>([])
  // diff 中点击某一行动作后退出预览，把 JsonEditor 定位到该行（0-based）。
  const [diffJumpLine, setDiffJumpLine] = useState<number | null>(null)

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
    setSavedOk(false)
    setSyncOk(false)
    // 预览差异是进入弹窗后手动点击才激活的临时状态；换记录/重开弹窗必须
    // 复位，否则上一次的「预览差异」会被默认带上（按钮误显示选中 + 残留 diff）。
    setDiffPreviewing(false)
    setDiffBefore(null)
    setDiffAfter(null)
    setDiffUnsetModels([])
    setDiffLoading(false)
    setDiffJumpLine(null)
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

  // providerConflictCounts: 每个普通供应商与推荐模板不一致的字段数
  // （供应商级 + 模型级之和），列表行内展示。
  const providerConflictCounts = useMemo(() => {
    const map = new Map<string, number>()
    const recsOf = (p: AgentModelProvider) => {
      const matched = (summary?.protocols ?? []).filter((pp) =>
        protocolMatchesConditions(p.other_fields, pp),
      )
      const extra: AgentRecommendation[] = []
      for (const pp of matched) {
        for (const r of pp.recommendations) extra.push(r)
      }
      return [...providerRecs, ...modelRecs, ...extra]
    }
for (const p of summary?.providers ?? []) {
      const recs = recsOf(p)
      const pRecs = recs.filter((r) => r.scope === 'provider')
      const mRecs = recs.filter((r) => r.scope === 'model')
      const conflicts = (markers: readonly DiffMarker[]) =>
        markers.filter((d) => d.status !== 'ok').length
      let n = conflicts(computeDiff(p.other_fields ?? {}, pRecs))
      for (const m of p.models) {
        n += conflicts(computeDiff(m.config ?? {}, mRecs))
      }
      map.set(p.provider_id, n)
    }
    return map
  }, [summary, providerRecs, modelRecs])

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

  // focusLineForSelectedModel: 选中的模型 key 在右侧 JSON 文本中的起始行
  // （0-based）；未选模型返回 null。用于右侧编辑框滚动到该行并高亮。
  const focusLineForSelectedModel = useMemo(() => {
    if (!selectedModelId) return null
    return focusLineForKey(currentEditableProviderValue, selectedModelId)
  }, [selectedModelId, currentEditableProviderValue])

  // 托管供应商：与普通供应商一致的滚动/高亮联动，仅只读。
  const focusLineForManagedModel = useMemo(() => {
    if (!selectedManagedModelId || !selectedManagedGroup) return null
    const t = JSON.stringify(selectedManagedGroup.group.generated, null, 2)
    return focusLineForKey(t, selectedManagedModelId)
  }, [selectedManagedModelId, selectedManagedGroup])

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

  // pendingChangeCount: 当前未提交预览的实际差异数（推荐模板已应用或
  // JSON 编辑后）。hasPendingPreview 只在「确有差异」时为真 —— 0 差异时
  // 不显示差异横幅、不提示退出编辑、也不提示「已修改 N 项」。
  const pendingChangeCount = useMemo(
    () => (templateTally.size > 0 ? templateApplied : liveDiffCount),
    [templateTally, templateApplied, liveDiffCount],
  )
  const hasPendingPreview = liveContent !== null && pendingChangeCount > 0

  // 新一轮编辑（liveContent 从 null 变非 null）→ 「保存成功」恢复为「保存」。
  const prevLiveContentRef = useRef<unknown>(null)
  useEffect(() => {
    if (prevLiveContentRef.current === liveContent) return
    prevLiveContentRef.current = liveContent
    if (liveContent !== null) setSavedOk(false)
  }, [liveContent])

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
      setSavedOk(true)
      reload()
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

  // 所有关闭路径（右上角 X、取消/关闭按钮、ESC、遮罩点击）统一走这里：
  // 有未保存差异时先弹二次确认，否则直接关闭。
  const tryClose = () => {
    if (hasPendingPreview) {
      setConfirmingCancel(true)
      return
    }
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    tryClose()
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
      exitDiffPreview()
      setLiveContent(renameProviderInContent(base, oldId, target, summary))
      toast('已生成预览：provider 改名待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改名失败')
    }
  }

  const handleDeleteProvider = (id: string) => {
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      exitDiffPreview()
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

  // 点击行外任意位置 → 取消父级行的常显动作按钮（等价于移走 hover）。
  useEffect(() => {
    if (!managedActionsRow) return
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (!el || !el.closest(`[data-managed-row="${managedActionsRow}"]`)) {
        setManagedActionsRow(null)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [managedActionsRow])

  const handleSelectManaged = (mid: string, endpoint: string) => {
    setSelectedProviderId(null)
    setSelectedModelId(null)
    setSelectedManagedModelId(null)
    setSelectedManaged({ mid, endpoint })
  }

  // 切换顶部分栏：非托管与托管互斥，切过去时自动选中该面板第一项。
  const switchPanel = (target: 'normal' | 'managed') => {
    if (target === activePanel) return
    setActivePanel(target)
    setSavedOk(false)
    setSyncOk(false)
    if (target === 'managed') {
      setSelectedProviderId(null)
      setSelectedModelId(null)
      const first = managed[0]
      if (first && first.groups.length > 0) {
        handleSelectManaged(first.id, first.groups[0].endpoint)
      }
    } else {
      setSelectedManaged(null)
      setSelectedManagedModelId(null)
      const first = normalProviders[0]
      if (first) {
        setSelectedProviderId(first.provider_id)
        setSelectedModelId(first.models[0]?.id ?? null)
      }
    }
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
      setSyncOk(true)
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
      // 0 差异：不进入预览/写盘，避免残留「已修改 0 项」的提示。
      if (res.applied === 0) {
        setTemplateTally(new Map()); setTemplateApplied(0); setLiveContent(null)
        toast('没有需要应用的变更（均已符合推荐）')
        onOpenChange(false)
        return
      }
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

  // 预览差异：对所有非托管供应商 + 模型套用一次"推荐配置"（推荐模板 +
  // 每模型从其持久化参考供应商（无则候选第一）拉取的 4 基础字段），返回的
  // content 与当前内容（liveContent ?? 文件原文）并排 diff 显示。切
  // 换供应商/模型保持状态，再次点击或任何编辑取消。
  const handlePreviewDiff = async () => {
    if (!record || !summary) return
    if (diffPreviewing) {
      setDiffPreviewing(false)
      setDiffBefore(null)
      setDiffAfter(null)
      setDiffUnsetModels([])
      return
    }
    setDiffLoading(true)
    try {
      const [models, sources] = await Promise.all([
        loadModelsDevModels(),
        dashboardApi.getAgentModelConfigSources(record.id).catch(() => ({}) as AgentModelConfigSources),
      ])
      const modelInfoFields = summary.model_info_fields ?? {
        max_context: '',
        max_output_token: '',
        input_types: '',
        thinking_levels: '',
        reasoning_effort: '',
      }
      // 全部普通供应商（含其全部模型）套用。
      const checked: Record<string, readonly string[]> = {}
      const modelFields: Record<string, Record<string, Record<string, unknown>>> = {}
      const unset: { provider: string; model: string; stale: boolean }[] = []
      for (const p of summary.providers ?? []) {
        if (managedBlockNames.has(p.provider_id)) continue
        checked[p.provider_id] = []
        let perModel: Record<string, Record<string, unknown>> | null = null
        for (const m of p.models) {
          // 参考供应商：优先用上次持久化选择，否则候选第一。
          let supplier = ''
          let stale = false
          const persisted = sources[p.provider_id]?.[m.id]
          const candidates = providersForModel(models ?? [], m.id)
          if (persisted?.mode === 'self' && persisted.self_supplier) {
            if (candidates.some((x) => x.providerName === persisted.self_supplier)) {
              supplier = persisted.self_supplier
            } else {
              stale = true // 持久化参考厂商已失效：留空，备注提示
            }
          } else {
            supplier = candidates[0]?.providerName ?? ''
          }
          if (!supplier) {
            if (!stale) unset.push({ provider: p.provider_id, model: m.id, stale })
            continue
          }
          const changes = modelInfoChangesFor(m.config, m.id, supplier, models ?? [], modelInfoFields)
          if (changes.length === 0) continue
          perModel ??= {}
          const fields: Record<string, unknown> = {}
          for (const ch of changes) fields[ch.path] = ch.newValue
          perModel[m.id] = fields
        }
        if (perModel) modelFields[p.provider_id] = perModel
      }
      if (Object.keys(checked).length === 0) {
        toast('没有可预览的非托管供应商')
        return
      }
      const res = await dashboardApi.applyRecommendationConfig(record.id, checked, modelFields)
      // diff 按当前选中 provider 片段对比，保证点击行号与右侧 JsonEditor 对齐。
      const base = currentEditableProviderValue
      const afterBlock = selectedProviderId
        ? extractProviderBlockFromContent(res.content, selectedProviderId)
        : res.content
      setDiffBefore(base)
      setDiffAfter(afterBlock)
      setDiffUnsetModels(unset)
      setDiffPreviewing(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预览差异失败')
    } finally {
      setDiffLoading(false)
    }
  }

  // 任何编辑操作（JSON 编辑、改名、删除、套用推荐）取消预览差异状态。
  const exitDiffPreview = () => {
    if (diffPreviewing) {
      setDiffPreviewing(false)
      setDiffBefore(null)
      setDiffAfter(null)
      setDiffUnsetModels([])
      setDiffJumpLine(null)
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
      exitDiffPreview()
      setLiveContent(renameModelInContent(base, providerId, oldId, target))
      toast('已生成预览：模型改名待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '改名失败')
    }
  }

  const handleDeleteModel = (providerId: string, modelId: string) => {
    const base = liveContent ?? rawContent ?? JSON.stringify(currentActualContent(summary, rawContent), null, 2)
    try {
      exitDiffPreview()
      setLiveContent(deleteModelFromContent(base, providerId, modelId))
      toast('已生成预览：删除模型待保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        width="md"
        height="auto"
        showCloseButton={false}
        className="flex !h-[90vh] max-h-[90vh] flex-col !gap-0 overflow-hidden p-0 !w-[1280px] !max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>管理模型 · {record?.record_name ?? ''}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {record?.agent_type ?? ''} · {record?.path ?? ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={tryClose}>
              <AppIcon name="close" size={16} />
            </Button>
          </div>
        </DialogHeader>

        {/* 顶部分栏：非托管供应商 / 托管供应商 */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/20 px-4">
          {(['normal', 'managed'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchPanel(key)}
              className={
                'relative -mb-px border-b-2 px-3 py-2 text-xs transition-colors ' +
                (key === 'managed'
                  ? activePanel === key
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-primary hover:text-primary/75'
                  : activePanel === key
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {key === 'normal' ? '非托管供应商' : '托管供应商'}
            </button>
          ))}
        </div>

        {hasPendingPreview && (
          <PreviewBanner applied={pendingChangeCount} />
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[22%_25%_minmax(0,1fr)] divide-x divide-border">
{/* Left: 非托管供应商 (normal panel) / 托管供应商 (managed panel) */}
        <div className="flex min-h-0 flex-col">
          {activePanel === 'normal' ? (
            <>
              <ColumnHeader>供应商</ColumnHeader>
              {/* 非托管面板工具行：与托管面板样式一致 */}
              <div className="flex items-center border-b border-border bg-muted/30 px-2 py-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  title="选择参考供应商，按官方推荐配置对勾选的供应商与模型套用推荐配置"
                  disabled={!summary || !record}
                  onClick={() => setSyncingFromInfo(true)}
                >
                使用推荐配置
                </Button>
                <Button
                  type="button"
                  variant={diffPreviewing ? 'default' : 'outline'}
                  size="xs"
                  className="ml-2"
                  title={
                    diffPreviewing
                      ? '退出预览差异，返回编辑视图'
                      : '假设全部套用推荐模板（含每个模型持久化的参考供应商基础字段）后，与当前内容对比差异'
                  }
                  disabled={!summary || !record || diffLoading}
                  onClick={() => void handlePreviewDiff()}
                >
                  {diffLoading ? (
                    <AppIcon name="progress_activity" size={12} className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <AppIcon name={diffPreviewing ? 'close' : 'call_split'} size={12} data-icon="inline-start" />
                  )}
                  {diffLoading ? '计算中…' : diffPreviewing ? '取消预览' : '预览差异'}
                </Button>
              </div>
              {/* 非托管供应商区域：高度至少 3 行，超出内部滚动 */}
              <div className="max-h-[40%] flex-1 overflow-y-auto p-0">
                {loading && <Placeholder>加载中…</Placeholder>}
                {error && <Placeholder tone="error">{error}</Placeholder>}
                {!loading && !error && summary && summary.providers.length === 0 && (
                  <Placeholder>未解析到任何 provider</Placeholder>
                )}
                {(normalProviders.map((p) => {
                  const tally = templateTally.get(p.provider_id)
                  const conflicts = providerConflictCounts.get(p.provider_id) ?? 0
                  return (
                    <ProviderRow
                      key={p.provider_id}
                      name={p.provider_id}
                      info={
                        tally && tally.count > 0
                          ? { text: `${tally.count} 处修改`, green: true }
                          : conflicts > 0
                            ? { text: `${conflicts} 个字段与推荐不一致`, green: false }
                            : { text: `${p.models.length}模型`, green: false }
                      }
                      selected={selectedProviderId === p.provider_id}
                      onClick={() => handleSelectProvider(p.provider_id)}
                      actions={
                        <RowMenu
                          items={[
                            { key: 'rename', label: '修改名字', icon: 'edit' },
                            { key: 'delete', label: '删除', icon: 'delete', destructive: true },
                          ]}
                          light={selectedProviderId === p.provider_id}
                          onSelect={(k) => {
                            if (k === 'rename') setRenamingProvider(p.provider_id)
                            else setConfirmingDeleteProvider(p.provider_id)
                          }}
                        />
                      }
                    />
                  )
                }))}
              </div>
            </>
          ) : (
            <>
              <ColumnHeader>
                <span className="font-medium text-primary">托管供应商</span>
              </ColumnHeader>
              <div className="flex items-center border-b border-border bg-muted/30 px-2 py-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  title="把我们系统里录入的供应商按 endpoint 分组后生成托管 provider"
                  onClick={() => {
                    setManagedEditing(null)
                    setManagedDialogOpen(true)
                    setSyncOk(false)
                  }}
                >
                  <AppIcon name="add" size={12} data-icon="inline-start" />
                  添加托管供应商
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-0">
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
                            info={mv.pending_sync
                              ? { text: `${mv.pending_fields} 字段待同步`, green: false }
                              : { text: `${mv.groups.length} 分组`, green: false }}
                            badge={mv.pending_sync ? (
                              <span className="shrink-0 font-mono font-medium text-warning">[待同步]</span>
                            ) : null}
                            selected={false}
                            onClick={() => {
                              const willExpand = !expandedManaged.has(mv.id)
                              // 父级行本身永远不选中：展开时选第一个分组，折叠时清空选择。
                              toggleManagedExpand(mv.id)
                              if (willExpand && mv.groups.length > 0) {
                                handleSelectManaged(mv.id, mv.groups[0].endpoint)
                              } else if (selectedManaged?.mid === mv.id) {
                                setSelectedManaged(null)
                                setSelectedManagedModelId(null)
                                setSelectedProviderId(null)
                                setSelectedModelId(null)
                              }
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
                                    setSyncOk(false)
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
                                  info={g.pending
                                  ? { text: `${g.pending_fields} 字段待同步`, green: false }
                                  : { text: `${g.model_count}模型`, green: false }}
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
                            info={g.pending
                              ? { text: `${g.pending_fields} 字段待同步`, green: false }
                              : { text: `${g.model_count}模型`, green: false }}
                            badge={mv.pending_sync ? (
                              <span className="shrink-0 font-mono font-medium text-warning">[待同步]</span>
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
                                  light={selectedManaged?.mid === mv.id && selectedManaged?.endpoint === g.endpoint}
                                  onClick={() => {
                                    setManagedEditing(mv)
                                    setManagedDialogOpen(true)
                                    setSyncOk(false)
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
            </>
          )}
        </div>

          {/* Middle: models list only */}
          <div className="flex min-h-0 flex-col">
            <ColumnHeader>模型列表</ColumnHeader>
            <div className="flex-1 overflow-y-auto p-0">
              {activePanel === 'managed' && !selectedManagedGroup ? (
                <Placeholder>未选择托管供应商</Placeholder>
              ) : selectedManagedGroup ? (
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
                          light={selectedModelId === m.id}
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

          {/* Right: single syntax-highlighted JSON editor */}
        <div className="flex min-h-0 flex-1 flex-col">
            <ColumnHeader>
              <span>{diffPreviewing ? '预览差异' : '供应商 JSON 片段'}</span>
            </ColumnHeader>
            <div className="min-h-0 flex-1 overflow-hidden p-0">
              {diffPreviewing && diffBefore !== null && diffAfter !== null ? (
                <DiffView
                  before={diffBefore}
                  after={diffAfter}
                  unsetModels={diffUnsetModels}
                  onInteract={(oldNo) => {
                    // 点击右侧 Json 区域任意处（尝试编辑）：退出预览，回到
                    // JsonEditor，并把光标跳到点击的那一行（old → 0-based）。
                    setDiffJumpLine(oldNo === null ? null : Math.max(0, oldNo - 1))
                    setDiffPreviewing(false)
                  }}
                />
              ) : selectedManagedGroup ? (
                <JsonEditor
                  value={selectedManagedGroup.group.generated}
                  focusLine={focusLineForManagedModel}
                  readonly
                />
              ) : selectedProvider ? (
                <JsonEditor
                  value={currentEditableProviderValue}
                  focusLine={diffJumpLine !== null ? diffJumpLine : focusLineForSelectedModel}
                  onChange={(text) => {
                    if (text === currentEditableProviderValue) return
                    exitDiffPreview()
                    setDiffJumpLine(null)
                    setLiveContent(wrapRootScope('provider', text, summary, selectedProviderId, selectedModelId, rawContent))
                  }}
                />
              ) : (
                <Placeholder>未选择供应商</Placeholder>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-4 py-3">
          {activePanel === 'normal' ? (
            <>
              <div className="flex flex-1 items-center">
                {hasPendingPreview && (
                  <span className="text-xs text-warning">
                    已修改 {pendingChangeCount} 项
                  </span>
                )}
              </div>
              <Button
                variant="default"
                disabled={saving || savedOk || liveContent === null}
                onClick={() => void handleSavePending()}
              >
                {saving ? (
                  <AppIcon name="progress_activity" size={14} className="animate-spin" />
                ) : savedOk ? (
                  <AppIcon name="check" size={14} data-icon="inline-start" />
                ) : null}
                {savedOk ? '保存成功' : '保存'}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-1 items-center">
                {managed.some((m) => m.pending_sync) && (
                  <span className="text-xs text-warning">
                    {managed.filter((m) => m.pending_sync).length} 个供应商待同步
                  </span>
                )}
              </div>
              <Button variant="outline" onClick={tryClose} disabled={syncingAllManaged}>
                关闭
              </Button>
              <Button
                variant="default"
                disabled={syncingAllManaged || syncOk || !managed.some((m) => m.pending_sync)}
                onClick={() => setConfirmSyncManaged(true)}
              >
                {syncingAllManaged ? (
                  <AppIcon name="progress_activity" size={14} className="animate-spin" />
                ) : syncOk ? (
                  <AppIcon name="check" size={14} data-icon="inline-start" />
                ) : (
                  <AppIcon name="auto_fix_high" size={14} data-icon="inline-start" />
                )}
                {syncOk ? '同步成功' : '同步到配置文件'}
              </Button>
            </>
          )}
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
            reasoning_effort: '',
          }}
          recommendations={summary?.recommendations ?? []}
          protocols={summary?.protocols ?? []}
          onPreview={({ content, applied }) => {
            exitDiffPreview()
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
        />

        <ConfirmSyncManagedDialog
          open={confirmSyncManaged}
          pendingCount={managed.filter((m) => m.pending_sync).length}
          syncing={syncingAllManaged}
          onCancel={() => setConfirmSyncManaged(false)}
          onConfirm={() => {
            setConfirmSyncManaged(false)
            void handleSyncAllManaged()
          }}
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
          <DialogContent width="sm" scrollFooter>
            <DialogHeader>
              <DialogTitle>使用推荐模板</DialogTitle>
            </DialogHeader>
            <DialogScrollBody footer={
              <>
                <Button variant="outline" onClick={() => setConfirmingTemplate(false)} disabled={applying}>取消</Button>
                <Button onClick={() => void handleApplyTemplate()} disabled={applying}>
                  {applying ? '应用中...' : '确认并生效'}
                </Button>
              </>
            }>
              <p className="text-xs text-muted-foreground">
                将根据 AI 软件官方的配置文档，对页面中全部供应商（托管供应商除外）
                及其模型的字段进行调整，并把结果直接写入文件生效。确认？
              </p>
            </DialogScrollBody>
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
      <DialogContent width="sm" scrollFooter>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              disabled={!value.trim() || value.trim() === currentName}
              onClick={() => onConfirm(value.trim())}
            >
              确认
            </Button>
          </>
        }>
          <div className="pb-4">
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
        </DialogScrollBody>
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
        'group relative flex h-[52px] w-full cursor-pointer items-center gap-1 rounded-none py-1 pr-2 pl-4 text-left transition-colors ' +
        (selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')
      }
    >
      {/* 箭头类 leading：绝对叠加在文字左前方，不参与流布局，
          保证有/无箭头时文字起点完全一致（都从 pl-4 开始） */}
      {leading ? (
        <div className="pointer-events-none absolute top-1/2 left-[2px] -translate-y-1/2">
          {leading}
        </div>
      ) : null}
      <div className={'flex min-w-0 flex-1 flex-col gap-0.5 text-left ' + (indent ? 'pl-3' : '')}>
        <span className={'flex min-w-0 items-center truncate text-sm ' + (selected ? 'font-bold text-primary-foreground' : 'font-medium')}>{name}</span>
        {(info || badge) && (
          <span
            className={
              'flex min-w-0 items-center gap-1 text-[11px] ' +
              (selected
                ? 'font-bold text-primary-foreground/80'
                : info !== null && typeof info === 'object' && info.green
                  ? 'text-success'
                  : 'text-muted-foreground')
            }
          >
            {badge}
            <span className="truncate">
              {info !== null && typeof info === 'object' ? info.text : info}
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
        'group flex h-[52px] w-full items-center gap-1 rounded-none py-1 pr-2 pl-4 text-left transition-colors ' +
        (selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 text-left"
      >
        {info ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={'flex min-w-0 items-center gap-2 truncate text-sm ' + (selected ? 'font-bold text-primary-foreground' : 'font-medium')}>
              <AppIcon name="layers" size={12} className={'shrink-0 ' + (selected ? 'text-primary-foreground/80' : 'text-muted-foreground')} />
              {name}
            </span>
            <span
              className={
                'truncate text-[11px] ' +
                (selected
                  ? 'font-bold text-primary-foreground/80'
                  : typeof info === 'object' && info.green
                    ? 'text-success'
                    : 'text-muted-foreground')
              }
            >
              {typeof info === 'object' ? info.text : info}
            </span>
          </span>
        ) : (
          <span className="flex min-h-8 min-w-0 items-center gap-2 truncate text-sm">
            <AppIcon name="layers" size={12} className={'shrink-0 ' + (selected ? 'text-primary-foreground/80' : 'text-muted-foreground')} />
            <span className={selected ? 'font-bold text-primary-foreground' : 'font-medium'}>{name}</span>
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
  light = false,
}: {
  items: readonly { key: string; label: string; icon: string; destructive?: boolean }[]
  onSelect: (key: string) => void
  /** 选中态：图标使用与选中文字一致的深色（primary-foreground）。 */
  light?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={
            'h-5 w-5 ' +
            (light
              ? 'text-primary-foreground/90 hover:bg-primary/20 hover:text-primary-foreground'
              : 'text-muted-foreground hover:text-primary')
          }
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
  light = false,
  onClick,
}: {
  title: string
  icon: string
  tone: 'default' | 'destructive' | 'success'
  disabled: boolean
  /** 选中态：图标使用与选中文字一致的深色（primary-foreground）。 */
  light?: boolean
  onClick: () => void
}) {
  const toneClass = light
    ? 'text-primary-foreground/90 hover:bg-primary/20 hover:text-primary-foreground'
    : tone === 'destructive'
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

  // Recommendations for keys that aren't present. 不干预推荐（skip / 无值
  // set）不产生 missing：缺失即无需处理；仅“set 且有推荐值”才算冲突。
  for (const rec of recs) {
    if (visited.has(rec.key)) continue
    if (recActionOf(rec) !== 'set' || rec.recommended === null || rec.recommended === undefined) {
      continue
    }
    out.push({
      path: rec.key,
      status: 'missing',
      recommended: rec.recommended,
      actual: undefined,
    })
  }
  return out
}

// recActionOf 解析推荐操作（缺省 "set"），与后端 RecommendAction 一致。
function recActionOf(rec: AgentRecommendation): 'set' | 'skip' | 'delete' {
  if (rec.action === 'skip' || rec.action === 'delete') return rec.action
  return 'set'
}

function evaluateMarker(key: string, actual: unknown, rec: AgentRecommendation): DiffMarker {
  switch (recActionOf(rec)) {
    case 'skip':
      // 推荐不填、明确不动：无论文件里有没有该字段都是「不干预」。
      return { path: key, status: 'ok', recommended: rec.recommended, actual }
    case 'delete':
      // 仅显式 delete 才视为“应删除”：字段存在即冲突，缺失即无事。
      return actual === undefined
        ? { path: key, status: 'ok', recommended: undefined, actual }
        : { path: key, status: 'mismatch', recommended: undefined, actual }
    default:
      if (rec.recommended === null || rec.recommended === undefined) {
        // recommended 无值 = 不干预，保留用户字段，不算冲突。
        return { path: key, status: 'ok', recommended: null, actual }
      }
      if (deepEqual(rec.recommended, actual)) {
        return { path: key, status: 'ok', recommended: rec.recommended, actual }
      }
      return { path: key, status: 'mismatch', recommended: rec.recommended, actual }
  }
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

// extractProviderBlockFromContent 取出整文件 content 中某个 provider 的完整
// 块（provider 字段 + models），供预览差异按 provider 片段与 JsonEditor 对齐。
function extractProviderBlockFromContent(content: string, providerId: string): string {
  try {
    const parsed = JSON.parse(stripJsoncComments(content)) as Record<string, unknown>
    const root = providerRootOfContent(parsed)
    if (root) {
      let cur: Record<string, unknown> = parsed
      for (const seg of root) {
        const next = cur[seg]
        if (!next || typeof next !== 'object' || Array.isArray(next)) return content
        cur = next as Record<string, unknown>
      }
      const block = (cur as Record<string, unknown>)[providerId]
      if (block && typeof block === 'object') return JSON.stringify(block, null, 2)
    }
  } catch {
    // fall back to the raw content
  }
  return content
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
  // openclaw 模板声明 models_container="array"：保存时把 models 子树改写成
  // [{id, ...cfg}] 数组，而不是默认的对象 map，否则 openclaw 启动会因
  // schema 校验失败而崩溃。
  const useArray = summary.json_paths?.models_container === 'array'
  if (scope === 'provider') {
    const next = { ...(parsed as Record<string, unknown>) }
    next.models = modelsForShape(provider.models, useArray)
    providerMapContainer[providerId] = next
  } else if (scope === 'model' && modelId) {
    const next = { ...(parsed as Record<string, unknown>) }
    next.models = upsertModelById(provider.models, modelId, parsed, useArray)
    providerMapContainer[providerId] = next
  }
  return JSON.stringify(root)
}

// modelsForShape re-emits an existing models subtree in the shape the
// rule declares (array or object map). Unknown / undefined input
// becomes an empty container of the right shape.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function modelsForShape(
  existing: unknown,
  asArray: boolean,
): Record<string, unknown> | unknown[] {
  if (asArray) {
    if (Array.isArray(existing)) {
      return existing.map((item) => (isRecord(item) ? item : {}))
    }
    if (isRecord(existing)) {
      return Object.entries(existing).map(([id, cfg]) => {
        const base: Record<string, unknown> = { id, name: id }
        if (isRecord(cfg)) Object.assign(base, cfg)
        if (!('id' in base)) base.id = id
        return base
      })
    }
    return []
  }
  if (isRecord(existing)) {
    const out: Record<string, unknown> = {}
    if (Array.isArray(existing)) {
      for (const item of existing) {
        if (!isRecord(item)) continue
        const id = typeof item.id === 'string' ? item.id : ''
        if (id === '') continue
        out[id] = stripIdLikeKeys(item, id)
      }
      return out
    }
    return existing
  }
  return {}
}

// upsertModelById replaces (or inserts) a model entry in either shape,
// keeping the rest of the list intact.
function upsertModelById(
  existing: unknown,
  modelId: string,
  parsed: unknown,
  asArray: boolean,
): Record<string, unknown> | unknown[] {
  const edited = isRecord(parsed) ? parsed : {}
  if (asArray) {
    const list = Array.isArray(existing) ? existing.slice() : []
    const idx = list.findIndex((item) => isRecord(item) && item.id === modelId)
    const base: Record<string, unknown> = { id: modelId, name: modelId, ...edited }
    if (!('id' in base)) base.id = modelId
    if (idx >= 0) {
      list[idx] = base
    } else {
      list.push(base)
    }
    return list
  }
  const map: Record<string, unknown> = {}
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (!isRecord(item)) continue
      const id = typeof item.id === 'string' ? item.id : ''
      if (id === '') continue
      map[id] = stripIdLikeKeys(item, id)
    }
  } else if (isRecord(existing)) {
    Object.assign(map, existing)
  }
  map[modelId] = edited
  return map
}

// stripIdLikeKeys drops the `id` and `name` keys that the array form
// carries as siblings of the cfg, so the object-map form does not
// duplicate them inside the cfg body.
function stripIdLikeKeys(item: Record<string, unknown>, fallback: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item }
  if (out.id === fallback) delete out.id
  if (out.name === fallback) delete out.name
  return out
}

// JsonEditor renders a syntax-highlighted (colored) JSON editor built
// from a transparent textarea layered over a highlighted <pre>, with a
// plain line-number gutter. Errors parsing typed text surface as a red
// border without dropping the user's keystrokes.
// `focusLine` (0-based) is the first line of a value block (e.g. the
// selected model's `"id": {` line): the editor scrolls it to the top
// and highlights the whole brace block; any editing dims the highlight
// until focusLine changes again.
const LINE_HEIGHT = 18 // text-xs (12px) * leading-[1.5]

// focusLineForKey returns the 0-based line of `"<key>":` inside a JSON
// text, or null when the key isn't present.
function focusLineForKey(text: string, key: string): number | null {
  if (!text) return null
  const idx = text.indexOf(`"${key}":`)
  if (idx === -1) return null
  return Math.max(0, text.slice(0, idx).split('\n').length - 1)
}

// braceEndLine returns the last line index of the brace block that
// starts at startLine (the line of `"key": {`), skipping braces inside
// string literals so values like "a{}b" don't break the scan.
function braceEndLine(text: string, startLine: number): number {
  const lines = text.split('\n')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return i
      }
    }
  }
  return lines.length - 1
}

function JsonEditor({
  value,
  onChange,
  readonly = false,
  focusLine = null,
}: {
  value: unknown
  onChange?: (text: string) => void
  readonly?: boolean
  focusLine?: number | null
}) {
  const initial = useMemo(() => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [value])
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [dimmed, setDimmed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  // When the upstream value changes (provider switch, recommendations
  // apply), reset the editor to the new current state.
  useEffect(() => {
    setText(initial)
    setError(null)
  }, [initial])

  // 左侧切换模型 → 重新聚焦：恢复高亮并滚动该块到顶。
  useEffect(() => {
    setDimmed(false)
  }, [focusLine])

  // 聚焦块滚动：将首行放在编辑区顶部，滚动条与 gutter/pre 联动。
  useEffect(() => {
    if (focusLine === null || focusLine === undefined) return
    const ta = textareaRef.current
    if (!ta) return
    ta.scrollTop = Math.max(0, focusLine * LINE_HEIGHT)
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
  }, [focusLine])

  const lines = useMemo(() => text.split('\n'), [text])

  // 高亮范围 = [首行, 花括号块末行]；编辑（dimmed）后整体熄灭。
  const focusExtent = useMemo(() => {
    if (focusLine === null || focusLine === undefined || dimmed) return null
    return [focusLine, braceEndLine(text, focusLine)] as const
  }, [focusLine, text, dimmed])

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 行号 gutter：与 textarea 同字体同 leading，滚动联动 */}
        <div
          ref={gutterRef}
          aria-hidden
          className="absolute top-0 left-0 z-20 h-full w-8 overflow-hidden border-r border-border bg-muted/30 font-mono text-[10px] leading-[1.5] select-none"
        >
          {Array.from({ length: lines.length }, (_, i) => (
            <div
              key={i}
              className="flex h-[18px] items-center justify-center text-muted-foreground"
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* 语法着色层：逐行渲染（高亮整个被聚焦的 JSON 块），与 textarea 完全对齐 */}
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden bg-transparent px-0 py-0 pl-9 font-mono text-xs leading-[1.5] whitespace-pre break-words text-transparent"
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={focusExtent && i >= focusExtent[0] && i <= focusExtent[1] ? 'bg-muted-foreground/10' : undefined}
            >
              {line === '' ? '\u00A0' : <JsonTokens text={line} />}
            </div>
          ))}
        </pre>
        <Textarea
          ref={textareaRef}
          value={text}
          readOnly={readonly}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            setDimmed(true)
            try {
              JSON.parse(v)
              setError(null)
              onChange?.(v)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'JSON 解析失败')
            }
          }}
          onFocus={() => { if (!readonly) setDimmed(true) }}
          onScroll={(e) => {
            const el = e.currentTarget
            if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop
            if (preRef.current) {
              preRef.current.scrollTop = el.scrollTop
              preRef.current.scrollLeft = el.scrollLeft
            }
          }}
          className={
            'relative z-10 h-full min-h-[120px] resize-none overflow-auto px-0 py-0 pl-9 font-mono text-xs leading-[1.5] whitespace-pre break-words bg-transparent text-transparent caret-foreground selection:bg-primary/30 ' +
            (error ? 'border-destructive focus-visible:ring-destructive' : '')
          }
          spellCheck={false}
        />
      </div>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  )
}

// DiffView renders a single-column, VSCode-style unified diff of two JSON
// texts: the current file vs. the "after applying everything" result
// produced by 预览差异. Removed lines are marked red with a "-", added
// lines green with a "+"; old/new line numbers sit in the gutter so the
// reading feel matches an editor diff view. unsetModels lists the
// provider/models whose reference supplier is missing or stale — shown as
// a grey note (matching the "从 models.dev 同步模型配置" column header
// wording) so the user knows those model fields were not applied.
function DiffView({
  before,
  after,
  unsetModels,
  onInteract,
}: {
  before: string
  after: string
  unsetModels?: readonly { provider: string; model: string; stale: boolean }[]
  /** 用户在 diff 中点击任一行（尝试编辑）时回调；oldNo 是 before 侧行号（1-based，可为 null）。 */
  onInteract?: (oldNo: number | null) => void
}) {
  const pretty = (text: string): string => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  const groups = useMemo(() => diffLines(pretty(before), pretty(after)), [before, after])

  // 逐行构造：unified diff，保留旧/新行号供 gutter 显示。
  interface Row {
    kind: 'same' | 'del' | 'add'
    oldNo: number | null
    newNo: number | null
    text: string | null
  }
  const rows = useMemo<Row[]>(() => {
    let bi = 0
    let ai = 0
    const out: Row[] = []
    const valueLines = (v: string) => v.split('\n').slice(0, -1) // drop trailing "" from diffLines
    for (const part of groups as Change[]) {
      const lines = valueLines(part.value)
      if (part.removed) {
        for (const l of lines) {
          out.push({ kind: 'del', oldNo: bi + 1, newNo: null, text: l })
          bi++
        }
      } else if (part.added) {
        for (const l of lines) {
          out.push({ kind: 'add', oldNo: null, newNo: ai + 1, text: l })
          ai++
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          out.push({ kind: 'same', oldNo: bi + 1, newNo: ai + 1, text: lines[i] })
          bi++
          ai++
        }
      }
    }
    return out
  }, [groups])

  const gutter = (no: number | null) => (
    <div className={'w-10 shrink-0 px-1 text-right font-mono text-[10px] leading-[1.5] select-none ' + (no === null ? 'text-transparent' : 'text-muted-foreground/70')}>
      {no ?? '\u00A0'}
    </div>
  )

  const lineClass = (kind: Row['kind']) =>
    kind === 'del'
      ? 'bg-destructive/10'
      : kind === 'add'
        ? 'bg-emerald-500/10'
        : undefined

  const marker = (kind: Row['kind']) => (kind === 'del' ? '−' : kind === 'add' ? '+' : ' ')

  return (
    <div className="flex h-full min-h-0 flex-col">
      {unsetModels && unsetModels.length > 0 && (
        <div className="max-h-[30%] overflow-auto border-b border-border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
          <div className="mb-1 font-medium text-foreground/70">从 models.dev 同步模型配置</div>
          <ul className="space-y-0.5">
            {unsetModels.slice(0, 20).map((u, i) => (
              <li key={i}>
                <span className="font-mono">{u.provider}/{u.model}</span>
                <span className="mx-1">·</span>
                <span>{u.stale ? '已失效（上次选择的参考厂商已不在候选，未套用）' : '未设置参考厂商（未套用该模型基础字段）'}</span>
              </li>
            ))}
            {unsetModels.length > 20 && (
              <li className="text-muted-foreground/70">…等 {unsetModels.length} 个模型</li>
            )}
          </ul>
        </div>
      )}
      <div className="flex items-center border-b border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
        <span>当前内容 → 套用推荐后（{rows.filter((r) => r.kind !== 'same').length} 处变更）</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((r, i) => (
          <div
            key={i}
            onClick={() => onInteract?.(r.oldNo)}
            className={
              'flex items-stretch font-mono text-[11px] leading-[1.5] whitespace-pre break-words cursor-pointer ' +
              (lineClass(r.kind) ?? 'hover:bg-muted/40')
            }
          >
            {gutter(r.oldNo)}
            {gutter(r.newNo)}
            <div className={'w-5 shrink-0 text-center select-none ' + (r.kind === 'del' ? 'text-destructive' : r.kind === 'add' ? 'text-emerald-500' : 'text-muted-foreground/50')}>
              {marker(r.kind)}
            </div>
            <div className="min-w-0 flex-1 px-2 py-0">
              {(r.text ?? '').trimEnd() || '\u00A0'}
            </div>
          </div>
        ))}
      </div>
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

  // openclaw 模板声明 models_container="array"：rebuild 出来的 providers
  // 块里 models 子树必须是数组形式（每项带 id / name），不能默认写成对象
  // map，否则 openclaw 启动会因 schema 校验失败崩溃。
  const useArray = summary?.json_paths?.models_container === 'array'

  const providers: Record<string, unknown> = {}
  const summaryProviders = summary?.providers ?? []
  for (const p of summaryProviders) {
    const other = (p.other_fields ?? {}) as Record<string, unknown>
    const cfgById: Record<string, unknown> = {}
    for (const m of p.models) {
      cfgById[m.id] = (m.config ?? {}) as unknown
    }
    let models: unknown
    if (useArray) {
      models = p.models.map((m) => ({
        id: m.id,
        name: m.id,
        ...((m.config ?? {}) as Record<string, unknown>),
      }))
    } else {
      models = cfgById
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

function ColumnHeader({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
      <span>{children}</span>
      {action ? <span className="flex items-center gap-1">{action}</span> : null}
    </div>
  )
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
}: {
  open: boolean
  saving: boolean
  onCancel: () => void
  onDiscard: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent width="xs" scrollFooter>
        <DialogHeader>
          <DialogTitle>退出编辑？</DialogTitle>
          <DialogDescription>退出后编辑的内容不会被保存，确认退出？</DialogDescription>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
              继续编辑
            </Button>
            <Button variant="destructive" size="sm" onClick={onDiscard} disabled={saving}>
              确认退出
            </Button>
          </>
        } />
      </DialogContent>
    </Dialog>
  )
}

// ConfirmSyncManagedDialog: 执行「同步到配置文件」前的二次确认。
function ConfirmSyncManagedDialog({
  open,
  pendingCount,
  syncing,
  onCancel,
  onConfirm,
}: {
  open: boolean
  pendingCount: number
  syncing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent width="xs" scrollFooter>
        <DialogHeader>
          <DialogTitle>同步到配置文件</DialogTitle>
          <DialogDescription>
            将把所有「待同步」的托管供应商分组写入配置文件
            {pendingCount > 0 && <>（共 {pendingCount} 个供应商）</>}，确认同步？
          </DialogDescription>
        </DialogHeader>
        <DialogScrollBody footer={
          <>
            <Button variant="outline" size="sm" onClick={onCancel} disabled={syncing}>
              取消
            </Button>
            <Button variant="default" size="sm" onClick={onConfirm} disabled={syncing}>
              {syncing ? <AppIcon name="progress_activity" size={12} className="animate-spin" /> : '确认同步'}
            </Button>
          </>
        } />
      </DialogContent>
    </Dialog>
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