import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Provider, ProviderEndpoint, ProviderInput, ProviderModel } from '@/lib/dashboard-api'

type ProviderFormProps = {
  readonly provider: Provider | null
  readonly onSave: (provider: ProviderInput) => void
  readonly onCancel: () => void
  readonly isSaving: boolean
}

const emptyProvider: ProviderInput = {
  name: '', baseUrls: [], keys: [], endpoints: [], models: [], status: true, weight: 1,
}

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : '发生意外错误，请重试'
}

export function ProviderPage() {
  const [providers, setProviders] = useState<readonly Provider[]>([])
  const [editing, setEditing] = useState<Provider | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProviders = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setProviders(await dashboardApi.listProviders())
    } catch (error) {
      setError(toErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void loadProviders() }, [])

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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="供应商" subtitle="Channel management" status={`${providers.length} 渠道`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">管理上游 API 渠道配置</div>
          <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving}>
            <Plus className="mr-2 h-4 w-4" />添加渠道
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{editing ? '编辑渠道' : '添加渠道'}</DialogTitle></DialogHeader>
              <ProviderForm provider={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} isSaving={isSaving} />
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
            <span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadProviders()}>重试</Button>
          </div>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>名称</TableHead><TableHead>Base URLs</TableHead><TableHead>Keys</TableHead><TableHead>Endpoints</TableHead><TableHead>模型</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">正在加载渠道...</TableCell></TableRow>}
              {!isLoading && providers.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无渠道。添加一个渠道开始配置。</TableCell></TableRow>}
              {providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{provider.baseUrls.length} URLs</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{provider.keys.length} Keys</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{provider.endpoints.length} Endpoints</Badge></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{provider.models.map((model) => <Badge key={model.model} variant="outline" className="text-[10px]">{model.model}{model.discount !== undefined && model.discount !== 1 && <span className="ml-1 text-primary">{model.discount * 10}折</span>}</Badge>)}</div></TableCell>
                  <TableCell><Switch checked={provider.status} disabled={isSaving} onCheckedChange={() => void runMutation(() => dashboardApi.toggleProvider(provider.id))} /></TableCell>
                  <TableCell className="text-right"><div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(provider); setIsDialogOpen(true) }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.deleteProvider(provider.id))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function ProviderForm({ provider, onSave, onCancel, isSaving }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderInput>(provider ?? emptyProvider)
  const [newEndpoint, setNewEndpoint] = useState<ProviderEndpoint>({ name: '', pathSuffix: '' })
  const [newModel, setNewModel] = useState<ProviderModel>({ model: '', endpoints: [], discount: 1 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>名称</Label><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="OpenAI" /></div><div className="space-y-2"><Label>权重</Label><Input type="number" value={form.weight} onChange={(event) => setForm((current) => ({ ...current, weight: Number(event.target.value) || 1 }))} placeholder="1" /></div></div>
      <div className="space-y-2"><Label>Base URLs（每行一个）</Label><Textarea value={form.baseUrls.join('\n')} onChange={(event) => setForm((current) => ({ ...current, baseUrls: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder="https://api.openai.com/v1" rows={3} /></div>
      <div className="space-y-2"><Label>API Keys（每行一个）</Label><Textarea value={form.keys.join('\n')} onChange={(event) => setForm((current) => ({ ...current, keys: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder="sk-xxx" rows={2} /></div>
      <div className="space-y-2"><Label>Endpoints</Label><div className="flex gap-2"><Input value={newEndpoint.name} onChange={(event) => setNewEndpoint((current) => ({ ...current, name: event.target.value }))} placeholder="名称" /><Input value={newEndpoint.pathSuffix} onChange={(event) => setNewEndpoint((current) => ({ ...current, pathSuffix: event.target.value }))} placeholder="路径后缀" /><Button type="button" variant="outline" size="icon" disabled={!newEndpoint.name || !newEndpoint.pathSuffix} onClick={() => { setForm((current) => ({ ...current, endpoints: [...current.endpoints, newEndpoint] })); setNewEndpoint({ name: '', pathSuffix: '' }) }}><Plus className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-2">{form.endpoints.map((endpoint) => <Badge key={`${endpoint.name}:${endpoint.pathSuffix}`} variant="secondary" className="text-[10px]">{endpoint.name}: {endpoint.pathSuffix}<button className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setForm((current) => ({ ...current, endpoints: current.endpoints.filter((item) => item !== endpoint) }))}><X className="inline h-3 w-3" /></button></Badge>)}</div></div>
      <div className="space-y-2"><Label>模型</Label><div className="flex gap-2"><Input value={newModel.model} onChange={(event) => setNewModel((current) => ({ ...current, model: event.target.value }))} placeholder="模型 ID" /><Input type="number" value={newModel.discount ?? 1} onChange={(event) => setNewModel((current) => ({ ...current, discount: Number(event.target.value) || 1 }))} placeholder="折扣" className="w-24" /><Button type="button" variant="outline" size="icon" disabled={!newModel.model} onClick={() => { setForm((current) => ({ ...current, models: [...current.models, newModel] })); setNewModel({ model: '', endpoints: [], discount: 1 }) }}><Plus className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-2">{form.models.map((model) => <Badge key={model.model} variant="secondary" className="text-[10px]">{model.model}{model.discount !== undefined && model.discount !== 1 && <span className="ml-1">{model.discount * 10}折</span>}<button className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setForm((current) => ({ ...current, models: current.models.filter((item) => item !== model) }))}><X className="inline h-3 w-3" /></button></Badge>)}</div></div>
      <div className="flex items-center gap-2"><Switch checked={form.status} onCheckedChange={(status) => setForm((current) => ({ ...current, status }))} /><Label>启用</Label></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel} disabled={isSaving}>取消</Button><Button disabled={isSaving || !form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>{isSaving ? '保存中...' : '保存'}</Button></div>
    </div>
  )
}
