import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { AppIcon } from '@/components/AppIcon'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { DataTable, type ColumnDef } from '@/components/data-table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ConfirmDeleteDialog } from '@/pages/AgentConfigPage'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { dashboardApi,
  type RewriteRule,
  type FailoverRule,
  type ResponseRewriteRule,
  type RuleType,
} from '@/lib/dashboard-api'
import { RewriteTestDialog } from '@/components/RewriteTestDialog'
import { RewriteRuleEditor, GjsonPathHelp, parseRule, isActionValid } from '@/components/rewrite-rule-editor'
import { RewriteResponseForm } from '@/components/response-rewrite-editor'
import { RecoverySettings } from '@/pages/RecoverySettings'

const KNOWN_RULE_TYPES: readonly RuleType[] = [
  'rewrite',
  'failover',
  'rewrite-response',
]

function RewriteRulePreview({ script }: { script: string }) {
  const form = useMemo(() => parseRule(script), [script])
  const ruleCount = form.blocks.length
  const actionCount = form.blocks.reduce((sum, b) => sum + b.actions.filter(isActionValid).length, 0)

  if (ruleCount === 0 || actionCount === 0) {
    return <span className="text-xs">无操作</span>
  }

  return (
    <span className="text-xs">
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
  const [limit, setLimit] = useState(50)
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


// ── Rewrite ──

function RewritePage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<RewriteRule>('rewrite')
  const [editing, setEditing] = useState<RewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [deleting, setDeleting] = useState<RewriteRule | null>(null)

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
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
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
        <DialogContent width="md" scrollFooter>
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

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="确认删除"
        description={`将删除规则「${deleting?.name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}

function RewriteForm({ rule, onSave, onCancel, saving }: { rule: RewriteRule | null; onSave: (r: RewriteRule) => void; onCancel: () => void; saving: boolean }) {
  const [form, setForm] = useState<RewriteRule>(
    rule || { id: '', name: '', script: '[]', status: true }
  )

  const formKey = rule?.id ?? 'new'

  return (
    <DialogScrollBody footer={
      <>
        <div className="flex w-full items-center justify-between gap-2">
          <GjsonPathHelp />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>取消</Button>
            <Button disabled={saving || !form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim() })}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </>
    }>
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
      </FieldGroup>
    </DialogScrollBody>
  )
}

// ── Failover ──

function FailoverPage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<FailoverRule>('failover')
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<FailoverRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [deleting, setDeleting] = useState<FailoverRule | null>(null)

  const clearEditQuery = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    const rule = rules.find((candidate) => candidate.id === editId)
    if (!rule) return
    setEditing(rule)
    setIsOpen(true)
  }, [rules, searchParams])


  const handleDelete = async (id: string) => {
    if (mutating) return
    await remove(id)
  }

  const handleSave = async (rule: FailoverRule) => {
    if (editing) {
      const result = await update(rule.id, rule)
      if (result) { setEditing(null); setIsOpen(false); clearEditQuery() }
    } else {
      const result = await create(rule)
      if (result) { setIsOpen(false) }
    }
  }

  const columns: ColumnDef<FailoverRule>[] = [
    { key: 'name', label: '名称', defaultWidth: { kind: 'pixel', value: 160 }, render: (_, row) => <span className="font-medium">{row.name}</span> },
    { key: 'dimension', label: '转移维度', defaultWidth: { kind: 'pixel', value: 120 }, render: (_, row) => <span className="text-xs">{row.dimension ? failoverDimensionLabel(row.dimension) : '—'}</span> },
    {
      key: 'matchPatterns',
      label: '触发字段',
      defaultWidth: { kind: 'percent', value: 25 },
      render: (_, row) => {
        const patterns = row.matchPatterns ?? []
        if (patterns.length === 0) return <span className="text-xs text-muted-foreground">未设置</span>
        const head = patterns.slice(0, 3).join('、')
        const more = patterns.length > 3 ? ` …+${patterns.length - 3}` : ''
        return <span className="text-xs" title={patterns.join('\n')}>{head}{more}</span>
      },
    },
    { key: 'ttfbSeconds', label: '首字超时', defaultWidth: { kind: 'pixel', value: 100 }, defaultAlign: 'right', render: (_, row) => <span className="text-xs">{row.ttfbSeconds > 0 ? `${row.ttfbSeconds}s` : '未启用'}</span> },
    {
      key: 'disableThreshold',
      label: '禁用阈值',
      defaultWidth: { kind: 'pixel', value: 180 },
      render: (_, row) => {
        const threshold = row.disableThreshold >= 1 ? row.disableThreshold : 1
        const window = row.disableWindowMinutes ?? 0
        const winText = window === 0 ? '不限' : `${window}分钟`
        return <span className="text-xs">{threshold} 次 / {winText}</span>
      },
    },
    {
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
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
        description="主供应商失败时自动转移到备选供应商"
      />
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <Tabs defaultValue="failover" className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="mb-5 !h-[50px] w-full justify-start gap-6 border-b border-border p-0">
            <TabsTrigger value="failover" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">故障转移</TabsTrigger>
            <TabsTrigger value="recovery" className="-mb-px !h-[50px] flex-none !border-x-0 !border-t-0 !border-b-2 border-transparent px-0 text-sm font-medium after:hidden data-[state=active]:!border-primary data-[state=active]:!text-primary">自动恢复</TabsTrigger>
          </TabsList>
          <TabsContent value="failover" className="flex min-h-0 flex-1 flex-col">
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
          </TabsContent>
          <TabsContent value="recovery" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <RecoverySettings />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) { setEditing(null); clearEditQuery() } }}>
          <DialogContent width="md" scrollFooter>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '添加规则'}</DialogTitle>
          </DialogHeader>
          <FailoverForm key={editing?.id ?? 'new'} rule={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsOpen(false); clearEditQuery() }} saving={mutating} />
        </DialogContent>
</Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="确认删除"
        description={`将删除规则「${deleting?.name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}

const FAILOVER_DIMENSIONS = [
  { value: 'base_url', label: 'Base URL' },
  { value: 'key', label: 'Key' },
  { value: 'provider', label: '供应商' },
] as const

function failoverDimensionLabel(dimension: FailoverRule['dimension']): string {
  if (dimension === 'base_url') return 'Base URL'
  if (dimension === 'key') return 'Key'
  if (dimension === 'provider') return '供应商'
  return '未选择'
}

function FailoverForm({ rule, onSave, onCancel, saving }: { rule: FailoverRule | null; onSave: (r: FailoverRule) => void; onCancel: () => void; saving: boolean }) {
  const initial: FailoverRule = rule ? {
    ...rule,
    disableThreshold: rule.disableThreshold >= 1 ? rule.disableThreshold : 1,
  } : {
    id: '',
    name: '',
    primaryProvider: '',
    fallbackProvider: '',
    condition: 'error',
    status: true,
    keywords: [],
    actions: [],
    dimension: 'base_url',
    autoDisable: true,
    matchPatterns: [],
    ttfbSeconds: 0,
    speedLimit: 0,
    disableThreshold: 1,
    disableWindowMinutes: 5,
  }
  const [form, setForm] = useState<FailoverRule>(initial)
  const [matchPatterns, setMatchPatterns] = useState(() => (rule?.matchPatterns ?? []).join('\n'))

  return (
    <DialogScrollBody footer={
      <>
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button
          disabled={saving || !form.name.trim() || !form.dimension}
          onClick={() =>
            onSave({
              ...form,
              name: form.name.trim(),
              matchPatterns: matchPatterns.split('\n').map((s) => s.trim()).filter(Boolean),
            })
          }
        >
          {saving ? '保存中...' : '保存'}
        </Button>
      </>
    }>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="failover-name">名称</FieldLabel>
        <Input id="failover-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="规则名称" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="failover-dimension">转移维度</FieldLabel>
          <div className="flex items-center gap-4">
            <Select value={form.dimension || 'base_url'} onValueChange={(value) => setForm((p) => ({ ...p, dimension: value as FailoverRule['dimension'] }))}>
              <SelectTrigger id="failover-dimension" className="w-full">
                <SelectValue placeholder="选择转移维度" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FAILOVER_DIMENSIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">请求失败时，将按该维度进行故障转移。</p>
        </Field>

        <Field>
          <FieldLabel htmlFor="failover-auto-disable">自动禁用</FieldLabel>
          <div className="flex items-center gap-4">
            <Select value={form.autoDisable ? 'yes' : 'no'} onValueChange={(value) => setForm((p) => ({ ...p, autoDisable: value === 'yes' }))}>
              <SelectTrigger id="failover-auto-disable" className="w-full">
                <SelectValue placeholder="是否自动禁用" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="yes">是</SelectItem>
                  <SelectItem value="no">否</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            选「是」：转移候选用尽后，将出问题的
            {form.dimension === 'key' ? 'Key' : form.dimension === 'provider' ? '供应商' : 'BaseURL'}
            标记为禁用（受下方禁用阈值约束）。
          </p>
          <p className="text-xs text-muted-foreground">选「否」：每次只转移到下一个候选，不会自动禁用。</p>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="failover-patterns">上游报错字段包含以下关键词时自动触发</FieldLabel>
        <Textarea id="failover-patterns" value={matchPatterns} onChange={(event) => setMatchPatterns(event.target.value)} placeholder={'每行一个关键词或错误码\n429\nrate_limit_exceeded\ninsufficient_quota'} rows={4} />
        <p className="text-xs text-muted-foreground">每行一个；任一行出现在上游报错内容中即触发转移。留空则仅按下方条件触发。</p>
      </Field>

      <Field>
        <FieldLabel htmlFor="failover-speed">速度限制（token/s）</FieldLabel>
        <Input id="failover-speed" type="number" min={0} className="w-40" value={form.speedLimit} onChange={(event) => setForm((p) => ({ ...p, speedLimit: Math.max(0, Number(event.target.value) || 0) }))} placeholder="0" />
        <p className="text-xs text-muted-foreground">填 0 表示不限制；填大于 0 表示请求全程速度（总 token ÷ 含建连的总耗时）低于 N token/s 也算一次失败，计入禁用阈值（与匹配字段 OR 关系）。</p>
      </Field>

      <Field>
        <FieldLabel htmlFor="failover-ttfb">首字超时（秒）</FieldLabel>
        <Input id="failover-ttfb" type="number" min={0} className="w-40" value={form.ttfbSeconds} onChange={(event) => setForm((p) => ({ ...p, ttfbSeconds: Math.max(0, Number(event.target.value) || 0) }))} placeholder="0" />
        <p className="text-xs text-muted-foreground">填 0 表示不启用此条件；填大于 0 表示首字响应超过 N 秒也会触发转移（与匹配字段 OR 关系）。</p>
      </Field>

      <Field>
        <FieldLabel>禁用阈值</FieldLabel>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>每</span>
          <Input type="number" min={0} className="w-20" aria-label="命中时间窗口（分钟）" value={form.disableWindowMinutes} onChange={(event) => setForm((p) => ({ ...p, disableWindowMinutes: Math.max(0, Number(event.target.value) || 0) }))} />
          <span>分钟命中</span>
          <Input type="number" min={1} className="w-20" aria-label="禁用前命中次数" value={form.disableThreshold} onChange={(event) => setForm((p) => ({ ...p, disableThreshold: Math.max(1, Number(event.target.value) || 1) }))} />
          <span>次则禁用</span>
        </div>
        <p className="text-xs text-muted-foreground">窗口期内连续命中 N 次才禁用。窗口填 0 表示不限时间；次数填 1 等于「一次就禁」。</p>
      </Field>

      </FieldGroup>
    </DialogScrollBody>
  )
}

// ── Response Rewrite ──

function RewriteResponsePage() {
  const { rules, loading, error, mutating, fetch, create, update, remove, offset, limit, total, setOffset, setLimit } = useRulesApi<ResponseRewriteRule>('rewrite-response')
  const [editing, setEditing] = useState<ResponseRewriteRule | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [deleting, setDeleting] = useState<ResponseRewriteRule | null>(null)


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
      key: 'id',
      label: '操作',
      defaultWidth: { kind: 'pixel', value: 140 },
      defaultAlign: 'right',
      showEmptyPlaceholder: false,
      render: (_, row) => (
        <div className="inline-flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => { setEditing(row); setIsOpen(true); }}>
            <AppIcon name="edit" />
          </Button>
          <Button variant="ghost" size="icon" disabled={mutating} onClick={() => setDeleting(row)}>
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
        <DialogContent width="md" scrollFooter>
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

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="确认删除"
        description={`将删除规则「${deleting?.name ?? ''}」，删除后不可恢复。`}
        busy={mutating}
        onConfirm={() => {
          if (deleting) {
            const id = deleting.id
            setDeleting(null)
            void handleDelete(id)
          }
        }}
      />
    </div>
  )
}
