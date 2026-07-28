import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  dashboardApi,
  type RewriteRule,
  type HeartbeatRule,
  type ConcurrencyRule,
  type FailoverRule,
  type RuleType,
} from '@/lib/dashboard-api'

const policyTabs = [
  { id: 'rewrite', label: '请求改写' },
  { id: 'heartbeat', label: '心跳回复' },
  { id: 'concurrency', label: '并发控制' },
  { id: 'failover', label: '故障转移' },
] as const

export function PolicyPage() {
  const { type } = useParams<{ type: string }>()
  const activeTab = (type || 'rewrite') as RuleType

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="策略配置" subtitle="Policy rules" />
      <div className="flex-1 p-6">
        <Tabs value={activeTab} className="w-full">
          <TabsList className="mb-4">
            {policyTabs.map((tab) => (
              <Link
                key={tab.id}
                to={`/policy/${tab.id}`}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  activeTab === tab.id && 'bg-background text-foreground shadow-sm'
                )}
              >
                {tab.label}
              </Link>
            ))}
          </TabsList>

          {activeTab === 'rewrite' && <RewritePage />}
          {activeTab === 'heartbeat' && <HeartbeatPage />}
          {activeTab === 'concurrency' && <ConcurrencyPage />}
          {activeTab === 'failover' && <FailoverPage />}
        </Tabs>
      </div>
    </div>
  )
}

// ── Shared hook: fetch + mutate with loading/error state ──

function useRulesApi<T>(type: RuleType) {
  const [rules, setRules] = useState<readonly T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await dashboardApi.listRules<T>(type)
      setRules(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => { fetch() }, [fetch])

  const create = async (rule: Partial<T> & { readonly status: boolean }): Promise<T | null> => {
    setMutating(true)
    setError(null)
    try {
      const created = await dashboardApi.createRule<T>(type, rule)
      setRules((prev) => [...prev, created])
      return created
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
      return null
    } finally {
      setMutating(false)
    }
  }

  const update = async (id: string, rule: Partial<T> & { readonly status: boolean }): Promise<T | null> => {
    setMutating(true)
    setError(null)
    try {
      const updated = await dashboardApi.updateRule<T>(type, id, rule)
      setRules((prev) => prev.map((r) => (r as { id: string }).id === id ? updated : r))
      return updated
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
      return null
    } finally {
      setMutating(false)
    }
  }

  const remove = async (id: string): Promise<boolean> => {
    setMutating(true)
    setError(null)
    try {
      await dashboardApi.deleteRule(type, id)
      setRules((prev) => prev.filter((r) => (r as { id: string }).id !== id))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      return false
    } finally {
      setMutating(false)
    }
  }

  return { rules, loading, error, mutating, fetch, create, update, remove }
}

// ── Empty / Error / Loading helpers ──

function RuleTableEmpty({ message }: { message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={99} className="py-10 text-center text-sm text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  )
}

function RuleTableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={99} className="py-10 text-center">
        <div className="space-y-2">
          <p className="text-sm text-destructive">{message}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function RuleTableLoading() {
  return (
    <TableRow>
      <TableCell colSpan={99} className="py-10 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </TableCell>
    </TableRow>
  )
}

// ── Rewrite ──

function RewritePage() {
  const { rules, loading, error, mutating, fetch, create, update, remove } = useRulesApi<RewriteRule>('rewrite')
  const [editing, setEditing] = useState<RewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, script: rule.script, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: RewriteRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, script: rule.script, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, script: rule.script, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          使用 DSL 语法修改请求体字段
        </div>
        <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
          <Plus className="mr-2 h-4 w-4" />
          添加规则
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>脚本预览</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <RuleTableLoading />}
            {!loading && error && <RuleTableError message={error} onRetry={fetch} />}
            {!loading && !error && rules.length === 0 && <RuleTableEmpty message='暂无请求改写规则，点击"添加规则"创建第一条' />}
            {!loading && !error && rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {rule.script.slice(0, 50)}
                  {rule.script.length > 50 && '...'}
                </TableCell>
                <TableCell>
                  <Switch checked={rule.status} disabled={mutating} onCheckedChange={() => handleToggle(rule.id)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <RewriteForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RewriteForm({ rule, onSave, onCancel }: { rule: RewriteRule | null; onSave: (r: RewriteRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<RewriteRule>(
    rule || { id: '', name: '', script: '', status: true }
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>名称</Label>
        <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </div>
      <div className="space-y-2">
        <Label>DSL 脚本</Label>
        <Textarea
          value={form.script}
          onChange={(e) => setForm((p) => ({ ...p, script: e.target.value }))}
          placeholder={`SET model = "gpt-4"\nDELETE temperature\nIF model ~ "gpt-*" THEN { SET max_tokens = 4096 }`}
          rows={8}
          className="font-mono text-sm"
        />
        <div className="text-xs text-muted-foreground">
          语法参考：SET field = value | DELETE field | IF cond THEN {'{...}'} | header.X-Name
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.status} onCheckedChange={(v) => setForm((p) => ({ ...p, status: v }))} />
        <Label>启用</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </div>
  )
}

// ── Heartbeat ──

function HeartbeatPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove } = useRulesApi<HeartbeatRule>('heartbeat')
  const [editing, setEditing] = useState<HeartbeatRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, matchCondition: rule.matchCondition, replyContent: rule.replyContent, timeout: rule.timeout, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: HeartbeatRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, matchCondition: rule.matchCondition, replyContent: rule.replyContent, timeout: rule.timeout, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, matchCondition: rule.matchCondition, replyContent: rule.replyContent, timeout: rule.timeout, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          上游无输出超时时自动插入自定义消息
        </div>
        <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
          <Plus className="mr-2 h-4 w-4" />
          添加规则
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>匹配条件</TableHead>
              <TableHead>回复内容</TableHead>
              <TableHead>超时</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <RuleTableLoading />}
            {!loading && error && <RuleTableError message={error} onRetry={fetch} />}
            {!loading && !error && rules.length === 0 && <RuleTableEmpty message='暂无心跳规则，点击"添加规则"创建第一条' />}
            {!loading && !error && rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell className="text-xs">{rule.matchCondition}</TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{rule.replyContent}</TableCell>
                <TableCell className="text-xs">{rule.timeout}s</TableCell>
                <TableCell>
                  <Switch checked={rule.status} disabled={mutating} onCheckedChange={() => handleToggle(rule.id)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <HeartbeatForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HeartbeatForm({ rule, onSave, onCancel }: { rule: HeartbeatRule | null; onSave: (r: HeartbeatRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<HeartbeatRule>(
    rule || { id: '', name: '', matchCondition: '*', replyContent: '', timeout: 30, status: true }
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>名称</Label>
        <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </div>
      <div className="space-y-2">
        <Label>匹配条件 (* 表示全部)</Label>
        <Input value={form.matchCondition} onChange={(e) => setForm((p) => ({ ...p, matchCondition: e.target.value }))} placeholder="*" />
      </div>
      <div className="space-y-2">
        <Label>回复内容</Label>
        <Textarea value={form.replyContent} onChange={(e) => setForm((p) => ({ ...p, replyContent: e.target.value }))} placeholder="连接正常，正在生成内容..." />
      </div>
      <div className="space-y-2">
        <Label>超时时间 (秒)</Label>
        <Input type="number" value={form.timeout} onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) }))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.status} onCheckedChange={(v) => setForm((p) => ({ ...p, status: v }))} />
        <Label>启用</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </div>
  )
}

// ── Concurrency ──

function ConcurrencyPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove } = useRulesApi<ConcurrencyRule>('concurrency')
  const [editing, setEditing] = useState<ConcurrencyRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, scope: rule.scope, maxConcurrent: rule.maxConcurrent, queueEnabled: rule.queueEnabled, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: ConcurrencyRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, scope: rule.scope, maxConcurrent: rule.maxConcurrent, queueEnabled: rule.queueEnabled, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, scope: rule.scope, maxConcurrent: rule.maxConcurrent, queueEnabled: rule.queueEnabled, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          限制并发请求数量，支持排队
        </div>
        <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
          <Plus className="mr-2 h-4 w-4" />
          添加规则
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>作用域</TableHead>
              <TableHead>最大并发</TableHead>
              <TableHead>排队</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <RuleTableLoading />}
            {!loading && error && <RuleTableError message={error} onRetry={fetch} />}
            {!loading && !error && rules.length === 0 && <RuleTableEmpty message='暂无并发规则，点击"添加规则"创建第一条' />}
            {!loading && !error && rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell className="text-xs">
                  {rule.scope === 'global' ? '全局' : rule.scope === 'per_user' ? '每用户' : '每令牌'}
                </TableCell>
                <TableCell className="text-xs">{rule.maxConcurrent}</TableCell>
                <TableCell className="text-xs">{rule.queueEnabled ? '是' : '否'}</TableCell>
                <TableCell>
                  <Switch checked={rule.status} disabled={mutating} onCheckedChange={() => handleToggle(rule.id)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <ConcurrencyForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ConcurrencyForm({ rule, onSave, onCancel }: { rule: ConcurrencyRule | null; onSave: (r: ConcurrencyRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<ConcurrencyRule>(
    rule || { id: '', name: '', scope: 'global', maxConcurrent: 10, queueEnabled: true, status: true }
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>名称</Label>
        <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </div>
      <div className="space-y-2">
        <Label>作用域</Label>
        <select
          value={form.scope}
          onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as typeof p.scope }))}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="global">全局</option>
          <option value="per_user">每用户</option>
          <option value="per_token">每令牌</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label>最大并发数</Label>
        <Input type="number" value={form.maxConcurrent} onChange={(e) => setForm((p) => ({ ...p, maxConcurrent: Number(e.target.value) }))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.queueEnabled} onCheckedChange={(v) => setForm((p) => ({ ...p, queueEnabled: v }))} />
        <Label>允许排队</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.status} onCheckedChange={(v) => setForm((p) => ({ ...p, status: v }))} />
        <Label>启用</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </div>
  )
}

// ── Failover ──

function FailoverPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove } = useRulesApi<FailoverRule>('failover')
  const [editing, setEditing] = useState<FailoverRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, primaryChannel: rule.primaryChannel, fallbackChannel: rule.fallbackChannel, condition: rule.condition, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: FailoverRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, primaryChannel: rule.primaryChannel, fallbackChannel: rule.fallbackChannel, condition: rule.condition, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, primaryChannel: rule.primaryChannel, fallbackChannel: rule.fallbackChannel, condition: rule.condition, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          主渠道失败时自动切换到备选渠道
        </div>
        <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
          <Plus className="mr-2 h-4 w-4" />
          添加规则
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>主渠道</TableHead>
              <TableHead>备选</TableHead>
              <TableHead>触发条件</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <RuleTableLoading />}
            {!loading && error && <RuleTableError message={error} onRetry={fetch} />}
            {!loading && !error && rules.length === 0 && <RuleTableEmpty message='暂无故障转移规则，点击"添加规则"创建第一条' />}
            {!loading && !error && rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell className="text-xs">{rule.primaryChannel}</TableCell>
                <TableCell className="text-xs">{rule.fallbackChannel}</TableCell>
                <TableCell className="text-xs">
                  {rule.condition === 'timeout' ? '超时' : rule.condition === 'error' ? '错误' : '限流'}
                </TableCell>
                <TableCell>
                  <Switch checked={rule.status} disabled={mutating} onCheckedChange={() => handleToggle(rule.id)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <FailoverForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FailoverForm({ rule, onSave, onCancel }: { rule: FailoverRule | null; onSave: (r: FailoverRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<FailoverRule>(
    rule || { id: '', name: '', primaryChannel: '', fallbackChannel: '', condition: 'timeout', status: true }
  )

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>名称</Label>
        <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </div>
      <div className="space-y-2">
        <Label>主渠道</Label>
        <Input value={form.primaryChannel} onChange={(e) => setForm((p) => ({ ...p, primaryChannel: e.target.value }))} placeholder="OpenAI" />
      </div>
      <div className="space-y-2">
        <Label>备选渠道</Label>
        <Input value={form.fallbackChannel} onChange={(e) => setForm((p) => ({ ...p, fallbackChannel: e.target.value }))} placeholder="Anthropic" />
      </div>
      <div className="space-y-2">
        <Label>触发条件</Label>
        <select
          value={form.condition}
          onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value as typeof p.condition }))}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="timeout">超时</option>
          <option value="error">错误</option>
          <option value="rate_limit">限流</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.status} onCheckedChange={(v) => setForm((p) => ({ ...p, status: v }))} />
        <Label>启用</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </div>
  )
}
