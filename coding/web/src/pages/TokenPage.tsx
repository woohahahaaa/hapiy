import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Copy, RefreshCw, Code } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dashboardApi, DashboardApiError } from '@/lib/dashboard-api'
import type { Token, TokenInput } from '@/lib/dashboard-api'

type TokenFormProps = {
  readonly token: Token | null
  readonly onSave: (token: TokenInput) => void
  readonly onCancel: () => void
  readonly isSaving: boolean
}

function toErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : '发生意外错误，请重试'
}

export function TokenPage() {
  const [tokens, setTokens] = useState<readonly Token[]>([])
  const [editing, setEditing] = useState<Token | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTokens = async () => {
    setIsLoading(true)
    setError(null)
    try {
      setTokens(await dashboardApi.listTokens())
    } catch (error) {
      setError(toErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { void loadTokens() }, [])

  const runMutation = async (operation: () => Promise<unknown>) => {
    setIsSaving(true)
    setError(null)
    try {
      await operation()
      await loadTokens()
      return true
    } catch (error) {
      setError(toErrorMessage(error))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async (token: TokenInput) => {
    const saved = await runMutation(() => editing
      ? dashboardApi.updateToken(editing.id, token)
      : dashboardApi.createToken(token))
    if (saved) {
      setEditing(null)
      setIsDialogOpen(false)
    }
  }

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    setIsSaving(true)
    setError(null)
    try {
      const parsed = parseJsonEditorArray<Token>(data)
      const currentMap = new Map(tokens.map((t) => [t.id, t]))
      const retainedIds = new Set<string>()
      const ops: Promise<unknown>[] = []

      for (const item of parsed) {
        const id = idMap.get(item.id)
        const tokenInput: TokenInput = {
          name: item.name,
          quota: item.quota,
          status: item.status,
          key: item.key,
          historyKeys: item.historyKeys,
          usedQuota: item.usedQuota,
        }
        if (id && currentMap.has(id)) {
          retainedIds.add(id)
          const { id: _editorId, ...edited } = item
          const currentRecord = currentMap.get(id)
          if (!currentRecord) continue
          const { id: _backendId, ...current } = currentRecord
          if (JSON.stringify(edited) !== JSON.stringify(current)) {
            ops.push(dashboardApi.updateToken(id, tokenInput))
          }
        } else {
          ops.push(dashboardApi.createToken(tokenInput))
        }
      }

      for (const id of currentMap.keys()) {
        if (!retainedIds.has(id)) {
          ops.push(dashboardApi.deleteToken(id))
        }
      }

      const results = await Promise.allSettled(ops)
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      await loadTokens()
      if (failures.length > 0) {
        throw new Error(`${failures.length} 项保存失败`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const copyToClipboard = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
    } catch (error) {
      setError(error instanceof Error ? `复制失败：${error.message}` : '复制失败')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="令牌管理" subtitle="API tokens and quotas" status={`${tokens.length} tokens`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">管理下游 API Token 和额度</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={isSaving}>
              <Code className="mr-2 h-4 w-4" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsDialogOpen(true) }} disabled={isSaving}><Plus className="mr-2 h-4 w-4" />添加令牌</Button>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent><DialogHeader><DialogTitle>{editing ? '编辑令牌' : '添加令牌'}</DialogTitle></DialogHeader><TokenForm token={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsDialogOpen(false) }} isSaving={isSaving} /></DialogContent>
          </Dialog>
          {jsonOpen && (
            <JsonEditModal
              data={tokens}
              onSave={handleJsonSave}
              onClose={() => setJsonOpen(false)}
            />
          )}
        </div>

        {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadTokens()}>重试</Button></div>}

        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>名称</TableHead><TableHead>Token</TableHead><TableHead>额度</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">正在加载令牌...</TableCell></TableRow>}
              {!isLoading && tokens.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无令牌。添加一个令牌开始使用。</TableCell></TableRow>}
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell><div className="flex items-center gap-2"><code className="rounded bg-muted px-2 py-1 text-xs font-mono">{token.key.slice(0, 12)}...</code><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void copyToClipboard(token.key)}><Copy className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-6 w-6" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.rotateToken(token.id))} title="Rotate Key"><RefreshCw className="h-3 w-3" /></Button></div>{token.historyKeys.length > 0 && <div className="mt-1 text-[10px] text-muted-foreground">历史: {token.historyKeys.length} 个旧 key</div>}</TableCell>
                  <TableCell>{token.quota === null ? <Badge variant="secondary" className="text-[10px]">无限制</Badge> : <div className="flex items-center gap-2"><span className="text-xs">¥{token.usedQuota} / ¥{token.quota}</span><div className="h-1.5 w-16 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((token.usedQuota / token.quota) * 100, 100)}%` }} /></div></div>}</TableCell>
                  <TableCell><Switch checked={token.status} disabled={isSaving} onCheckedChange={() => void runMutation(() => dashboardApi.toggleToken(token.id))} /></TableCell>
                  <TableCell className="text-right"><div className="flex items-center justify-end gap-2"><Button variant="ghost" size="icon" disabled={isSaving} onClick={() => { setEditing(token); setIsDialogOpen(true) }}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={isSaving} onClick={() => void runMutation(() => dashboardApi.deleteToken(token.id))}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function TokenForm({ token, onSave, onCancel, isSaving }: TokenFormProps) {
  const [name, setName] = useState(token?.name ?? '')
  const [quota, setQuota] = useState(token?.quota?.toString() ?? '')
  const [status, setStatus] = useState(token?.status ?? true)

  return (
    <div className="space-y-4">
      <div className="space-y-2"><Label>名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Token" /></div>
      {token ? <div className="space-y-2"><Label>Token</Label><code className="block rounded bg-muted px-2 py-2 text-xs font-mono">{token.key}</code>{token.historyKeys.length > 0 && <p className="text-[10px] text-muted-foreground">已有 {token.historyKeys.length} 个历史 Key；使用列表中的更新按钮由服务端轮换。</p>}</div> : <p className="text-sm text-muted-foreground">服务端会在保存后生成 Token Key。</p>}
      <div className="space-y-2"><Label>额度 (¥，留空=无限制)</Label><Input type="number" value={quota} onChange={(event) => setQuota(event.target.value)} placeholder="无限制" /></div>
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <Label className="text-sm">启用状态</Label>
        <div className="flex items-center gap-1.5">
          <span className={status ? 'rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground' : 'text-xs text-muted-foreground'}>{status ? '已开启' : '已关闭'}</span>
          <Switch checked={status} onCheckedChange={setStatus} />
        </div>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel} disabled={isSaving}>取消</Button><Button disabled={isSaving || !name.trim()} onClick={() => onSave({ name: name.trim(), quota: quota === '' ? null : Number(quota), status })}>{isSaving ? '保存中...' : '保存'}</Button></div>
    </div>
  )
}
