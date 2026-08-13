import { useCallback, useEffect, useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'

import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Provider, ProviderEndpoint, ProviderInput, ProviderModel, FetchedModel } from '@/lib/dashboard-api'

type ProviderFormProps = {
  readonly provider: Provider | null
  readonly onSave: (provider: ProviderInput) => void
  readonly onCancel: () => void
  readonly isSaving: boolean
  readonly useKey: boolean
  readonly onUseKeyChange: (next: boolean) => void
}

const emptyProvider: ProviderInput = {
  name: '', baseUrls: [], keys: [], endpoints: [], models: [], status: true, workflowEnabled: true, autoDisabled: false,
}

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : '发生意外错误，请重试'
}

export function ProviderPage() {
  const [providers, setProviders] = useState<readonly Provider[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(20)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useKey, setUseKey] = useState(true)

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listProviders({ limit, offset })
      setProviders(result.providers)
      setTotal(result.total)
    } catch (error) {
      setError(toErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [offset, limit])

  useEffect(() => { void loadProviders() }, [loadProviders])

  const runMutation = async (operation: () => Promise<unknown>) => {
    setIsSaving(true)
    setError(null)
    try {
      await operation()
      await loadProviders()
      return true
    } catch (error) {
      setError(toErrorMessage(error))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async (provider: ProviderInput) => {
    const saved = await runMutation(() => editing
      ? dashboardApi.updateProvider(editing.id, provider)
      : dashboardApi.createProvider(provider))
    if (saved) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    setIsSaving(true)
    setError(null)
    try {
      const parsed = parseJsonEditorArray<Provider>(data)
      const currentMap = new Map(providers.map((p) => [p.id, p]))
      const retainedIds = new Set<string>()
      const ops: Promise<unknown>[] = []

      for (const item of parsed) {
        const id = idMap.get(item.id)
          const providerInput: ProviderInput = {
          name: item.name, baseUrls: item.baseUrls, keys: item.keys,
          endpoints: item.endpoints, models: item.models,
          status: item.status, workflowEnabled: item.workflowEnabled, autoDisabled: item.autoDisabled,
        }
        if (id && currentMap.has(id)) {
          retainedIds.add(id)
          const { id: _editorId, ...edited } = item
          const currentRecord = currentMap.get(id)
          if (!currentRecord) continue
          const { id: _backendId, ...current } = currentRecord
          if (JSON.stringify(edited) !== JSON.stringify(current)) {
            ops.push(dashboardApi.updateProvider(id, providerInput))
          }
        } else {
          ops.push(dashboardApi.createProvider(providerInput))
        }
      }

      for (const id of currentMap.keys()) {
        if (!retainedIds.has(id)) {
          ops.push(dashboardApi.deleteProvider(id))
        }
      }

      const results = await Promise.allSettled(ops)
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      await loadProviders()
      if (failures.length > 0) {
        throw new Error(`${failures.length} 项保存失败`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const columns: ColumnDef<Provider>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, provider) => <span className="font-medium">{provider.name}</span> },
    { key: 'baseUrls', label: 'Base URLs', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs text-muted-foreground">{provider.baseUrls.length} URLs</span> },
    { key: 'keys', label: 'Keys', defaultWidth: { kind: 'pixel', value: 100 }, render: (_, provider) => <span className="text-xs text-muted-foreground">{provider.keys.length} Keys</span> },
    { key: 'endpoints', label: 'Endpoints', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, provider) => <span className="text-xs text-muted-foreground">{provider.endpoints.length} Endpoints</span> },
    {
      key: 'models',
      label: '模型',
      defaultWidth: { kind: 'pixel', value: 240 },
      render: (_, provider) => (
        <div className="flex flex-wrap gap-1">
          {provider.models.map((model) => <span key={model.model} className="text-xs text-muted-foreground">{model.model}</span>)}
        </div>
      ),
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, provider) => <span className={provider.status ? 'text-success' : 'text-destructive'}>{provider.status ? '启用' : '禁用'}</span>,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 220 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, provider) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.toggleProvider(provider.id))}>{provider.status ? '禁用' : '启用'}</Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(provider); setIsDialogOpen(true) }}><AppIcon name="edit" /></Button>
          <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.deleteProvider(provider.id))}><AppIcon name="delete" /></Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="供应商"
        description="管理上游 API 供应商配置"
        status={`${total} 供应商`}
      />
      <div className="p-6">
        <DataTable
          id="providers"
          columns={columns}
          data={providers}
          total={total}
          loading={isLoading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText="暂无供应商。添加一个供应商开始配置。"
          onRetry={() => void loadProviders()}
          actions={(
            <>
              <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving}>
                <AppIcon name="add" data-icon="inline-start" />添加供应商
              </Button>
              <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={isSaving}>
                <AppIcon name="code" data-icon="inline-start" />编辑 JSON
              </Button>
            </>
          )}
        />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent width="md">
            <DialogHeader><DialogTitle>{editing ? '编辑供应商' : '添加供应商'}</DialogTitle></DialogHeader>
            <ProviderForm provider={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} isSaving={isSaving} useKey={useKey} onUseKeyChange={setUseKey} />
          </DialogContent>
        </Dialog>
        {jsonOpen && (
          <JsonEditModal
            data={providers}
            onSave={handleJsonSave}
            onClose={() => setJsonOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function ProviderForm({ provider, onSave, onCancel, isSaving, useKey, onUseKeyChange }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderInput>(provider ?? emptyProvider)
  const [newEndpoint, setNewEndpoint] = useState<ProviderEndpoint>({ name: '', pathSuffix: '' })
  const [newModel, setNewModel] = useState<ProviderModel>({ model: '', endpoints: [] })
  const [globalDefaultEndpoint, setGlobalDefaultEndpoint] = useState<string | null>(null)
  const [endpointOverride, setEndpointOverride] = useState<string | null>(null)
  const [isEndpointDialogOpen, setIsEndpointDialogOpen] = useState(false)
  const [endpointDraft, setEndpointDraft] = useState('')
  const [isEndpointSaving, setIsEndpointSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<readonly FetchedModel[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void dashboardApi.getSettings()
      .then((settings) => {
        if (cancelled) return
        const setting = settings.find((item) => item.key === 'default_model_list_endpoint')
        setGlobalDefaultEndpoint(setting ? setting.value : null)
      })
      .catch(() => {
        if (!cancelled) setGlobalDefaultEndpoint(null)
      })
    return () => { cancelled = true }
  }, [])

  const effectiveEndpoint = endpointOverride ?? globalDefaultEndpoint

  const handleFetchModels = async () => {
    if (!effectiveEndpoint) {
      setFetchError('请先在系统设置中配置默认模型列表接口，或点击齿轮设置接口地址')
      return
    }
    if (!effectiveEndpoint.startsWith('/')) {
      setFetchError('路径必须以斜杠开头（/）')
      return
    }
    const baseUrl = form.baseUrls[0]
    if (!baseUrl) {
      setFetchError('请先在上方填写 Base URLs')
      return
    }
    const fullUrl = `${baseUrl.replace(/\/+$/, '')}${effectiveEndpoint}`
    setFetchError(null)
    setIsFetching(true)
    try {
      setFetchedModels(await dashboardApi.fetchModelsFromEndpoint(fullUrl, useKey ? form.keys[0] : undefined))
    } catch (error) {
      setFetchError(toErrorMessage(error))
    } finally {
      setIsFetching(false)
    }
  }

  const handleSaveEndpoint = async () => {
    setIsEndpointSaving(true)
    try {
      const trimmed = endpointDraft.trim()
      setEndpointOverride(trimmed === '' ? null : trimmed)
      setIsEndpointDialogOpen(false)
    } finally {
      setIsEndpointSaving(false)
    }
  }

  const handleConfirmAddModels = (ids: readonly string[], replace?: boolean) => {
    const additions: ProviderModel[] = ids.map((id) => ({ model: id, endpoints: [] }))
    if (replace) {
      setForm((current) => ({ ...current, models: additions }))
    } else {
      const existingIds = new Set(form.models.map((model) => model.model))
      const filtered = additions.filter((a) => !existingIds.has(a.model))
      if (filtered.length > 0) {
        setForm((current) => ({ ...current, models: [...current.models, ...filtered] }))
      }
    }
    setFetchedModels(null)
  }

  return (
    <FieldGroup>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="provider-name">名称</FieldLabel>
          <Input id="provider-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="OpenAI" />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="provider-baseurls">Base URLs（每行一个）</FieldLabel>
        <Textarea id="provider-baseurls" value={form.baseUrls.join('\n')} onChange={(event) => setForm((current) => ({ ...current, baseUrls: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder="https://api.openai.com/v1" rows={3} />
      </Field>
      <Field>
        <FieldLabel htmlFor="provider-keys">API Keys（每行一个）</FieldLabel>
        <Textarea id="provider-keys" value={form.keys.join('\n')} onChange={(event) => setForm((current) => ({ ...current, keys: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder="sk-xxx" rows={2} />
      </Field>
      <Field>
        <FieldLabel>Endpoints</FieldLabel>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input value={newEndpoint.name} onChange={(event) => setNewEndpoint((current) => ({ ...current, name: event.target.value }))} placeholder="名称" />
            <Input value={newEndpoint.pathSuffix} onChange={(event) => setNewEndpoint((current) => ({ ...current, pathSuffix: event.target.value }))} placeholder="路径后缀" />
            <Button type="button" variant="outline" size="icon" disabled={!newEndpoint.name || !newEndpoint.pathSuffix} onClick={() => { setForm((current) => ({ ...current, endpoints: [...current.endpoints, newEndpoint] })); setNewEndpoint({ name: '', pathSuffix: '' }) }}><AppIcon name="add" /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {form.endpoints.map((endpoint) => (
              <span key={`${endpoint.name}:${endpoint.pathSuffix}`} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{endpoint.name}: {endpoint.pathSuffix}<button className="ml-1 text-destructive/70 hover:text-destructive" onClick={() => setForm((current) => ({ ...current, endpoints: current.endpoints.filter((item) => item !== endpoint) }))}><AppIcon name="close" size={12} className="inline" /></button></span>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          不填写任何 endpoint 表示不限制请求路径；填写后只允许访问这些路径后缀，否则会被拒绝并记录到请求记录表
        </p>
      </Field>
      <Field>
        <FieldLabel>模型</FieldLabel>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void handleFetchModels()}>
              {isFetching ? <AppIcon name="progress_activity" data-icon="inline-start" className="animate-spin" /> : <AppIcon name="refresh" data-icon="inline-start" />}
              从上游获取模型
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => { setEndpointDraft(effectiveEndpoint ?? ''); setIsEndpointDialogOpen(true) }}>
              <AppIcon name="settings" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Input value={newModel.model} onChange={(event) => setNewModel((current) => ({ ...current, model: event.target.value }))} placeholder="模型 ID" />
            <Button type="button" variant="outline" size="icon" disabled={!newModel.model} onClick={() => { setForm((current) => ({ ...current, models: [...current.models, newModel] })); setNewModel({ model: '', endpoints: [] }) }}><AppIcon name="add" /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {form.models.map((model) => (
              <span key={model.model} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"><button className="mr-1 text-foreground/70 hover:text-foreground" onClick={() => setForm((current) => ({ ...current, models: current.models.filter((item) => item !== model) }))}><AppIcon name="close" size={12} className="inline" /></button>{model.model}</span>
            ))}
          </div>
          {fetchError && (
            <p role="alert" className="text-xs text-destructive">{fetchError}</p>
          )}
        </div>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>取消</Button>
        <Button disabled={isSaving || !form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>{isSaving ? '保存中...' : '保存'}</Button>
      </div>
      <Dialog open={isEndpointDialogOpen} onOpenChange={setIsEndpointDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>模型列表接口</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="model-list-endpoint">模型列表接口路径</FieldLabel>
              <Input id="model-list-endpoint" value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="/v1/models" />
              <p className="text-xs text-muted-foreground">路径必须以斜杠开头（/），将拼接在 Base URL 之后</p>
            </Field>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={useKey} onCheckedChange={(checked) => onUseKeyChange(checked === true)} />
              <span className="text-foreground">是否传入 Key</span>
            </label>
            <p className="text-xs text-muted-foreground">将使用当前供应商的第一个 Key 作为 Bearer 凭证</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEndpointDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleSaveEndpoint()} disabled={isEndpointSaving}>{isEndpointSaving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {fetchedModels && (
        <FetchModelDialog
          models={fetchedModels}
          existingIds={new Set(form.models.map((model) => model.model))}
          onClose={() => setFetchedModels(null)}
          onConfirm={handleConfirmAddModels}
        />
      )}
    </FieldGroup>
  )
}

type FetchModelDialogProps = {
  readonly models: readonly FetchedModel[]
  readonly existingIds: ReadonlySet<string>
  readonly onClose: () => void
  readonly onConfirm: (ids: readonly string[], replace?: boolean) => void
}

function FetchModelDialog({ models, existingIds, onClose, onConfirm }: FetchModelDialogProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(models.filter((model) => existingIds.has(model.id)).map((model) => model.id)),
  )
  const [saving, setSaving] = useState(false)

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleConfirm = () => {
    setSaving(true)
    onConfirm([...selected])
  }

  const handleReplaceAndAdd = () => {
    setSaving(true)
    onConfirm([...selected], true)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>从上游获取模型</DialogTitle></DialogHeader>
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {models.map((model) => (
            <label key={model.id} className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox checked={selected.has(model.id)} onCheckedChange={(checked) => toggle(model.id, checked === true)} />
              <span className="text-foreground">{model.id}{model.name !== model.id && <span className="text-muted-foreground">（{model.name}）</span>}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={selected.size === 0 || saving} onClick={() => void handleReplaceAndAdd()}>{saving ? '添加中...' : '清空已有并添加'}</Button>
          <Button disabled={selected.size === 0 || saving} onClick={() => void handleConfirm()}>{saving ? '添加中...' : '添加'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
