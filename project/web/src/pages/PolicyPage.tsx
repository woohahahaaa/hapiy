import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Loader2, Code, AlertTriangle, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { JsonEditModal, parseJsonEditorArray, type JsonEditorIdMap } from '@/components/JsonEditModal'
import { Badge } from '@/components/ui/badge'
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  dashboardApi,
  type RewriteRule,
  type HeartbeatRule,
  type ConcurrencyRule,
  type FailoverRule,
  type ResponseRewriteRule,
  type RuleType,
} from '@/lib/dashboard-api'

const KNOWN_RULE_TYPES: readonly RuleType[] = [
  'rewrite',
  'heartbeat',
  'concurrency',
  'failover',
  'rewrite-response',
]

const REWRITE_OPS_DOC_URL = 'https://github.com/woohahahaaa/hapiy/blob/main/project/docs/rewrite-ops.md'

function RewriteScriptHint() {
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>JSON 数组格式，每项含 path/mode/value 等字段</span>
      <a href={REWRITE_OPS_DOC_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
        语法文档 <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  )
}

export function PolicyPage() {
  const { type } = useParams<{ type: string }>()
  const activeTab = (type || 'rewrite') as RuleType

  if (type !== undefined && !KNOWN_RULE_TYPES.includes(activeTab)) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="未知策略类型" />
        <div className="flex-1 p-6">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-border bg-card p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">该策略类型不存在</p>
              <p className="text-xs text-muted-foreground">
                可用的策略类型：{KNOWN_RULE_TYPES.join('、')}
              </p>
            </div>
            <Link to="/policy/rewrite" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              返回请求改写
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {activeTab === 'rewrite' && <RewritePage />}
      {activeTab === 'heartbeat' && <HeartbeatPage />}
      {activeTab === 'concurrency' && <ConcurrencyPage />}
      {activeTab === 'failover' && <FailoverPage />}
      {activeTab === 'rewrite-response' && <RewriteResponsePage />}
    </>
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

  return { rules, loading, error, mutating, setMutating, fetch, create, update, remove }
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

function RuleStatusBadge({ active }: { active: boolean }) {
  return <span className={active ? '' : 'text-muted-foreground'}>{active ? '启用' : '禁用'}</span>
}

function RuleToggleButton({ active, disabled, onClick }: { active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      {active ? '禁用' : '启用'}
    </Button>
  )
}

function RuleTableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={99} className="py-10 text-center">
        <div className="flex flex-col gap-2">
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

// ── Diff-based JSON save helper ──

async function diffAndSave<T extends { id: string; status: boolean }>(
  data: unknown,
  rules: readonly T[],
  type: RuleType,
  fetch: () => Promise<void>,
  setMutating: (v: boolean) => void,
  idMap: JsonEditorIdMap,
) {
  setMutating(true)
  try {
    const parsed = parseJsonEditorArray<T>(data)
    const currentMap = new Map(rules.map((r) => [r.id, r]))
    const retainedIds = new Set<string>()
    const ops: Promise<unknown>[] = []

    for (const item of parsed) {
      const id = idMap.get(item.id)
      if (id && currentMap.has(id)) {
        retainedIds.add(id)
        const { id: _editorId, ...edited } = item
        const currentRecord = currentMap.get(id)
        if (!currentRecord) continue
        const { id: _backendId, ...current } = currentRecord
        if (JSON.stringify(edited) !== JSON.stringify(current)) {
          ops.push(dashboardApi.updateRule(type, id, { ...edited, status: item.status }))
        }
      } else {
        const { id: _editorId, ...created } = item
        ops.push(dashboardApi.createRule(type, { ...created, status: item.status }))
      }
    }

    for (const id of currentMap.keys()) {
      if (!retainedIds.has(id)) {
        ops.push(dashboardApi.deleteRule(type, id))
      }
    }

    const results = await Promise.allSettled(ops)
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    await fetch()
    if (failures.length > 0) {
      throw new Error(`${failures.length} 项保存失败`)
    }
  } finally {
    setMutating(false)
  }
}

// ── Rewrite ──

function RewritePage() {
  const { rules, loading, error, mutating, setMutating, fetch, create, update, remove } = useRulesApi<RewriteRule>('rewrite')
  const [editing, setEditing] = useState<RewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

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

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    await diffAndSave(data, rules, 'rewrite', fetch, setMutating, idMap)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="请求改写" status={`${rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            使用 JSON 操作数组修改请求体字段
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
              <Code data-icon="inline-start" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border">
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
                  <TableCell><RuleStatusBadge active={rule.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RuleToggleButton active={rule.status} disabled={mutating} onClick={() => handleToggle(rule.id)} />
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <RewriteForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>

      {jsonOpen && (
        <JsonEditModal
          data={rules}
          onSave={handleJsonSave}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  )
}

function RewriteForm({ rule, onSave, onCancel }: { rule: RewriteRule | null; onSave: (r: RewriteRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<RewriteRule>(
    rule || { id: '', name: '', script: '', status: true }
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="rewrite-name">名称</FieldLabel>
        <Input id="rewrite-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel htmlFor="rewrite-script">改写脚本</FieldLabel>
        <Textarea
          id="rewrite-script"
          value={form.script}
          onChange={(e) => setForm((p) => ({ ...p, script: e.target.value }))}
          placeholder={`[{"path":"model","mode":"set","value":"gpt-4"}]`}
          rows={8}
          className="font-mono text-sm"
        />
        <RewriteScriptHint />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </FieldGroup>
  )
}

// ── Heartbeat ──

function HeartbeatPage() {
  const { rules, loading, error, mutating, setMutating, fetch, create, update, remove } = useRulesApi<HeartbeatRule>('heartbeat')
  const [editing, setEditing] = useState<HeartbeatRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

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

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    await diffAndSave(data, rules, 'heartbeat', fetch, setMutating, idMap)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="心跳回复" status={`${rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            上游无输出超时时自动插入自定义消息
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
              <Code data-icon="inline-start" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border">
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
                  <TableCell><RuleStatusBadge active={rule.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RuleToggleButton active={rule.status} disabled={mutating} onClick={() => handleToggle(rule.id)} />
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <HeartbeatForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>

      {jsonOpen && (
        <JsonEditModal
          data={rules}
          onSave={handleJsonSave}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  )
}

function HeartbeatForm({ rule, onSave, onCancel }: { rule: HeartbeatRule | null; onSave: (r: HeartbeatRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<HeartbeatRule>(
    rule || { id: '', name: '', matchCondition: '*', replyContent: '', timeout: 30, status: true }
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="heartbeat-name">名称</FieldLabel>
        <Input id="heartbeat-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel htmlFor="heartbeat-match">匹配条件 (* 表示全部)</FieldLabel>
        <Input id="heartbeat-match" value={form.matchCondition} onChange={(e) => setForm((p) => ({ ...p, matchCondition: e.target.value }))} placeholder="*" />
      </Field>
      <Field>
        <FieldLabel htmlFor="heartbeat-reply">回复内容</FieldLabel>
        <Textarea id="heartbeat-reply" value={form.replyContent} onChange={(e) => setForm((p) => ({ ...p, replyContent: e.target.value }))} placeholder="连接正常，正在生成内容..." />
      </Field>
      <Field>
        <FieldLabel htmlFor="heartbeat-timeout">超时时间 (秒)</FieldLabel>
        <Input id="heartbeat-timeout" type="number" value={form.timeout} onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) }))} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </FieldGroup>
  )
}

// ── Concurrency ──

function ConcurrencyPage() {
  const { rules, loading, error, mutating, setMutating, fetch, create, update, remove } = useRulesApi<ConcurrencyRule>('concurrency')
  const [editing, setEditing] = useState<ConcurrencyRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

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

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    await diffAndSave(data, rules, 'concurrency', fetch, setMutating, idMap)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="并发控制" status={`${rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            限制并发请求数量，支持排队
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
              <Code data-icon="inline-start" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border">
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
                  <TableCell><RuleStatusBadge active={rule.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RuleToggleButton active={rule.status} disabled={mutating} onClick={() => handleToggle(rule.id)} />
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <ConcurrencyForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>

      {jsonOpen && (
        <JsonEditModal
          data={rules}
          onSave={handleJsonSave}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  )
}

function ConcurrencyForm({ rule, onSave, onCancel }: { rule: ConcurrencyRule | null; onSave: (r: ConcurrencyRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<ConcurrencyRule>(
    rule || { id: '', name: '', scope: 'global', maxConcurrent: 10, queueEnabled: true, status: true }
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="concurrency-name">名称</FieldLabel>
        <Input id="concurrency-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel htmlFor="concurrency-scope">作用域</FieldLabel>
        <Select
          value={form.scope}
          onValueChange={(value) => setForm((p) => ({ ...p, scope: value as typeof p.scope }))}
        >
          <SelectTrigger id="concurrency-scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="global">全局</SelectItem>
              <SelectItem value="per_user">每用户</SelectItem>
              <SelectItem value="per_token">每令牌</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="concurrency-max">最大并发数</FieldLabel>
        <Input id="concurrency-max" type="number" value={form.maxConcurrent} onChange={(e) => setForm((p) => ({ ...p, maxConcurrent: Number(e.target.value) }))} />
      </Field>
      <Field orientation="horizontal" className="items-center justify-between rounded-md border border-border px-3 py-2">
        <FieldLabel>允许排队</FieldLabel>
        <div className="flex items-center gap-1.5">
          <Badge variant={form.queueEnabled ? 'default' : 'secondary'}>{form.queueEnabled ? '已开启' : '已关闭'}</Badge>
          <Switch checked={form.queueEnabled} onCheckedChange={(v) => setForm((p) => ({ ...p, queueEnabled: v }))} />
        </div>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </FieldGroup>
  )
}

// ── Failover ──

function FailoverPage() {
  const { rules, loading, error, mutating, setMutating, fetch, create, update, remove } = useRulesApi<FailoverRule>('failover')
  const [editing, setEditing] = useState<FailoverRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, primaryProvider: rule.primaryProvider, fallbackProvider: rule.fallbackProvider, condition: rule.condition, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: FailoverRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, primaryProvider: rule.primaryProvider, fallbackProvider: rule.fallbackProvider, condition: rule.condition, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, primaryProvider: rule.primaryProvider, fallbackProvider: rule.fallbackProvider, condition: rule.condition, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    await diffAndSave(data, rules, 'failover', fetch, setMutating, idMap)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="故障转移" status={`${rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            主供应商失败时自动切换到备选供应商
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
              <Code data-icon="inline-start" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>主供应商</TableHead>
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
                  <TableCell className="text-xs">{rule.primaryProvider}</TableCell>
                  <TableCell className="text-xs">{rule.fallbackProvider}</TableCell>
                  <TableCell className="text-xs">
                    {rule.condition === 'timeout' ? '超时' : rule.condition === 'error' ? '错误' : '限流'}
                  </TableCell>
                  <TableCell><RuleStatusBadge active={rule.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RuleToggleButton active={rule.status} disabled={mutating} onClick={() => handleToggle(rule.id)} />
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <FailoverForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>

      {jsonOpen && (
        <JsonEditModal
          data={rules}
          onSave={handleJsonSave}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  )
}

function FailoverForm({ rule, onSave, onCancel }: { rule: FailoverRule | null; onSave: (r: FailoverRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<FailoverRule>(
    rule || { id: '', name: '', primaryProvider: '', fallbackProvider: '', condition: 'timeout', status: true }
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="failover-name">名称</FieldLabel>
        <Input id="failover-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel htmlFor="failover-primary">主供应商</FieldLabel>
        <Input id="failover-primary" value={form.primaryProvider} onChange={(e) => setForm((p) => ({ ...p, primaryProvider: e.target.value }))} placeholder="OpenAI" />
      </Field>
      <Field>
        <FieldLabel htmlFor="failover-fallback">备选供应商</FieldLabel>
        <Input id="failover-fallback" value={form.fallbackProvider} onChange={(e) => setForm((p) => ({ ...p, fallbackProvider: e.target.value }))} placeholder="Anthropic" />
      </Field>
      <Field>
        <FieldLabel htmlFor="failover-condition">触发条件</FieldLabel>
        <Select
          value={form.condition}
          onValueChange={(value) => setForm((p) => ({ ...p, condition: value as typeof p.condition }))}
        >
          <SelectTrigger id="failover-condition" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="timeout">超时</SelectItem>
              <SelectItem value="error">错误</SelectItem>
              <SelectItem value="rate_limit">限流</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={() => onSave(form)}>保存</Button>
      </div>
    </FieldGroup>
  )
}

// ── Response Rewrite ──

function RewriteResponsePage() {
  const { rules, loading, error, mutating, setMutating, fetch, create, update, remove } = useRulesApi<ResponseRewriteRule>('rewrite-response')
  const [editing, setEditing] = useState<ResponseRewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const handleToggle = async (id: string) => {
    const rule = rules.find((r) => r.id === id)
    if (!rule || mutating) return
    await update(id, { name: rule.name, script: rule.script, status: !rule.status })
  }

  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: ResponseRewriteRule) => {
    if (editing) {
      const result = await update(rule.id, { name: rule.name, script: rule.script, status: rule.status })
      if (result) { setEditing(null); setIsOpen(false) }
    } else {
      const result = await create({ name: rule.name, script: rule.script, status: rule.status })
      if (result) { setIsOpen(false) }
    }
  }

  const handleJsonSave = async (data: unknown, idMap: JsonEditorIdMap) => {
    await diffAndSave(data, rules, 'rewrite-response', fetch, setMutating, idMap)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="响应改写" status={`${rules.length} 条规则`} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            使用 JSON 操作数组修改响应体字段
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setJsonOpen(true)} disabled={mutating}>
              <Code data-icon="inline-start" />编辑 JSON
            </Button>
            <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
              <Plus data-icon="inline-start" />
              添加规则
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border">
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
              {!loading && !error && rules.length === 0 && <RuleTableEmpty message='暂无响应改写规则，点击"添加规则"创建第一条' />}
              {!loading && !error && rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {rule.script.slice(0, 50)}
                    {rule.script.length > 50 && '...'}
                  </TableCell>
                  <TableCell><RuleStatusBadge active={rule.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <RuleToggleButton active={rule.status} disabled={mutating} onClick={() => handleToggle(rule.id)} />
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(rule); setIsOpen(true); }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(rule.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <RewriteResponseForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} />
        </DialogContent>
      </Dialog>

      {jsonOpen && (
        <JsonEditModal
          data={rules}
          onSave={handleJsonSave}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </div>
  )
}

function RewriteResponseForm({ rule, onSave, onCancel }: { rule: ResponseRewriteRule | null; onSave: (r: ResponseRewriteRule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<ResponseRewriteRule>(
    rule || { id: '', name: '', script: '', status: true }
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="rr-name">名称</FieldLabel>
        <Input id="rr-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel htmlFor="rr-script">改写脚本</FieldLabel>
        <Textarea
          id="rr-script"
          value={form.script}
          onChange={(e) => setForm((p) => ({ ...p, script: e.target.value }))}
          placeholder={`[{"path":"body.name","mode":"set","value":"updated"}]`}
          rows={8}
          className="font-mono text-sm"
        />
        <RewriteScriptHint />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={!form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>保存</Button>
      </div>
    </FieldGroup>
  )
}
