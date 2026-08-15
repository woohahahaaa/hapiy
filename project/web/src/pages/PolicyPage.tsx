import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'



import { Switch } from '@/components/ui/switch'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { dashboardApi,
  type RewriteRule,
  type HeartbeatRule,
  type ConcurrencyRule,
  type FailoverRule,
  type ResponseRewriteRule,
  type RuleType,
} from '@/lib/dashboard-api'
import { RewriteTestDialog } from '@/components/RewriteTestDialog'
import { RewriteRuleEditor, GjsonPathHelp, parseRule, isActionValid } from '@/components/rewrite-rule-editor'
import { RewriteResponseForm } from '@/components/response-rewrite-editor'

const KNOWN_RULE_TYPES: readonly RuleType[] = [
  'rewrite',
  'heartbeat',
  'concurrency',
  'failover',
  'rewrite-response',
]

function RewriteRulePreview({ script }: { script: string }) {
  const form = useMemo(() => parseRule(script), [script])
  const ruleCount = form.blocks.length
  const actionCount = form.blocks.reduce((sum, b) => sum + b.actions.filter(isActionValid).length, 0)

  if (ruleCount === 0 || actionCount === 0) {
    return <span className="text-xs text-muted-foreground">无操作</span>
  }

  return (
    <span className="text-xs text-muted-foreground">
      {ruleCount} 规则 · {actionCount} 执行
    </span>
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
            <AppIcon name="warning" size={32} className="text-destructive" />
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
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)

  const fetch = useCallback(async (specificOffset?: number, specificLimit?: number) => {
    const useOffset = specificOffset ?? offset
    const useLimit = specificLimit ?? limit
    setLoading(true)
    setError(null)
    try {
      const result = await dashboardApi.listRules<T>(type, { limit: useLimit, offset: useOffset })
      setRules(result.rules)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [type, offset, limit])

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

  return { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit }
}

// ── Empty / Error / Loading helpers ──

function RuleStatusBadge({ active }: { active: boolean }) {
  return <span className={active ? 'text-success' : 'text-destructive'}>{active ? '启用' : '禁用'}</span>
}

function RuleToggleButton({ active, disabled, onClick }: { active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      {active ? '禁用' : '启用'}
    </Button>
  )
}


// ── Rewrite ──

function RewritePage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<RewriteRule>('rewrite')
  const [editing, setEditing] = useState<RewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)

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

  const columns: ColumnDef<RewriteRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'script',
      label: '规则预览',
      defaultWidth: { kind: 'percent', value: 30 },
      render: (_, row) => <RewriteRulePreview script={row.script} />,
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <RuleStatusBadge active={row.status} />,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <RuleToggleButton active={row.status} disabled={mutating} onClick={() => handleToggle(row.id)} />
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(row.id)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="请求改写"
        description="使用 JSON 操作数组修改请求体字段"
        status={`${total} 条规则`}
      />
      <div className="p-6">
        <DataTable
          id="policy-rewrite"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText='暂无请求改写规则，点击"添加规则"创建第一条'
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加规则
              </Button>
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={mutating}>
                <AppIcon name="play" data-icon="inline-start" />测试
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <RewriteForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
        </DialogContent>
      </Dialog>

{testOpen && (
<RewriteTestDialog
        open={testOpen}
        onClose={() => { setTestOpen(false); }}
        rules={rules}
        type="rewrite"
        preselectedRuleId={null}
        showSelector={true}
        width="full"
        height="full"
      />
      )}
    </div>
  )
}

function RewriteForm({ rule, onSave, onCancel, saving }: { rule: RewriteRule | null; onSave: (r: RewriteRule) => void; onCancel: () => void; saving: boolean }) {
  const [form, setForm] = useState<RewriteRule>(
    rule || { id: '', name: '', script: '[]', status: true }
  )

  const formKey = rule?.id ?? 'new'

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="rewrite-name">名称</FieldLabel>
        <Input id="rewrite-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>
      <Field>
        <FieldLabel>改写规则</FieldLabel>
        <RewriteRuleEditor
          key={formKey}
          initialScript={form.script}
          onScriptChange={(next) => setForm((p) => ({ ...p, script: next }))}
        />
      </Field>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <GjsonPathHelp />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button disabled={saving || !form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>{saving ? '保存中...' : '保存'}</Button>
        </div>
      </div>
    </FieldGroup>
  )
}

// ── Heartbeat ──

function HeartbeatPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<HeartbeatRule>('heartbeat')
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

  const columns: ColumnDef<HeartbeatRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    { key: 'matchCondition', label: '匹配条件', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="text-xs">{row.matchCondition}</span> },
    {
      key: 'replyContent',
      label: '回复内容',
      defaultWidth: { kind: 'percent', value: 20 },
      defaultOverflow: 'wrap',
      render: (_, row) => <span className="text-xs max-w-[200px] truncate">{row.replyContent}</span>,
    },
    { key: 'timeout', label: '超时', defaultWidth: { kind: 'pixel', value: 80 }, defaultAlign: 'right', render: (_, row) => <span className="text-xs">{row.timeout}s</span> },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <RuleStatusBadge active={row.status} />,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <RuleToggleButton active={row.status} disabled={mutating} onClick={() => handleToggle(row.id)} />
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(row.id)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="心跳回复"
        description="上游无输出超时时自动插入自定义消息"
        status={`${total} 条规则`}
      />
      <div className="p-6">
        <DataTable
          id="policy-heartbeat"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText='暂无心跳规则，点击"添加规则"创建第一条'
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加规则
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <HeartbeatForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
        </DialogContent>
</Dialog>
    </div>
  )
}

function HeartbeatForm({ rule, onSave, onCancel, saving }: { rule: HeartbeatRule | null; onSave: (r: HeartbeatRule) => void; onCancel: () => void; saving: boolean }) {
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
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={saving} onClick={() => onSave(form)}>{saving ? '保存中...' : '保存'}</Button>
      </DialogFooter>
    </FieldGroup>
  )
}

// ── Concurrency ──

function ConcurrencyPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<ConcurrencyRule>('concurrency')
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

  const scopeLabel = (scope: ConcurrencyRule['scope']) =>
    scope === 'global' ? '全局' : scope === 'per_user' ? '每用户' : '每令牌'

  const columns: ColumnDef<ConcurrencyRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    { key: 'scope', label: '作用域', defaultWidth: { kind: 'pixel', value: 100 }, render: (_, row) => <span className="text-xs">{scopeLabel(row.scope)}</span> },
    { key: 'maxConcurrent', label: '最大并发', defaultWidth: { kind: 'pixel', value: 100 }, defaultAlign: 'right', render: (_, row) => <span className="text-xs">{row.maxConcurrent}</span> },
    { key: 'queueEnabled', label: '排队', defaultWidth: { kind: 'pixel', value: 80 }, render: (_, row) => <span className="text-xs">{row.queueEnabled ? '是' : '否'}</span> },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <RuleStatusBadge active={row.status} />,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <RuleToggleButton active={row.status} disabled={mutating} onClick={() => handleToggle(row.id)} />
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(row.id)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="并发控制"
        description="限制并发请求数量，支持排队"
        status={`${total} 条规则`}
      />
      <div className="p-6">
        <DataTable
          id="policy-concurrency"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText='暂无并发规则，点击"添加规则"创建第一条'
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加规则
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <ConcurrencyForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
        </DialogContent>
</Dialog>
    </div>
  )
}

function ConcurrencyForm({ rule, onSave, onCancel, saving }: { rule: ConcurrencyRule | null; onSave: (r: ConcurrencyRule) => void; onCancel: () => void; saving: boolean }) {
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
          <span className={form.queueEnabled ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{form.queueEnabled ? '已开启' : '已关闭'}</span>
          <Switch checked={form.queueEnabled} onCheckedChange={(v) => setForm((p) => ({ ...p, queueEnabled: v }))} />
        </div>
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={saving} onClick={() => onSave(form)}>{saving ? '保存中...' : '保存'}</Button>
      </DialogFooter>
    </FieldGroup>
  )
}

// ── Failover ──

function FailoverPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<FailoverRule>('failover')
  const [editing, setEditing] = useState<FailoverRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)

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

  const conditionLabel = (c: FailoverRule['condition']) =>
    c === 'timeout' ? '超时' : c === 'error' ? '错误' : '限流'

  const columns: ColumnDef<FailoverRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    { key: 'primaryProvider', label: '主供应商', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="text-xs">{row.primaryProvider}</span> },
    { key: 'fallbackProvider', label: '备选', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="text-xs">{row.fallbackProvider}</span> },
    { key: 'condition', label: '触发条件', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, row) => <span className="text-xs">{conditionLabel(row.condition)}</span> },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <RuleStatusBadge active={row.status} />,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <RuleToggleButton active={row.status} disabled={mutating} onClick={() => handleToggle(row.id)} />
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(row.id)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="故障转移"
        description="主供应商失败时自动切换到备选供应商"
        status={`${total} 条规则`}
      />
      <div className="p-6">
        <DataTable
          id="policy-failover"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText='暂无故障转移规则，点击"添加规则"创建第一条'
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加规则
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <FailoverForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
        </DialogContent>
</Dialog>
    </div>
  )
}

function FailoverForm({ rule, onSave, onCancel, saving }: { rule: FailoverRule | null; onSave: (r: FailoverRule) => void; onCancel: () => void; saving: boolean }) {
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
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button disabled={saving} onClick={() => onSave(form)}>{saving ? '保存中...' : '保存'}</Button>
      </DialogFooter>
    </FieldGroup>
  )
}

// ── Response Rewrite ──

function RewriteResponsePage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<ResponseRewriteRule>('rewrite-response')
  const [editing, setEditing] = useState<ResponseRewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)

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

  const columns: ColumnDef<ResponseRewriteRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'script',
      label: '规则预览',
      defaultWidth: { kind: 'percent', value: 30 },
      render: (_, row) => <RewriteRulePreview script={row.script} />,
    },
    {
      key: 'status',
      label: '状态',
      defaultWidth: { kind: 'pixel', value: 100 },
      render: (_, row) => <RuleStatusBadge active={row.status} />,
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <RuleToggleButton active={row.status} disabled={mutating} onClick={() => handleToggle(row.id)} />
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => handleDelete(row.id)}>
            <AppIcon name="delete" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="响应改写"
        description="按顺序对响应字段执行：重命名 / 加前缀 / 加后缀 / 删除"
        status={`${total} 条规则`}
      />
      <div className="p-6">
        <DataTable
          id="policy-rewrite-response"
          columns={columns}
          data={rules}
          total={total}
          loading={loading}
          error={error}
          offset={offset}
          limit={limit}
          onOffsetChange={setOffset}
          onLimitChange={setLimit}
          emptyText='暂无响应改写规则，点击"添加规则"创建第一条'
          onRetry={() => void fetch()}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => { setEditing(null); setIsOpen(true); }} disabled={mutating}>
                <AppIcon name="add" data-icon="inline-start" />
                添加规则
              </Button>
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={mutating}>
                <AppIcon name="play" data-icon="inline-start" />测试
              </Button>
            </div>
          }
        />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <RewriteResponseForm rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); }} saving={mutating} />
        </DialogContent>
      </Dialog>

      {testOpen && (
        <RewriteTestDialog
          open={testOpen}
          onClose={() => { setTestOpen(false); }}
          rules={rules}
          type="rewrite-response"
          preselectedRuleId={null}
          showSelector={true}
          width="full"
          height="full"
        />
      )}
    </div>
  )
}


